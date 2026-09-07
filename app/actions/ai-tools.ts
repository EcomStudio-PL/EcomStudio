"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { encryptionAvailable } from "@/lib/server/crypto";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { ENGINE_MODES, isAiToolKey, type EngineMode } from "@/lib/services/ai-tools";

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
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool" };
    if (!(ENGINE_MODES as readonly string[]).includes(input.engineMode)) {
      return { ok: false, error: "invalid_mode" };
    }
    // The catalogue is the price list; a tool may only point at a row that is
    // actually in it, never invent a slug.
    if (input.serviceSlug) {
      const { data: service } = await supabase
        .from("service_catalog").select("slug").eq("slug", input.serviceSlug).maybeSingle();
      if (!service) return { ok: false, error: "unknown_service" };
    }

    const { error } = await supabase.from("ai_tools").upsert({
      tool_key: input.toolKey,
      engine_mode: input.engineMode,
      service_slug: input.serviceSlug,
      allow_model_choice: input.allowModelChoice,
      fallback_enabled: input.fallbackEnabled,
      // Clamped here as well as in the CHECK constraint: an aggressive retry
      // policy is a way to pay a provider twice for one image.
      timeout_ms: Math.min(Math.max(Math.trunc(input.timeoutMs) || 120000, 5000), 600000),
      max_attempts: Math.min(Math.max(Math.trunc(input.maxAttempts) || 1, 1), 3),
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.config_saved",
      entityType: "ai_tool", entityId: input.toolKey,
      after: { engine_mode: input.engineMode, service_slug: input.serviceSlug },
    });
    refresh(input.toolKey);
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
        .from("ai_models").select("id").in("id", wanted.map((w) => w.id));
      const knownIds = new Set((known ?? []).map((m) => m.id));
      if (wanted.some((w) => !knownIds.has(w.id))) return { ok: false, error: "unknown_model" };
    }

    // Replace the whole assignment set: it is small, and a diff would leave
    // orphan roles behind on the first mistake.
    await supabase.from("ai_tool_models").delete().eq("tool_key", input.toolKey);
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
    if (body.length > 40000) return { ok: false, error: "too_long" };
    // Publishing is a production change: it needs a sentence saying why, or
    // the version history is a list of anonymous edits.
    if (input.publish && !input.reason?.trim()) return { ok: false, error: "reason_required" };
    if (!encryptionAvailable()) return { ok: false, error: "encryption_unavailable" };

    const sealed = sealPrompt(body);
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
  } catch { return { ok: false, error: "generic" }; }
}

export async function publishPromptVersionAction(id: string, reason: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!reason.trim()) return { ok: false, error: "reason_required" };
    const { data, error } = await supabase.rpc("ai_publish_tool_prompt", { p_id: id, p_reason: reason.trim() });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; tool_key?: string } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.prompt_published",
      entityType: "ai_tool_prompt", entityId: id, after: { reason: reason.trim() },
    });
    if (result.tool_key) refresh(result.tool_key);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function restorePromptVersionAction(id: string, reason: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("ai_restore_tool_prompt", {
      p_id: id, p_reason: reason.trim() || null,
    });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; from_version?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.prompt_restored",
      entityType: "ai_tool_prompt", entityId: id, after: { from_version: result.from_version },
    });
    revalidatePath("/admin/ai");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/**
 * Open one version for the editor.
 *
 * The only path a decrypted prompt takes out of the server, and it is
 * deliberately narrow: an admin, a specific version id, one body. The list
 * views never carry a body, so a hidden prompt cannot arrive somewhere nobody
 * meant to send it.
 */
export async function readPromptBodyAction(id: string): Promise<Result & { body?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { data } = await supabase
      .from("ai_tool_prompts")
      .select("body_encrypted, body_iv, body_tag")
      .eq("id", id)
      .maybeSingle();
    if (!data) return { ok: false, error: "not_found" };
    const body = openPrompt(data);
    if (body === null) return { ok: false, error: "decrypt_failed" };
    return { ok: true, body };
  } catch { return { ok: false, error: "generic" }; }
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
