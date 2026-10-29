"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { PromptKeyError } from "@/lib/server/prompt-vault";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
import { GROVSHOT_V2_KEYS } from "@/lib/grovshot-v2/stages";
import { STAGE_ROLES, isStageModelRef, parseEngineConfig, type StageModel, type StageModelRef, type StageRole } from "@/lib/grovshot-v2/config";
import { specDraft } from "@/lib/server/grovshot-v2/seed";
import type { ModelTestResult } from "@/lib/server/grovshot-v2/model-test";

/**
 * GROVBASE SHOT V2 — the admin's actions on its tab (/admin/ai/prompts →
 * Silnik V2). Admin only, checked on every call; every write is audited.
 *
 *   · „Wczytaj szkice ze specyfikacji” — saves the spec's texts as DRAFTS of
 *     the six stage keys (never published by code; the admin reviews,
 *     edits and publishes each one through the ordinary versioned editor);
 *   · „Modele etapów” — the model of each role saved as a new DRAFT of the
 *     config (never published here; the admin publishes it in the editor);
 *   · „Testuj model” — one minimal real request to a role's model;
 * („Test silnika” is the admin-only route app/api/admin/grovshot-v2/test —
 * a route, so the engine is not compiled a second time for these actions.)
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

function failure(e: unknown): string {
  if (e instanceof PromptKeyError) return "prompt_key_unavailable";
  if (e instanceof Error && (e.message === "unauthenticated" || e.message === "not_admin")) return "forbidden";
  return "generic";
}

export async function seedSpecDraftsAction(reason: string): Promise<Result & { saved?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const why = reason.trim();
    if (!why) return { ok: false, error: "reason_required" };
    const ring = await adminPromptKeyring(supabase);
    let saved = 0;
    const versions: Record<string, number> = {};
    for (const key of GROVSHOT_V2_KEYS) {
      const sealed = sealPrompt(ring, specDraft(key));
      const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
        p_tool_key: key, p_body_encrypted: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.authTag,
        p_summary: "Szkic ze specyfikacji (GrovShot V2)", p_reason: why, p_source: "manual", p_publish: false,
      });
      const result = (error ? null : data) as { ok?: boolean; version?: number } | null;
      if (!result?.ok) return { ok: false, error: "generic", saved };
      saved++;
      if (typeof result.version === "number") versions[key] = result.version;
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovshot_v2.drafts_seeded", entityType: "ai_tool", entityId: "prompts",
      after: { reason: why, versions },
    });
    // The GrovShot page is the dynamic tool route.
    revalidatePath("/admin/ai/[tool]", "page");
    return { ok: true, saved };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

/** The newest draft or published config text (the base a model change is
 *  written onto) — opened with the admin keyring. */
async function baseConfig(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ text: string; version: number } | null> {
  const { data } = await supabase.from("ai_tool_prompts").select("version, status, body_encrypted, body_iv, body_tag")
    .eq("tool_key", "grovshot_v2_config").in("status", ["draft", "published"]).order("version", { ascending: false }).limit(1);
  const row = data?.[0];
  if (!row) return null;
  const opened = openPrompt(await adminPromptKeyring(supabase), row);
  return opened ? { text: opened.text, version: row.version } : null;
}

export async function saveRoleModelsAction(models: Record<string, unknown>, reason: string): Promise<Result & { version?: number; problems?: string[] }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const why = reason.trim();
    if (!why) return { ok: false, error: "reason_required" };
    const next = {} as Record<StageRole, StageModel>;
    for (const role of STAGE_ROLES) {
      const m = models?.[role] as (StageModelRef & { fallback?: unknown }) | undefined;
      if (!isStageModelRef(m)) return { ok: false, error: "invalid_input", problems: [`models.${role}`] };
      const ref: StageModel = { provider: m.provider, model: m.model, ...(m.effort ? { effort: m.effort } : {}) };
      // A fallback only when the admin wrote one — never implied.
      if (m.fallback !== undefined && m.fallback !== null) {
        if (!isStageModelRef(m.fallback)) return { ok: false, error: "invalid_input", problems: [`models.${role}.fallback`] };
        const f = m.fallback;
        ref.fallback = { provider: f.provider, model: f.model, ...(f.effort ? { effort: f.effort } : {}) };
      }
      next[role] = ref;
    }
    const base = await baseConfig(supabase);
    if (!base) return { ok: false, error: "config_missing" };
    let value: Record<string, unknown>;
    try { value = JSON.parse(base.text) as Record<string, unknown>; } catch { return { ok: false, error: "config_invalid" }; }
    const text = JSON.stringify({ ...value, models: next }, null, 2);
    const parsed = parseEngineConfig(text);
    if (!parsed.ok) return { ok: false, error: "config_invalid", problems: parsed.errors.slice(0, 10) };
    const sealed = sealPrompt(await adminPromptKeyring(supabase), text);
    const { data, error } = await supabase.rpc("ai_save_tool_prompt", {
      p_tool_key: "grovshot_v2_config", p_body_encrypted: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.authTag,
      p_summary: "Modele etapów (GrovShot V2)", p_reason: why, p_source: "manual", p_publish: false,
    });
    const result = (error ? null : data) as { ok?: boolean; version?: number } | null;
    if (!result?.ok) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovshot_v2.models_drafted", entityType: "ai_tool", entityId: "grovshot_v2_config",
      after: { reason: why, base_version: base.version, version: result.version ?? null, models: next },
    });
    revalidatePath("/admin/ai/[tool]", "page");
    return { ok: true, version: result.version };
  } catch (e) { return { ok: false, error: failure(e) }; }
}

export async function testStageModelAction(role: string, ref: unknown): Promise<Result & { test?: ModelTestResult }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!(STAGE_ROLES as readonly string[]).includes(role) || !isStageModelRef(ref)) return { ok: false, error: "invalid_input" };
    const { testStageModel } = await import("@/lib/server/grovshot-v2/model-test");
    const test = await testStageModel(supabase, adminId, role as StageRole, { provider: ref.provider, model: ref.model, ...(ref.effort ? { effort: ref.effort } : {}) });
    await logAudit(supabase, {
      actorId: adminId, action: "grovshot_v2.model_tested", entityType: "ai_tool", entityId: "grovshot_v2_config",
      after: { role, provider: ref.provider, model: ref.model, ok: test.ok, error: test.ok ? null : test.error },
    });
    return { ok: true, test };
  } catch (e) { return { ok: false, error: failure(e) }; }
}
