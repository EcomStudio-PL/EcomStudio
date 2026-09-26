"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { encryptionAvailable } from "@/lib/server/crypto";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { buildHintCiphertext, embedTexts } from "@/lib/server/knowledge";
import { textCapableBackends } from "@/lib/server/prompt-engine";
import { getUsableModels } from "@/lib/ai/router";
import {
  TOOL_ENGINE_MODES, isAiToolKey, toolSupportsWorkflow, type AiToolKey,
} from "@/lib/services/ai-tools";
import {
  TOOL_VARIABLES, compileTemplate, malformedPlaceholders, parsePlaceholders,
  sampleValues, workflowVariables, type VariableDef,
} from "@/lib/ai/prompt-variables";

/**
 * AI ENGINE — the admin actions this upgrade adds next to app/actions/
 * ai-tools.ts (prompt save/publish/restore stay there, unchanged in shape).
 *
 * Same rules as there:
 *   - admin only, checked on every call;
 *   - a decrypted body leaves the server only to the admin who asked for that
 *     specific version (the workflow editor), never in a list;
 *   - publish and rollback are single SQL transactions (migration 0126);
 *   - nothing here makes a paid provider call. "Testuj konfigurację" is a dry
 *     run: it compiles, checks and estimates, and says so.
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

const PROMPT_MAX_CHARS = 40000;
const STEP_PROMPT_MAX = 20000;

/* ── compile preview ──────────────────────────────────────────────────────*/

export type CompilePreview = {
  ok: boolean;
  error?: string;
  /** The draft compiled with SAMPLE values — never runtime data. */
  text?: string;
  chars: number;
  unknown: string[];
  missing: string[];
  malformed: string[];
  used: string[];
};

/**
 * "Podgląd kompilacji" — the admin's own draft, compiled with the sample value
 * of every variable, so the admin sees exactly how placeholders render (and
 * how customer data is fenced off) before anything is saved.
 */
export async function compilePreviewAction(input: {
  toolKey: string; body: string; workflowPosition?: number | null;
}): Promise<CompilePreview> {
  const empty = { chars: 0, unknown: [], missing: [], malformed: [], used: [] };
  try {
    await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool", ...empty };
    const body = String(input.body ?? "").slice(0, PROMPT_MAX_CHARS);
    const defs = input.workflowPosition ? workflowVariables(input.toolKey, input.workflowPosition) : TOOL_VARIABLES[input.toolKey] ?? [];
    const malformed = malformedPlaceholders(body);
    const compiled = compileTemplate(body, defs, sampleValues(defs));
    if (!compiled.ok) {
      return { ok: false, error: compiled.error, chars: body.length, unknown: compiled.unknown, missing: compiled.missing, malformed, used: [] };
    }
    return { ok: true, text: compiled.text, chars: body.length, unknown: [], missing: [], malformed, used: compiled.used };
  } catch { return { ok: false, error: "generic", ...empty }; }
}

/** Unknown placeholders in a body, for the publish gate. */
function unknownVariables(body: string, defs: VariableDef[]): string[] {
  const known = new Set(defs.map((d) => d.key));
  return [...new Set(parsePlaceholders(body).map((p) => p.name).filter((n) => !known.has(n)))];
}

/* ── knowledge strategy ───────────────────────────────────────────────────*/

export async function saveKnowledgeStrategyAction(toolKey: string, strategy: "proven" | "diverse"): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(toolKey)) return { ok: false, error: "unknown_tool" };
    if (strategy !== "proven" && strategy !== "diverse") return { ok: false, error: "invalid_input" };
    const { error } = await supabase.from("ai_tools")
      .update({ knowledge_strategy: strategy, updated_at: new Date().toISOString(), updated_by: adminId })
      .eq("tool_key", toolKey);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.knowledge_strategy_saved",
      entityType: "ai_tool", entityId: toolKey, after: { strategy },
    });
    refresh(toolKey);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── workflows ────────────────────────────────────────────────────────────*/

export type WorkflowStepInput = {
  name: string;
  enabled: boolean;
  operation: "analyze" | "generate_image";
  outputKind: "text" | "analysis" | "image";
  useImages: boolean;
  modelId: string | null;
  textProvider: "openai" | "google" | null;
  timeoutMs: number;
  maxAttempts: number;
  condition: "always" | "if_hint" | "if_previous_nonempty";
  prompt: string;
};

type StepError = { error: string; step?: number; names?: string[] };

/** Validate a step list the way the SQL function will — and then some (the
 *  variables each step may use, and the model override's real capabilities). */
async function validateSteps(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  toolKey: AiToolKey, steps: WorkflowStepInput[],
): Promise<StepError | null> {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) return { error: "invalid_steps" };
  const last = steps.length - 1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const n = i + 1;
    const name = String(s.name ?? "").trim();
    if (!name || name.length > 80) return { error: "step_name", step: n };
    const prompt = String(s.prompt ?? "").trim();
    if (!prompt) return { error: "empty_prompt", step: n };
    if (prompt.length > STEP_PROMPT_MAX) return { error: "too_long", step: n };
    if (s.operation !== "analyze" && s.operation !== "generate_image") return { error: "invalid_steps", step: n };
    if (s.operation === "generate_image") {
      if (i !== last) return { error: "image_step_last", step: n };
      if (!s.enabled) return { error: "image_step_disabled", step: n };
      if (s.outputKind !== "image") return { error: "invalid_steps", step: n };
    } else {
      if (i === last) return { error: "image_step_last", step: n };
      if (s.outputKind !== "text" && s.outputKind !== "analysis") return { error: "invalid_steps", step: n };
      if (s.modelId) return { error: "invalid_steps", step: n };
    }
    if (s.textProvider !== null && s.textProvider !== "openai" && s.textProvider !== "google") return { error: "invalid_steps", step: n };
    if (s.operation === "generate_image" && s.textProvider) return { error: "invalid_steps", step: n };
    if (!["always", "if_hint", "if_previous_nonempty"].includes(s.condition)) return { error: "invalid_steps", step: n };
    const unknown = unknownVariables(prompt, workflowVariables(toolKey, n));
    if (unknown.length) return { error: "variable_unknown", step: n, names: unknown };
    if (malformedPlaceholders(prompt).length) return { error: "variable_malformed", step: n };
  }
  // A model override must be a model the router can really use for an
  // image-to-image step: active, keyed, and able to carry the references the
  // Product Lock depends on.
  const override = steps[last].modelId;
  if (override) {
    const usable = await getUsableModels(supabase);
    const m = usable.find((u) => u.id === override);
    if (!m || !m.capabilities_ui.supportsReferenceImages) return { error: "model_unusable", step: steps.length };
  }
  return null;
}

export async function saveWorkflowAction(input: {
  toolKey: string; steps: WorkflowStepInput[]; summary: string | null; reason: string | null; publish: boolean;
}): Promise<Result & { version?: number; step?: number; names?: string[] }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey) || !toolSupportsWorkflow(input.toolKey)) return { ok: false, error: "workflow_unsupported" };
    if (input.publish && !input.reason?.trim()) return { ok: false, error: "reason_required" };
    if (!encryptionAvailable()) return { ok: false, error: "encryption_unavailable" };
    const invalid = await validateSteps(supabase, input.toolKey, input.steps);
    if (invalid) return { ok: false, ...invalid };

    const payload = input.steps.map((s) => {
      const sealed = sealPrompt(String(s.prompt).trim());
      return {
        name: String(s.name).trim().slice(0, 80),
        enabled: Boolean(s.enabled),
        operation: s.operation,
        output_kind: s.outputKind,
        // The image step always carries the photos: without them the Product
        // Lock has nothing to hold on to.
        use_images: s.operation === "generate_image" ? true : Boolean(s.useImages),
        model_id: s.operation === "generate_image" ? s.modelId || null : null,
        text_provider: s.operation === "analyze" ? s.textProvider : null,
        timeout_ms: Math.min(Math.max(Math.trunc(Number(s.timeoutMs)) || 60000, 5000), 300000),
        max_attempts: Math.min(Math.max(Math.trunc(Number(s.maxAttempts)) || 1, 1), 3),
        condition: s.condition,
        prompt_encrypted: sealed.ciphertext,
        prompt_iv: sealed.iv,
        prompt_tag: sealed.authTag,
      };
    });
    const { data, error } = await supabase.rpc("ai_save_tool_workflow", {
      p_tool_key: input.toolKey,
      p_steps: payload as never,
      p_summary: input.summary?.trim().slice(0, 300) || null,
      p_reason: input.reason?.trim().slice(0, 500) || null,
      p_publish: input.publish,
    });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; version?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
    await logAudit(supabase, {
      actorId: adminId,
      action: input.publish ? "ai_tool.workflow_published" : "ai_tool.workflow_drafted",
      entityType: "ai_tool", entityId: input.toolKey,
      // Versions, counts and the reason — never a step prompt.
      after: { version: result.version, steps: payload.length, reason: input.reason?.trim() ?? null },
    });
    refresh(input.toolKey);
    return { ok: true, version: result.version };
  } catch { return { ok: false, error: "generic" }; }
}

export async function publishWorkflowAction(id: string, reason: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!reason?.trim()) return { ok: false, error: "reason_required" };
    const { data, error } = await supabase.rpc("ai_publish_tool_workflow", { p_id: id, p_reason: reason.trim().slice(0, 500) });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; tool_key?: string; version?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.workflow_published",
      entityType: "ai_tool_workflow", entityId: id, after: { version: result.version ?? null, reason: reason.trim() },
    });
    if (result.tool_key) refresh(result.tool_key);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function restoreWorkflowAction(id: string, reason: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("ai_restore_tool_workflow", { p_id: id, p_reason: reason?.trim().slice(0, 500) || null });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; tool_key?: string; version?: number; from_version?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.workflow_restored",
      entityType: "ai_tool_workflow", entityId: id, after: { from_version: result.from_version, version: result.version },
    });
    if (result.tool_key) refresh(result.tool_key);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Open ONE workflow version for the editor — the only path its step prompts
 *  take out of the server, to the admin who asked for it. */
export async function readWorkflowAction(id: string): Promise<Result & { steps?: WorkflowStepInput[]; summary?: string | null }> {
  try {
    const { supabase } = await requireAdmin();
    const [{ data: wf }, { data: steps }] = await Promise.all([
      supabase.from("ai_tool_workflows").select("id, summary").eq("id", id).maybeSingle(),
      supabase.from("ai_tool_workflow_steps")
        .select("position, name, enabled, operation, output_kind, use_images, model_id, text_provider, timeout_ms, max_attempts, condition, prompt_encrypted, prompt_iv, prompt_tag")
        .eq("workflow_id", id).order("position"),
    ]);
    if (!wf || !steps?.length) return { ok: false, error: "not_found" };
    const out: WorkflowStepInput[] = [];
    for (const s of steps) {
      const prompt = openPrompt({ body_encrypted: s.prompt_encrypted, body_iv: s.prompt_iv, body_tag: s.prompt_tag });
      if (prompt === null) return { ok: false, error: "decrypt_failed" };
      out.push({
        name: s.name, enabled: s.enabled,
        operation: s.operation === "generate_image" ? "generate_image" : "analyze",
        outputKind: s.output_kind === "image" ? "image" : s.output_kind === "analysis" ? "analysis" : "text",
        useImages: s.use_images, modelId: s.model_id,
        textProvider: s.text_provider === "openai" || s.text_provider === "google" ? s.text_provider : null,
        timeoutMs: s.timeout_ms, maxAttempts: s.max_attempts,
        condition: s.condition === "if_hint" || s.condition === "if_previous_nonempty" ? s.condition : "always",
        prompt,
      });
    }
    return { ok: true, steps: out, summary: wf.summary };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── dry run ──────────────────────────────────────────────────────────────*/

export type DryRunCheck = { key: string; status: "ok" | "warn" | "fail"; params?: Record<string, string | number> };

/**
 * "Testuj konfigurację" — a DRY RUN. It reads what production would read,
 * compiles it with sample values and checks every dependency a real run has.
 * It makes no provider call and spends nothing; the result says so.
 */
export async function dryRunEngineAction(toolKey: string): Promise<Result & { checks?: DryRunCheck[] }> {
  try {
    const { supabase } = await requireAdmin();
    if (!isAiToolKey(toolKey)) return { ok: false, error: "unknown_tool" };
    const checks: DryRunCheck[] = [];
    const { data: tool } = await supabase.from("ai_tools").select("engine_mode").eq("tool_key", toolKey).maybeSingle();
    const mode = (tool?.engine_mode ?? "off") as string;
    const supported = (TOOL_ENGINE_MODES[toolKey] as readonly string[]).includes(mode);
    checks.push({ key: "mode", status: supported ? "ok" : "fail", params: { mode } });
    if (mode === "off") {
      checks.push({ key: "noEngine", status: "ok" });
      return { ok: true, checks };
    }

    const templates: { text: string; defs: VariableDef[]; label: string }[] = [];
    let usesAnalyzeSteps = false;
    let imageOverride: string | null = null;
    if (mode === "workflow") {
      const { data: wf } = await supabase.from("ai_tool_workflows")
        .select("id, version").eq("tool_key", toolKey).eq("status", "published").maybeSingle();
      if (!wf) {
        checks.push({ key: "workflowMissing", status: "fail" });
      } else {
        const read = await readWorkflowAction(wf.id);
        if (!read.ok || !read.steps) {
          checks.push({ key: "decrypt", status: "fail" });
        } else {
          checks.push({ key: "workflowPublished", status: "ok", params: { version: wf.version, steps: read.steps.length } });
          read.steps.forEach((s, i) => {
            templates.push({ text: s.prompt, defs: workflowVariables(toolKey, i + 1), label: `${i + 1}` });
            if (s.operation === "analyze" && s.enabled) usesAnalyzeSteps = true;
            if (s.operation === "generate_image") imageOverride = s.modelId;
          });
        }
      }
    } else {
      const { data: p } = await supabase.from("ai_tool_prompts")
        .select("version, body_encrypted, body_iv, body_tag").eq("tool_key", toolKey).eq("status", "published").maybeSingle();
      if (!p) {
        const builtIn = toolKey === "retouch" || toolKey === "prompts" || toolKey === "generator";
        checks.push({ key: builtIn ? "builtInUsed" : "promptMissing", status: builtIn ? "warn" : "fail" });
      } else {
        const body = openPrompt(p);
        if (body === null) checks.push({ key: "decrypt", status: "fail" });
        else {
          checks.push({ key: "promptPublished", status: "ok", params: { version: p.version, chars: body.length } });
          templates.push({ text: body, defs: TOOL_VARIABLES[toolKey] ?? [], label: "prompt" });
        }
      }
    }

    // Variables: every placeholder known; required ones whose source can be
    // empty at runtime are flagged (such a run is blocked, never guessed).
    let needsAnalysis = false;
    for (const t of templates) {
      const compiled = compileTemplate(t.text, t.defs, sampleValues(t.defs));
      if (!compiled.ok && compiled.error === "variable_unknown") {
        checks.push({ key: "variableUnknown", status: "fail", params: { where: t.label, names: compiled.unknown.join(", ") } });
        continue;
      }
      const risky = parsePlaceholders(t.text)
        .filter((p) => !p.optional)
        .map((p) => t.defs.find((d) => d.key === p.name))
        .filter((d): d is VariableDef => Boolean(d) && ["customer", "product", "ai", "knowledge", "workflow"].includes(d!.source))
        .map((d) => d.key);
      if (risky.length) checks.push({ key: "variableRequired", status: "warn", params: { where: t.label, names: [...new Set(risky)].join(", ") } });
      else checks.push({ key: "variablesOk", status: "ok", params: { where: t.label } });
      if (parsePlaceholders(t.text).some((p) => p.name === "product_analysis")) needsAnalysis = true;
    }

    if (usesAnalyzeSteps || needsAnalysis) {
      const backends = await textCapableBackends(supabase);
      checks.push({ key: "textBackends", status: backends.length ? "ok" : "fail", params: { n: backends.length } });
    }
    if (imageOverride) {
      const usable = await getUsableModels(supabase);
      const m = usable.find((u) => u.id === imageOverride);
      checks.push({ key: "modelOverride", status: m ? "ok" : "fail", params: { model: m?.display_name || m?.name || imageOverride } });
    }

    // Knowledge actually reachable by this tool.
    const { data: links } = await supabase.from("ai_tool_knowledge").select("set_id").eq("tool_key", toolKey).eq("enabled", true);
    const setIds = (links ?? []).map((l) => l.set_id);
    if (setIds.length === 0) {
      checks.push({ key: "knowledgeNone", status: "ok" });
    } else {
      const { count: approved } = await supabase.from("knowledge_examples").select("id", { count: "exact", head: true })
        .in("set_id", setIds).eq("review_status", "approved").eq("enabled", true);
      const { count: pending } = await supabase.from("knowledge_examples").select("id", { count: "exact", head: true })
        .in("set_id", setIds).eq("review_status", "pending");
      checks.push({ key: "knowledge", status: (approved ?? 0) > 0 ? "ok" : "warn", params: { sets: setIds.length, approved: approved ?? 0, pending: pending ?? 0 } });
    }
    checks.push({ key: "noPaidCall", status: "ok" });
    return { ok: true, checks };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── knowledge review ─────────────────────────────────────────────────────*/

/**
 * ADMIN REVIEW of an extracted example. Approving builds the sealed hint and
 * the embedding and makes the example retrievable; rejecting keeps it out for
 * good (it stays visible in the set for the record). Edits to the extracted
 * fields are applied in the same write. Nothing here can create or publish a
 * prompt.
 */
export async function reviewKnowledgeExampleAction(input: {
  id: string;
  decision: "approve" | "reject";
  promptUsed?: string | null;
  scene?: string | null;
  productCategory?: string | null;
  tags?: string[];
  swap?: boolean;
  toolKey?: string;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data: ex } = await supabase.from("knowledge_examples")
      .select("id, set_id, reference_path, generated_path, prompt_used, scene, product_category, what_worked, what_failed, correction, knowledge_sets(product_category, product_description)")
      .eq("id", input.id).maybeSingle();
    if (!ex) return { ok: false, error: "not_found" };
    const cap = (v: string | null | undefined, n: number) => (typeof v === "string" ? v.trim().slice(0, n) || null : undefined);
    const fields = {
      prompt_used: cap(input.promptUsed, 4000) === undefined ? ex.prompt_used : cap(input.promptUsed, 4000)!,
      scene: cap(input.scene, 1500) === undefined ? ex.scene : cap(input.scene, 1500)!,
      product_category: cap(input.productCategory, 120) === undefined ? ex.product_category : cap(input.productCategory, 120)!,
    };
    const row: Record<string, unknown> = {
      ...fields,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    };
    if (Array.isArray(input.tags)) {
      row.tags = input.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().slice(0, 40)).slice(0, 10);
    }
    // The heuristic may have the pair the wrong way round; the admin can say so.
    if (input.swap) { row.reference_path = ex.generated_path; row.generated_path = ex.reference_path; }
    const set = ex.knowledge_sets as unknown as { product_category: string | null; product_description: string | null } | null;
    if (input.decision === "approve") {
      const hint = buildHintCiphertext({
        category: fields.product_category ?? set?.product_category ?? null,
        prompt_used: fields.prompt_used, scene: fields.scene,
        what_worked: ex.what_worked, what_failed: ex.what_failed, correction: ex.correction,
      });
      if (!hint) return { ok: false, error: "nothing_to_learn" };
      Object.assign(row, { review_status: "approved", hint_encrypted: hint.ciphertext, hint_iv: hint.iv, hint_tag: hint.authTag });
    } else {
      Object.assign(row, { review_status: "rejected", hint_encrypted: null, hint_iv: null, hint_tag: null, embedding: null });
    }
    const { error } = await supabase.from("knowledge_examples").update(row as never).eq("id", input.id);
    if (error) return { ok: false, error: "generic" };
    if (input.decision === "approve") {
      const text = [fields.product_category ?? set?.product_category, set?.product_description?.slice(0, 800),
        fields.scene, fields.prompt_used, ex.what_worked, ex.correction].filter(Boolean).join("\n");
      const vectors = text.trim() ? await embedTexts(supabase, [text]) : null;
      if (vectors?.[0]) await supabase.from("knowledge_examples").update({ embedding: JSON.stringify(vectors[0]) as never }).eq("id", input.id);
    }
    await supabase.rpc("log_activity", {
      p_workspace_id: null as unknown as string,
      p_action: input.decision === "approve" ? "admin.knowledge_example_approved" : "admin.knowledge_example_rejected",
      p_entity_type: "knowledge_example", p_entity_id: input.id,
      p_metadata: { set_id: ex.set_id } as never,
    });
    revalidatePath("/admin/ai/wiedza");
    if (input.toolKey && isAiToolKey(input.toolKey)) refresh(input.toolKey);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}
