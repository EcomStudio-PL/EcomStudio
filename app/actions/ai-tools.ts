"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { normaliseSearchTags } from "@/lib/search-tags";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { PromptKeyError, unopenedError } from "@/lib/server/prompt-vault";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
import {
  ENGINE_MODES, MODEL_ASSIGNMENT_RUNTIME, TOOL_ENGINE_MODES, isAiToolKey, type EngineMode, type ToolConfigSection,
} from "@/lib/services/ai-tools";
import { TOOL_VARIABLES, malformedPlaceholders, parsePlaceholders } from "@/lib/ai/prompt-variables";

/** Placeholders a tool cannot resolve. Publishing one would make every run
 *  of the tool stop at the fail-safe, so publishing is refused instead. */
function unresolvable(toolKey: string, body: string): string[] {
  const known = new Set((TOOL_VARIABLES[toolKey] ?? []).map((d) => d.key));
  const names = parsePlaceholders(body).map((p) => p.name);
  const bad = [...new Set(names.filter((n) => !known.has(n)))];
  // GrovShot writes one prompt per planned scene: a template without {{scene}}
  // would give every card the same prompt, so it cannot be published.
  if (toolKey === "prompts" && !names.includes("scene")) bad.push("scene");
  return bad;
}

/** The prompt limit, in characters as a person counts them (code points): an
 *  emoji is one character, not two UTF-16 units, so a 40 000-character prompt
 *  with emoji is exactly as long as the counter in the editor says. */
const PROMPT_MAX = 40000;

/** The codes an admin sees for a failed prompt action. A missing session or a
 *  non-admin is `forbidden`; a Vault key that cannot be reached is named as
 *  such — never with a key, a ciphertext or a stack. */
function promptFailure(e: unknown): string {
  if (e instanceof PromptKeyError) return "prompt_key_unavailable";
  if (e instanceof Error && (e.message === "unauthenticated" || e.message === "not_admin")) return "forbidden";
  return "generic";
}

/** Every `ai_tools` column a config save can write, typed once. */
const ALL_COLUMNS = {
  engine_mode: "off" as string,
  service_slug: null as string | null,
  allow_model_choice: false,
  fallback_enabled: false,
  timeout_ms: 120000,
  max_attempts: 1,
  notes: null as string | null,
};

/** The columns each form section owns — and nothing else. */
const SECTION_COLUMNS: Record<ToolConfigSection | "models", (keyof typeof ALL_COLUMNS)[]> = {
  basics: ["service_slug", "notes"],
  billing: ["service_slug"],
  engine: ["engine_mode", "timeout_ms", "max_attempts"],
  models: ["allow_model_choice", "fallback_enabled"],
};

/**
 * AI CONTROL CENTER — the writes.
 *
 * Two rules run through all of it:
 *
 *   1. A hidden prompt is GrovBase IP. It is sealed before it reaches the
 *      database and only ever opened for an admin who asked for it by version
 *      id. No action returns a body it was not asked for, and no list view
 *      carries one.
 *   2. Publishing never overwrites. Every publish is a new version with an
 *      author and a reason; the previous one becomes 'superseded' and stays
 *      restorable. That work happens inside one SQL function (0071) so a
 *      failure cannot leave production between two prompts.
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

const refresh = (toolKey: string) => {
  revalidatePath("/admin/ai");
  revalidatePath(`/admin/ai/${toolKey}`);
};

/* ── engine configuration ─────────────────────────────────────────────────*/

export async function saveToolConfigAction(input: {
  toolKey: string;
  engineMode: EngineMode;
  serviceSlug: string | null;
  allowModelChoice: boolean;
  fallbackEnabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  notes: string | null;
}, section?: ToolConfigSection | "models"): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool" };
    // WHICH COLUMNS THIS SAVE OWNS. Without a section (the original callers)
    // it is the whole row, exactly as before. With one, only that section's
    // columns travel: the Narzędzia i silniki screen shows a tool's engine,
    // billing and model forms side by side, and a save sent while another is
    // still in flight must not carry the other's stale values back.
    const owns = (col: keyof typeof ALL_COLUMNS) => !section || SECTION_COLUMNS[section].includes(col);
    if (owns("engine_mode") && !(ENGINE_MODES as readonly string[]).includes(input.engineMode)) {
      return { ok: false, error: "invalid_mode" };
    }
    // Only a mode the tool's server path really implements (see
    // TOOL_ENGINE_MODES) — a switch that would decide nothing is refused.
    if (owns("engine_mode") && !TOOL_ENGINE_MODES[input.toolKey].includes(input.engineMode)) {
      return { ok: false, error: "mode_unsupported" };
    }
    // Workflow mode needs a published workflow first; switching to it without
    // one would take the tool down (or silently run the fallback).
    if (owns("engine_mode") && input.engineMode === "workflow") {
      const { data: wf } = await supabase.from("ai_tool_workflows")
        .select("id").eq("tool_key", input.toolKey).eq("status", "published").maybeSingle();
      if (!wf) return { ok: false, error: "workflow_unpublished" };
    }
    // The catalogue is the price list; a tool may only point at a row that is
    // actually in it, never invent a slug.
    if (owns("service_slug") && input.serviceSlug) {
      const { data: service } = await supabase
        .from("service_catalog").select("slug").eq("slug", input.serviceSlug).maybeSingle();
      if (!service) return { ok: false, error: "unknown_service" };
    }

    const columns: typeof ALL_COLUMNS = {
      engine_mode: input.engineMode,
      service_slug: input.serviceSlug,
      allow_model_choice: input.allowModelChoice,
      fallback_enabled: input.fallbackEnabled,
      // Clamped here as well as in the CHECK constraint: an aggressive retry
      // policy is a way to pay a provider twice for one image.
      timeout_ms: Math.min(Math.max(Math.trunc(input.timeoutMs) || 120000, 5000), 600000),
      max_attempts: Math.min(Math.max(Math.trunc(input.maxAttempts) || 1, 1), 3),
      notes: input.notes?.trim() || null,
    };
    // An upsert writes only the columns it is given; on a first save the rest
    // take the table's own defaults (0070), which are the values the panel
    // shows for a tool that was never configured.
    const owned = Object.fromEntries(
      (Object.keys(columns) as (keyof typeof ALL_COLUMNS)[]).filter(owns).map((k) => [k, columns[k]]),
    ) as Partial<typeof ALL_COLUMNS>;
    const { error } = await supabase.from("ai_tools").upsert({
      tool_key: input.toolKey,
      ...owned,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.config_saved",
      entityType: "ai_tool", entityId: input.toolKey,
      after: { section: section ?? "all", ...(owns("engine_mode") ? { engine_mode: input.engineMode } : {}),
        ...(owns("service_slug") ? { service_slug: input.serviceSlug } : {}) },
    });
    refresh(input.toolKey);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── search tags (global search metadata) ─────────────────────────────────*/

/**
 * TAGI WYSZUKIWANIA — extra phrases that find this tool in the global search.
 * Search metadata ONLY: nothing here reaches a prompt, a model or a request,
 * and it changes no availability (the palette filters with menuVisible()
 * before matching). Normalised by the same rule the editor uses: trimmed, no
 * empties, ≤ 60 characters, no case/diacritic duplicates, at most 30.
 */
export async function saveToolSearchTagsAction(toolKey: string, tags: unknown): Promise<Result> {
  try {
    if (!isAiToolKey(toolKey)) return { ok: false, error: "unknown_tool" };
    if (!Array.isArray(tags)) return { ok: false, error: "search_tags_invalid" };
    const { supabase, adminId } = await requireAdmin();
    const searchTags = normaliseSearchTags(tags);
    const { error } = await supabase.from("ai_tools").upsert({
      tool_key: toolKey,
      search_tags: searchTags,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.search_tags_saved",
      entityType: "ai_tool", entityId: toolKey,
      after: { search_tags: searchTags },
    });
    refresh(toolKey);
    // The customer bars read the tags in their layouts.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── model assignment ─────────────────────────────────────────────────────*/

export async function saveToolModelsAction(input: {
  toolKey: string;
  primaryModelId: string | null;
  fallbackModelId: string | null;
  allowedModelIds: string[];
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool" };
    if (input.primaryModelId && input.primaryModelId === input.fallbackModelId) {
      // A fallback identical to the primary is not a fallback; it is the same
      // request again, at the same provider, for the same money.
      return { ok: false, error: "same_model" };
    }

    const wanted = [
      ...(input.primaryModelId ? [{ id: input.primaryModelId, role: "primary" as const }] : []),
      ...(input.fallbackModelId ? [{ id: input.fallbackModelId, role: "fallback" as const }] : []),
      ...input.allowedModelIds
        .filter((id) => id !== input.primaryModelId && id !== input.fallbackModelId)
        .map((id) => ({ id, role: "allowed" as const })),
    ];

    // Every id has to be a model that exists — a dangling assignment would
    // read as "configured" on the registry screen and fail at runtime.
    if (wanted.length > 0) {
      const { data: known } = await supabase
        .from("ai_models").select("id, type, supports_reference_images").in("id", wanted.map((w) => w.id));
      const byId = new Map((known ?? []).map((m) => [m.id, m]));
      if (wanted.some((w) => !byId.has(w.id))) return { ok: false, error: "unknown_model" };
      // A tool whose runtime READS this assignment (Retusz) is image-to-image:
      // a model that is not an image model, or cannot take the source photo,
      // would break the tool or the Product Lock. Refused here, not at run time.
      if (MODEL_ASSIGNMENT_RUNTIME.has(input.toolKey)
        && wanted.some((w) => w.role !== "allowed" && (byId.get(w.id)?.type !== "image" || !byId.get(w.id)?.supports_reference_images))) {
        return { ok: false, error: "model_incompatible" };
      }
    }

    // Replace the whole assignment set: it is small, and a diff would leave
    // orphan roles behind on the first mistake. The old set is removed only
    // after the new one is known valid, and a failed delete stops the save
    // instead of inserting on top of it.
    const { error: clearError } = await supabase.from("ai_tool_models").delete().eq("tool_key", input.toolKey);
    if (clearError) return { ok: false, error: "generic" };
    if (wanted.length > 0) {
      const { error } = await supabase.from("ai_tool_models").insert(
        wanted.map((w, i) => ({ tool_key: input.toolKey, model_id: w.id, role: w.role, sort_order: i })),
      );
      if (error) return { ok: false, error: "generic" };
    }

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.models_saved",
      entityType: "ai_tool", entityId: input.toolKey,
      after: { primary: input.primaryModelId, fallback: input.fallbackModelId, allowed: input.allowedModelIds.length },
    });
    refresh(input.toolKey);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── prompts ──────────────────────────────────────────────────────────────*/

/**
 * Prompt bodies are sealed with the Vault-held prompt key (migration 0130,
 * lib/server/prompt-vault.ts) — no environment variable is involved, so a
 * deploy can no longer leave the editor unable to save. A body sealed earlier
 * with APP_ENCRYPTION_KEY still opens while that variable exists and is moved
 * to the Vault key whenever it is published or restored; one whose key is gone
 * is reported as `legacy_unreadable` and never blocks writing a new version.
 */
export async function savePromptAction(input: {
  toolKey: string;
  body: string;
  summary: string | null;
  reason: string | null;
  publish: boolean;
}): Promise<Result & { version?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool" };
    const body = input.body.trim();
    if (!body) return { ok: false, error: "empty_body" };
    if (Array.from(body).length > PROMPT_MAX) return { ok: false, error: "too_long" };
    // Publishing is a production change: it needs a sentence saying why, or
    // the version history is a list of anonymous edits.
    if (input.publish && !input.reason?.trim()) return { ok: false, error: "reason_required" };
    if (input.publish && (unresolvable(input.toolKey, body).length > 0 || malformedPlaceholders(body).length > 0)) {
      return { ok: false, error: "variable_unknown" };
    }

    const ring = await adminPromptKeyring(supabase);
    const sealed = sealPrompt(ring, body);
    const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
      p_tool_key: input.toolKey,
      p_body_encrypted: sealed.ciphertext,
      p_iv: sealed.iv,
      p_tag: sealed.authTag,
      p_summary: input.summary?.trim() || null,
      p_reason: input.reason?.trim() || null,
      p_source: "manual",
      p_publish: input.publish,
    });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; version?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };

    await logAudit(supabase, {
      actorId: adminId,
      action: input.publish ? "ai_tool.prompt_published" : "ai_tool.prompt_drafted",
      entityType: "ai_tool", entityId: input.toolKey,
      // The reason and the version, never the body.
      after: { version: result.version, reason: input.reason?.trim() ?? null },
    });
    refresh(input.toolKey);
    return { ok: true, version: result.version };
  } catch (e) { return { ok: false, error: promptFailure(e) }; }
}

type StoredVersion = {
  tool_key: string; version: number; status: string; summary: string | null; source: string;
  body_encrypted: string; body_iv: string; body_tag: string;
};

/**
 * Re-publish a body that was sealed with the legacy env key: the SAME text,
 * sealed with the Vault key, as a NEW published version. The legacy row stays
 * in the history untouched — nothing historical is ever rewritten.
 */
async function republishSealed(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  row: StoredVersion, text: string, reason: string, sealedBody: { ciphertext: string; iv: string; authTag: string },
): Promise<{ ok: true; version: number; id: string | null } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
    p_tool_key: row.tool_key,
    p_body_encrypted: sealedBody.ciphertext,
    p_iv: sealedBody.iv,
    p_tag: sealedBody.authTag,
    p_summary: row.summary,
    p_reason: reason,
    p_source: row.source === "knowledge" ? "knowledge" : "manual",
    p_publish: true,
  });
  if (error) return { ok: false, error: "generic" };
  const result = data as { ok?: boolean; error?: string; version?: number; id?: string } | null;
  if (!result?.ok || typeof result.version !== "number") return { ok: false, error: result?.error ?? "generic" };
  return { ok: true, version: result.version, id: typeof result.id === "string" ? result.id : null };
}

export async function publishPromptVersionAction(id: string, reason: string): Promise<Result & { version?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!reason.trim()) return { ok: false, error: "reason_required" };
    const { data: draft } = await supabase.from("ai_tool_prompts")
      .select("tool_key, version, status, summary, source, body_encrypted, body_iv, body_tag").eq("id", id).maybeSingle();
    if (!draft) return { ok: false, error: "not_found" };
    // Only a draft is published from the history; a superseded version goes
    // back through restore, which copies it forward instead.
    if (draft.status !== "draft") return { ok: false, error: "not_draft" };
    const ring = await adminPromptKeyring(supabase);
    // The same variable gate as a direct publish, applied to the stored draft.
    const opened = openPrompt(ring, draft);
    if (opened === null) return { ok: false, error: unopenedError(ring) };
    if (unresolvable(draft.tool_key, opened.text).length > 0 || malformedPlaceholders(opened.text).length > 0) {
      return { ok: false, error: "variable_unknown" };
    }

    let version: number | undefined;
    let publishedId = id;
    if (opened.source === "legacy") {
      const moved = await republishSealed(supabase, draft, opened.text, reason.trim(), sealPrompt(ring, opened.text));
      if (!moved.ok) return moved;
      version = moved.version;
      publishedId = moved.id ?? id;
      // The draft has been published — as its re-sealed copy. It is closed
      // like any published draft would be (superseded, not deleted, bytes
      // untouched), so it cannot be published a second time.
      await supabase.from("ai_tool_prompts").update({ status: "superseded" }).eq("id", id).eq("status", "draft");
    } else {
      const { data, error } = await supabase.rpc("ai_publish_tool_prompt", { p_id: id, p_reason: reason.trim() });
      if (error) return { ok: false, error: "generic" };
      const result = data as { ok?: boolean; error?: string; tool_key?: string } | null;
      if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
      version = draft.version;
    }

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.prompt_published",
      entityType: "ai_tool_prompt", entityId: publishedId,
      after: { reason: reason.trim(), version, ...(opened.source === "legacy" ? { resealed_from: draft.version } : {}) },
    });
    refresh(draft.tool_key);
    return { ok: true, version };
  } catch (e) { return { ok: false, error: promptFailure(e) }; }
}

export async function restorePromptVersionAction(id: string, reason: string): Promise<Result & { version?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: src } = await supabase.from("ai_tool_prompts")
      .select("tool_key, version, status, summary, source, body_encrypted, body_iv, body_tag").eq("id", id).maybeSingle();
    if (!src) return { ok: false, error: "not_found" };
    // Restoring a body nobody can open would publish a prompt the runtime
    // silently ignores. Refused; the admin pastes the prompt as a new version.
    const ring = await adminPromptKeyring(supabase);
    const opened = openPrompt(ring, src);
    if (opened === null) return { ok: false, error: unopenedError(ring) };
    if (unresolvable(src.tool_key, opened.text).length > 0 || malformedPlaceholders(opened.text).length > 0) {
      return { ok: false, error: "variable_unknown" };
    }

    let version: number | undefined;
    if (opened.source === "legacy") {
      const moved = await republishSealed(supabase, src, opened.text,
        reason.trim() || `restore v${src.version}`, sealPrompt(ring, opened.text));
      if (!moved.ok) return moved;
      version = moved.version;
    } else {
      const { data, error } = await supabase.rpc("ai_restore_tool_prompt", {
        p_id: id, p_reason: reason.trim() || null,
      });
      if (error) return { ok: false, error: "generic" };
      const result = data as { ok?: boolean; error?: string; version?: number } | null;
      if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
      version = result.version;
    }

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.prompt_restored",
      entityType: "ai_tool_prompt", entityId: id, after: { from_version: src.version, version },
    });
    refresh(src.tool_key);
    return { ok: true, version };
  } catch (e) { return { ok: false, error: promptFailure(e) }; }
}

/**
 * Open one version for the editor.
 *
 * The only path a decrypted prompt takes out of the server, and it is
 * deliberately narrow: an admin, a specific version id, one body. The list
 * views never carry a body, so a hidden prompt cannot arrive somewhere nobody
 * meant to send it.
 */
export async function readPromptBodyAction(id: string): Promise<Result & { body?: string; legacy?: boolean }> {
  try {
    const { supabase } = await requireAdmin();
    const { data } = await supabase
      .from("ai_tool_prompts")
      .select("body_encrypted, body_iv, body_tag")
      .eq("id", id)
      .maybeSingle();
    if (!data) return { ok: false, error: "not_found" };
    const ring = await adminPromptKeyring(supabase);
    const opened = openPrompt(ring, data);
    if (opened === null) return { ok: false, error: unopenedError(ring) };
    const body = opened.text;
    return { ok: true, body, legacy: opened.source === "legacy" };
  } catch (e) { return { ok: false, error: promptFailure(e) }; }
}

/* ── knowledge ────────────────────────────────────────────────────────────*/

export async function setToolKnowledgeAction(input: {
  toolKey: string; setId: string; assigned: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool" };

    if (input.assigned) {
      const { error } = await supabase.from("ai_tool_knowledge")
        .upsert({ tool_key: input.toolKey, set_id: input.setId, enabled: true });
      if (error) return { ok: false, error: "generic" };
    } else {
      // Unassigning detaches the set from this tool. The files, the examples
      // and the set itself are untouched — one set can serve several tools.
      const { error } = await supabase.from("ai_tool_knowledge")
        .delete().eq("tool_key", input.toolKey).eq("set_id", input.setId);
      if (error) return { ok: false, error: "generic" };
    }

    await logAudit(supabase, {
      actorId: adminId, action: input.assigned ? "ai_tool.knowledge_attached" : "ai_tool.knowledge_detached",
      entityType: "ai_tool", entityId: input.toolKey, after: { set_id: input.setId },
    });
    refresh(input.toolKey);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}
