"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { openPrompt, sealPrompt } from "@/lib/server/ai-engine";
import { PromptKeyError, promptKeyring } from "@/lib/server/prompt-vault";
import { adminPromptKeyring } from "@/lib/server/prompt-vault-admin";
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
import {
  STEP_PROMPT_MAX, STEP_TIMEOUT_DEFAULT_MS, fromV1, stepVariables, validateWorkflow, type WorkflowStepDef,
} from "@/lib/ai/workflow-def";
import { parseStepValue, renderValue } from "@/lib/ai/workflow-values";
import type { Resolution } from "@/lib/ai/types";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { resolveEngine } from "@/lib/server/ai-engine";
import { loadWorkflow } from "@/lib/server/engine/workflow-store";
import { startWorkflowRun } from "@/lib/server/engine/workflow";
import { driveAfterResponse } from "@/lib/server/engine/drive";
import { retouchModel } from "@/lib/server/retouch";
import { fashionModel } from "@/lib/server/fashion";

/**
 * AI ENGINE — the admin actions this upgrade adds next to app/actions/
 * ai-tools.ts (prompt save/publish/restore stay there, unchanged in shape).
 *
 * Same rules as there:
 *   - admin only, checked on every call;
 *   - a decrypted body leaves the server only to the admin who asked for that
 *     specific version (the workflow editor), never in a list;
 *   - publish and rollback are single SQL transactions (migration 0126);
 *   - "Testuj konfigurację" is a dry run: it compiles, checks and estimates,
 *     and makes no provider call. "Testuj workflow" is the one real run here,
 *     on the admin's own test photos, recorded as a test (never charged).
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
  /** v2 builder: the step list (names/kinds are what matter) and the index. */
  workflow?: { steps: WorkflowStepInput[]; index: number } | null;
}): Promise<CompilePreview> {
  const empty = { chars: 0, unknown: [], missing: [], malformed: [], used: [] };
  try {
    await requireAdmin();
    if (!isAiToolKey(input.toolKey)) return { ok: false, error: "unknown_tool", ...empty };
    // Characters as the editor counts them (code points), so an emoji is not
    // split in half at the limit.
    const body = Array.from(String(input.body ?? "")).slice(0, PROMPT_MAX_CHARS).join("");
    const wf = input.workflow;
    const defs = wf && Array.isArray(wf.steps) && Number.isInteger(wf.index)
      ? stepVariables(input.toolKey, wf.steps.map(normaliseStep), wf.index)
      : input.workflowPosition ? workflowVariables(input.toolKey, input.workflowPosition) : TOOL_VARIABLES[input.toolKey] ?? [];
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

/** One step as the builder edits it (the v2 definition, prompt included). */
export type WorkflowStepInput = WorkflowStepDef;

type StepError = { error: string; step?: number; names?: string[] };

/**
 * Validate a definition exactly the way the runtime will (shared code in
 * lib/ai/workflow-def.ts), then check what only the server can: that every
 * image model a step names is usable right now and can carry the images the
 * Product Lock depends on.
 */
async function validateDefinition(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  toolKey: AiToolKey, steps: WorkflowStepInput[], concurrency: number,
): Promise<StepError | null> {
  const clean = steps.map(normaliseStep);
  const v = validateWorkflow(toolKey, { steps: clean, concurrency });
  if (!v.ok) return { error: v.error, step: v.step, names: v.names };
  const wanted = clean.flatMap((s, i) => [s.modelId, s.fallbackModelId].filter(Boolean).map((id) => ({ id: id as string, step: i + 1, refs: s.inputImage !== "none" })));
  if (wanted.length) {
    const usable = await getUsableModels(supabase);
    for (const w of wanted) {
      const m = usable.find((u) => u.id === w.id);
      if (!m || (w.refs && !m.capabilities_ui.supportsReferenceImages)) return { error: "model_unusable", step: w.step };
    }
  }
  return null;
}

/** Everything coming from the browser is re-shaped to the exact type — an
 *  unexpected field is dropped, a wrong type becomes an invalid value. */
function normaliseStep(s: WorkflowStepInput): WorkflowStepDef {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
  return {
    name: str(s.name).trim().slice(0, 80),
    enabled: s.enabled !== false,
    operation: s.operation,
    outputKind: s.outputKind,
    outputName: str(s.outputName).trim(),
    inputImage: str(s.inputImage).trim() || "customer",
    forEach: opt(s.forEach),
    itemName: opt(s.itemName),
    maxItems: s.maxItems === null || s.maxItems === undefined ? null : int(s.maxItems, 0),
    modelId: opt(s.modelId),
    fallbackModelId: opt(s.fallbackModelId),
    textProvider: s.textProvider === "openai" || s.textProvider === "google" ? s.textProvider : null,
    textModel: opt(s.textModel),
    toolSlug: s.operation === "tool" ? s.toolSlug : null,
    timeoutMs: int(s.timeoutMs, STEP_TIMEOUT_DEFAULT_MS),
    maxAttempts: int(s.maxAttempts, 1),
    onError: s.onError === "continue" ? "continue" : "stop",
    onItemError: s.onItemError === "fail_run" ? "fail_run" : "continue",
    condition: s.condition === "if_hint" || s.condition === "if_previous_nonempty" ? s.condition : "always",
    prompt: str(s.prompt).slice(0, STEP_PROMPT_MAX + 1),
  };
}

export async function saveWorkflowAction(input: {
  toolKey: string; steps: WorkflowStepInput[]; concurrency: number;
  summary: string | null; reason: string | null; publish: boolean;
}): Promise<Result & { version?: number; id?: string; step?: number; names?: string[] }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey) || !toolSupportsWorkflow(input.toolKey)) return { ok: false, error: "workflow_unsupported" };
    if (input.publish && !input.reason?.trim()) return { ok: false, error: "reason_required" };
    const concurrency = Math.trunc(Number(input.concurrency) || 3);
    const invalid = await validateDefinition(supabase, input.toolKey, input.steps ?? [], concurrency);
    if (invalid) return { ok: false, ...invalid };

    // Step prompts are sealed with the Vault-held prompt key (migration 0130),
    // fetched once for the whole definition.
    const ring = await adminPromptKeyring(supabase);
    if (!ring.canSeal) return { ok: false, error: "prompt_key_unavailable" };
    const payload = input.steps.map(normaliseStep).map((s) => {
      // A tool step may carry no instruction of its own; an empty sealed body
      // would be indistinguishable from a broken one, so it seals one space.
      const sealed = sealPrompt(ring, s.prompt.trim() || " ");
      return {
        name: s.name, enabled: s.enabled, operation: s.operation, output_kind: s.outputKind,
        use_images: s.inputImage !== "none",
        model_id: s.operation === "image_edit" || s.operation === "image_generation" ? s.modelId : null,
        fallback_model_id: s.operation === "image_edit" || s.operation === "image_generation" ? s.fallbackModelId : null,
        text_provider: s.operation === "ai_text" ? s.textProvider : null,
        text_model: s.operation === "ai_text" ? s.textModel : null,
        tool_slug: s.operation === "tool" ? s.toolSlug : null,
        timeout_ms: s.timeoutMs, max_attempts: s.maxAttempts, condition: s.condition,
        output_name: s.outputName, input_image: s.inputImage,
        for_each: s.forEach, item_name: s.itemName, max_items: s.maxItems,
        on_error: s.onError, on_item_error: s.onItemError,
        prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
      };
    });
    const { data, error } = await supabase.rpc("ai_save_tool_workflow", {
      p_tool_key: input.toolKey,
      p_steps: payload as never,
      p_summary: input.summary?.trim().slice(0, 300) || null,
      p_reason: input.reason?.trim().slice(0, 500) || null,
      p_publish: input.publish,
      p_concurrency: concurrency,
    });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; version?: number; id?: string; step?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic", step: result?.step };
    await logAudit(supabase, {
      actorId: adminId,
      action: input.publish ? "ai_tool.workflow_published" : "ai_tool.workflow_drafted",
      entityType: "ai_tool", entityId: input.toolKey,
      // Versions, counts and the reason — never a step prompt.
      after: { version: result.version, steps: payload.length, reason: input.reason?.trim() ?? null },
    });
    refresh(input.toolKey);
    return { ok: true, version: result.version, id: result.id };
  } catch (e) { return { ok: false, error: e instanceof PromptKeyError ? "prompt_key_unavailable" : "generic" }; }
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

/** ROLLBACK: the chosen version is copied forward as a NEW published version
 *  (history is never rewritten). */
export async function restoreWorkflowAction(id: string, reason: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("ai_restore_tool_workflow", { p_id: id, p_reason: reason?.trim().slice(0, 500) || null });
    if (error) return { ok: false, error: "generic" };
    const result = data as { ok?: boolean; error?: string; tool_key?: string; version?: number; from_version?: number } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.workflow_restored",
      entityType: "ai_tool_workflow", entityId: id, after: { from_version: result.from_version, version: result.version, reason: reason?.trim() || null },
    });
    if (result.tool_key) refresh(result.tool_key);
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Open ONE workflow version for the editor — the only path its step prompts
 *  take out of the server, to the admin who asked for it. A v1 version is
 *  returned in v2 shape (outputs renamed, references rewritten). */
export async function readWorkflowAction(id: string): Promise<Result & {
  steps?: WorkflowStepInput[]; summary?: string | null; concurrency?: number; version?: number; status?: string;
}> {
  try {
    const { supabase } = await requireAdmin();
    const [{ data: wf }, { data: steps }] = await Promise.all([
      supabase.from("ai_tool_workflows").select("id, summary, concurrency, version, status").eq("id", id).maybeSingle(),
      supabase.from("ai_tool_workflow_steps")
        .select("position, name, enabled, operation, output_kind, use_images, model_id, fallback_model_id, text_provider, text_model, timeout_ms, max_attempts, condition, output_name, input_image, for_each, item_name, max_items, tool_slug, on_error, on_item_error, prompt_encrypted, prompt_iv, prompt_tag")
        .eq("workflow_id", id).order("position"),
    ]);
    if (!wf || !steps?.length) return { ok: false, error: "not_found" };
    const ring = await promptKeyring(supabase);
    const opened: { s: (typeof steps)[number]; prompt: string }[] = [];
    for (const s of steps) {
      const prompt = openPrompt(ring, { body_encrypted: s.prompt_encrypted, body_iv: s.prompt_iv, body_tag: s.prompt_tag })?.text ?? null;
      // A step sealed with a key that no longer exists: the version cannot be
      // opened, but saving a new one is never blocked by it.
      if (prompt === null) return { ok: false, error: "legacy_unreadable" };
      opened.push({ s, prompt });
    }
    const legacy = opened.some(({ s }) => s.operation === "analyze" || s.operation === "generate_image");
    let out: WorkflowStepDef[];
    if (legacy) {
      out = upgradeV1(fromV1(opened.map(({ s, prompt }) => ({
        operation: s.operation, outputKind: s.output_kind, name: s.name, enabled: s.enabled,
        useImages: s.use_images, modelId: s.model_id,
        textProvider: s.text_provider === "openai" || s.text_provider === "google" ? s.text_provider : null,
        timeoutMs: s.timeout_ms, maxAttempts: s.max_attempts,
        condition: s.condition === "if_hint" || s.condition === "if_previous_nonempty" ? s.condition : "always",
        prompt,
      }))));
    } else {
      out = opened.map(({ s, prompt }) => normaliseStep({
        name: s.name, enabled: s.enabled, operation: s.operation as WorkflowStepDef["operation"],
        outputKind: (s.output_kind === "analysis" ? "text" : s.output_kind) as WorkflowStepDef["outputKind"],
        outputName: s.output_name ?? `krok_${s.position}`, inputImage: s.input_image ?? "customer",
        forEach: s.for_each, itemName: s.item_name, maxItems: s.max_items,
        modelId: s.model_id, fallbackModelId: s.fallback_model_id,
        textProvider: s.text_provider === "openai" || s.text_provider === "google" ? s.text_provider : null,
        textModel: s.text_model, toolSlug: (s.tool_slug ?? null) as WorkflowStepDef["toolSlug"],
        timeoutMs: s.timeout_ms, maxAttempts: s.max_attempts,
        onError: s.on_error === "continue" ? "continue" : "stop",
        onItemError: s.on_item_error === "fail_run" ? "fail_run" : "continue",
        condition: s.condition === "if_hint" || s.condition === "if_previous_nonempty" ? s.condition : "always",
        prompt: s.operation === "tool" ? prompt.trim() : prompt,
      }));
    }
    return { ok: true, steps: out, summary: wf.summary, concurrency: wf.concurrency, version: wf.version, status: wf.status };
  } catch { return { ok: false, error: "generic" }; }
}

/** v1 outputs were called step1..stepN (now reserved): rename them and
 *  rewrite {{stepN}} / {{previous}} so the definition saves as v2 unchanged. */
function upgradeV1(steps: WorkflowStepDef[]): WorkflowStepDef[] {
  return steps.map((s, i) => {
    const prompt = s.prompt
      .replace(/\{\{\s*step(\d+)(\s*[?|][^}]*)?\s*\}\}/g, (_m, n: string, mod: string | undefined) => `{{krok_${n}${mod ?? ""}}}`)
      .replace(/\{\{\s*previous(\s*[?|][^}]*)?\s*\}\}/g, (_m, mod: string | undefined) => (i > 0 ? `{{krok_${i}${mod ?? ""}}}` : ""));
    return { ...s, outputName: `krok_${i + 1}`, prompt };
  });
}

/**
 * WORKFLOW ON / OFF. ON needs a published version (a switch with nothing to
 * run would silently fall back); OFF returns the tool to exactly its
 * single-call behaviour. Logged with who and why.
 */
export async function setWorkflowEnabledAction(toolKey: string, enabled: boolean, reason: string | null): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(toolKey) || !toolSupportsWorkflow(toolKey)) return { ok: false, error: "workflow_unsupported" };
    if (enabled) {
      const { data: wf } = await supabase.from("ai_tool_workflows").select("id")
        .eq("tool_key", toolKey).eq("status", "published").maybeSingle();
      if (!wf) return { ok: false, error: "workflowMissing" };
    }
    const { error } = await supabase.from("ai_tools")
      .update({ workflow_enabled: enabled, updated_at: new Date().toISOString(), updated_by: adminId })
      .eq("tool_key", toolKey);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: enabled ? "ai_tool.workflow_enabled" : "ai_tool.workflow_disabled",
      entityType: "ai_tool", entityId: toolKey, after: { enabled, reason: reason?.trim().slice(0, 500) || null },
    });
    refresh(toolKey);
    revalidatePath("/retusz");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/* ── test run ─────────────────────────────────────────────────────────────*/

export type TestStepView = {
  position: number; item: number; name: string | null; operation: string; status: string;
  attempts: number; ms: number | null; provider: string | null; model: string | null;
  inputTokens: number | null; outputTokens: number | null; costUsdMicros: number | null; costKnown: boolean;
  error: string | null;
  /** Admin-only preview of what the step produced (never its prompt). */
  text: string | null; imageUrl: string | null;
};
export type TestRunView = {
  id: string; status: string; error: string | null; version: number | null; expected: number;
  delivered: number; durationMs: number | null; costUsdMicros: number | null; costUnknown: number;
  tokensIn: number; tokensOut: number; driving: boolean; steps: TestStepView[]; results: string[];
};

/**
 * TEST WORKFLOW — runs a version (draft or published) for real, on the
 * admin's own test photos, BEFORE it is published. Real provider calls, so a
 * real cost (recorded as `workflow_test`, never charged to anyone, never on
 * the provider card's live status). The result lands in the admin's own
 * workspace, in a test folder — not in any customer's library.
 */
export async function startWorkflowTestAction(input: {
  toolKey: string; workflowId: string; referencePaths: string[]; hint?: string;
}): Promise<Result & { runId?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isAiToolKey(input.toolKey) || !toolSupportsWorkflow(input.toolKey)) return { ok: false, error: "workflow_unsupported" };
    const workspace = await getCurrentWorkspace(supabase, adminId);
    if (!workspace) return { ok: false, error: "no_workspace" };
    const paths = (input.referencePaths ?? []).filter((p) => typeof p === "string"
      && p.startsWith(`${workspace.id}/`) && !p.includes("..") && /^[\w\-./]+$/.test(p) && p.length <= 300).slice(0, 10);
    if (paths.length !== (input.referencePaths ?? []).length || paths.length === 0) return { ok: false, error: "invalid_input" };

    const workflow = await loadWorkflow(supabase, input.toolKey, input.workflowId);
    if (!workflow) return { ok: false, error: "not_found" };
    const model = await toolImageModel(supabase, input.toolKey);
    if (!model) return { ok: false, error: "model_unavailable" };
    const engine = await resolveEngine(supabase, input.toolKey);
    const started = await startWorkflowRun(supabase, adminId, workspace.id, {
      toolKey: input.toolKey, workflow, hint: String(input.hint ?? "").slice(0, 1000), referencePaths: paths,
      aspectRatio: "1:1", resolution: (model.resolutions[0] ?? "1K") as Resolution, quality: null,
      toolModelId: model.id, toolFallbackId: model.fallbackId, unitCredits: 0,
      operation: `${input.toolKey}_test`, knowledgeStrategy: engine?.knowledgeStrategy ?? "proven", test: true,
    });
    if (!started.ok) return { ok: false, error: started.error };
    await logAudit(supabase, {
      actorId: adminId, action: "ai_tool.workflow_tested", entityType: "ai_tool", entityId: input.toolKey,
      after: { workflow_version: workflow.version, run: started.runId },
    });
    driveAfterResponse(supabase, started.runId, Date.now());
    return { ok: true, runId: started.runId };
  } catch { return { ok: false, error: "generic" }; }
}

/** The test run as the admin sees it: every step with ✓/✗, time, executor,
 *  N/N items, tokens, cost — and keeps an idle run moving. */
export async function readWorkflowTestAction(runId: string): Promise<Result & { run?: TestRunView }> {
  try {
    const { supabase } = await requireAdmin();
    const [{ data: run }, { data: steps }] = await Promise.all([
      supabase.from("ai_engine_runs")
        .select("id, status, error, workflow_version, expected_outputs, outputs, duration_ms, api_cost_usd_micros, cost_unknown, locked_until, run_kind, created_at")
        // Test runs only: this reader also DRIVES an idle run, and a customer's
        // run must never be driven (or closed) in an admin's session.
        .eq("id", runId).eq("run_kind", "workflow_test").maybeSingle(),
      supabase.from("ai_engine_step_runs")
        .select("position, item_index, step_name, operation, status, attempts, duration_ms, provider_slug, model, input_tokens, output_tokens, cost_usd_micros, cost_basis, error_code, output")
        .eq("run_id", runId).order("position").order("item_index"),
    ]);
    if (!run) return { ok: false, error: "not_found" };
    const active = run.status === "queued" || run.status === "running";
    const driving = Boolean(run.locked_until && new Date(run.locked_until).getTime() > Date.now());
    if (active && !driving) driveAfterResponse(supabase, runId, Date.now());

    const imagePaths: string[] = [];
    const parsed = (steps ?? []).map((st) => {
      const v = parseStepValue(st.output);
      if (v?.kind === "image") imagePaths.push(v.image.path);
      return { st, v };
    });
    const outputs = ((run.outputs ?? []) as { path?: string }[]).map((o) => o.path).filter((p): p is string => Boolean(p));
    const allPaths = [...new Set([...imagePaths, ...outputs])];
    const { data: signed } = allPaths.length
      ? await supabase.storage.from("generation-assets").createSignedUrls(allPaths, 900)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urlOf = new Map((signed ?? []).map((u) => [u.path, u.signedUrl]));
    const view: TestStepView[] = parsed.map(({ st, v }) => ({
      position: st.position, item: st.item_index, name: st.step_name, operation: st.operation, status: st.status,
      attempts: st.attempts, ms: st.duration_ms, provider: st.provider_slug, model: st.model,
      inputTokens: st.input_tokens === null ? null : Number(st.input_tokens),
      outputTokens: st.output_tokens === null ? null : Number(st.output_tokens),
      costUsdMicros: st.cost_usd_micros === null ? null : Number(st.cost_usd_micros),
      costKnown: st.cost_basis !== "unknown", error: st.error_code,
      text: v && v.kind !== "image" ? (renderValue(v) ?? "").slice(0, 4000) : null,
      imageUrl: v?.kind === "image" ? urlOf.get(v.image.path) ?? null : null,
    }));
    const closed = view.filter((x) => x.status === "succeeded" || x.status === "failed");
    const sum = (k: "inputTokens" | "outputTokens") => closed.reduce((a, x) => a + (x[k] ?? 0), 0);
    const unknownNow = closed.filter((x) => !x.costKnown).length;
    return {
      ok: true,
      run: {
        id: run.id, status: run.status, error: run.error, version: run.workflow_version,
        expected: run.expected_outputs ?? 1, delivered: outputs.length,
        durationMs: run.duration_ms ?? (active ? Date.now() - new Date(run.created_at).getTime() : null),
        costUsdMicros: active ? closed.reduce((a, x) => a + (x.costUsdMicros ?? 0), 0) : run.api_cost_usd_micros === null ? null : Number(run.api_cost_usd_micros),
        costUnknown: active ? unknownNow : run.cost_unknown,
        tokensIn: sum("inputTokens"), tokensOut: sum("outputTokens"), driving,
        steps: view, results: outputs.map((p) => urlOf.get(p)).filter((u): u is string => Boolean(u)),
      },
    };
  } catch { return { ok: false, error: "generic" }; }
}

/** The tool's own image model (what a step that names none runs on). */
async function toolImageModel(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], toolKey: string):
  Promise<{ id: string; fallbackId: string | null; resolutions: string[] } | null> {
  if (toolKey === "retouch") {
    const m = await retouchModel(supabase);
    return m ? { id: m.id, fallbackId: m.fallbackId, resolutions: m.resolutions } : null;
  }
  if (toolKey.startsWith("fashion_")) {
    const m = await fashionModel(supabase);
    return m ? { id: m.id, fallbackId: null, resolutions: m.resolutions } : null;
  }
  return null;
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
    const { data: tool } = await supabase.from("ai_tools").select("engine_mode, workflow_enabled").eq("tool_key", toolKey).maybeSingle();
    const mode = (tool?.engine_mode ?? "off") as string;
    const supported = (TOOL_ENGINE_MODES[toolKey] as readonly string[]).includes(mode);
    checks.push({ key: "mode", status: supported ? "ok" : "fail", params: { mode } });
    if (mode === "off") {
      checks.push({ key: "noEngine", status: "ok" });
      return { ok: true, checks };
    }

    const templates: { text: string; defs: VariableDef[]; label: string }[] = [];
    let usesAnalyzeSteps = false;
    const stepModels: string[] = [];
    if (tool?.workflow_enabled) {
      const { data: wf } = await supabase.from("ai_tool_workflows")
        .select("id, version").eq("tool_key", toolKey).eq("status", "published").maybeSingle();
      if (!wf) {
        checks.push({ key: "workflowMissing", status: "fail" });
      } else {
        const read = await readWorkflowAction(wf.id);
        if (!read.ok || !read.steps) {
          checks.push({ key: "decrypt", status: "fail" });
        } else {
          const steps = read.steps;
          checks.push({ key: "workflowPublished", status: "ok", params: { version: wf.version, steps: steps.length } });
          steps.forEach((st, i) => {
            if (st.prompt.trim()) templates.push({ text: st.prompt, defs: stepVariables(toolKey, steps, i), label: `${i + 1}` });
            if (st.operation === "ai_text" && st.enabled) usesAnalyzeSteps = true;
            for (const id of [st.modelId, st.fallbackModelId]) if (id) stepModels.push(id);
          });
        }
      }
    }
    {
      const { data: p } = await supabase.from("ai_tool_prompts")
        .select("version, body_encrypted, body_iv, body_tag").eq("tool_key", toolKey).eq("status", "published").maybeSingle();
      if (!p) {
        const builtIn = toolKey === "retouch" || toolKey === "prompts" || toolKey === "generator";
        checks.push({ key: builtIn ? "builtInUsed" : "promptMissing", status: builtIn || tool?.workflow_enabled ? "warn" : "fail" });
      } else {
        const body = openPrompt(await promptKeyring(supabase), p)?.text ?? null;
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
    if (stepModels.length) {
      const usable = await getUsableModels(supabase);
      for (const id of [...new Set(stepModels)]) {
        const m = usable.find((u) => u.id === id);
        checks.push({ key: "modelOverride", status: m ? "ok" : "fail", params: { model: m?.display_name || m?.name || id } });
      }
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
      const ring = await adminPromptKeyring(supabase);
      if (!ring.canSeal) return { ok: false, error: "prompt_key_unavailable" };
      const hint = buildHintCiphertext(ring, {
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
