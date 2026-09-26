import "server-only";
import type { Client } from "@/lib/services/workspace";
import { effectiveQuality, priceFor, type ReferenceImage, type AiModelRecord } from "@/lib/ai/types";
import type { VisionBackend } from "@/lib/ai/engine/vision";
import { appendCustomerBlock, workflowVariables, type CompileValues } from "@/lib/ai/prompt-variables";
import type { RuntimeWorkflow } from "@/lib/server/ai-engine";
import { runGeneration, type GenerateInput, type GenerateOutput } from "@/lib/server/generation";
import {
  compileForTool, orderBackends, recordEngineRun, resolveVariables, runAnalyzeStep,
  type ResolveContext, type StepTrace,
} from "@/lib/server/engine/runtime";

/**
 * WORKFLOW EXECUTION — 1..N steps, ONE customer run, ONE charge.
 *
 * The definition comes from the server (the published version, read once at
 * the start, so a publish mid-run changes nothing for this run). The customer
 * cannot reorder steps, pick a prompt, pick a model or provider, or inject a
 * variable: the only customer inputs are the photos and the hint the tool
 * already accepted, and the hint is DATA.
 *
 *   analyze steps   text/vision calls (real system role). Their retries are
 *                   internal and never reach the ledger.
 *   image step      always the last step. It goes through `runGeneration`,
 *                   which reserves credits exactly once, with the Product Lock
 *                   fidelity block attached as on every generation.
 *
 * A step that fails, or a required variable that cannot be resolved, stops
 * the run BEFORE the image step — i.e. before any charge.
 */

export type WorkflowRunInput = {
  toolKey: string;
  workflow: RuntimeWorkflow;
  /** The seller's hint, already capped by the tool. Untrusted data. */
  hint: string;
  /** Tool-level resolve context (base values, photos, backends, knowledge). */
  resolve: Omit<ResolveContext, "base"> & { base: CompileValues };
  /** Everything the image step passes to runGeneration except the prompt. */
  generation: Omit<GenerateInput, "prompt">;
  /** The credits the tool will reserve, for the pre-check before any step. */
  expectedCost: number;
  userId: string;
};

export type WorkflowRunOutput =
  | { ok: true; result: Extract<GenerateOutput, { ok: true }> }
  | { ok: false; error: string; missingCredits?: number };

export async function runImageWorkflow(supabase: Client, input: WorkflowRunInput): Promise<WorkflowRunOutput> {
  const started = Date.now();
  const { workflow, resolve } = input;
  const steps = workflow.steps;
  const imageStep = steps[steps.length - 1];
  const trace: StepTrace[] = [];
  const record = (status: "ok" | "failed" | "blocked", extra: {
    error?: string; jobId?: string | null; credits?: number | null;
    knowledge?: { ids: string[]; scene: string | null };
  } = {}) => recordEngineRun(supabase, {
    toolKey: input.toolKey, workspaceId: resolve.workspaceId, userId: input.userId,
    mode: "workflow", status, error: extra.error ?? null, jobId: extra.jobId ?? null,
    workflowId: workflow.id, workflowVersion: workflow.version,
    modelId: imageStep?.modelId ?? input.generation.modelId,
    steps: trace, knowledgeExampleIds: extra.knowledge?.ids ?? [],
    sceneExampleId: extra.knowledge?.scene ?? null,
    credits: extra.credits ?? null, durationMs: Date.now() - started,
  });

  // Defence in depth: the SQL save function already refuses these shapes.
  if (!imageStep || imageStep.operation !== "generate_image" || !imageStep.enabled
    || steps.slice(0, -1).some((s) => s.operation !== "analyze")) {
    await record("blocked", { error: "workflow_invalid" });
    return { ok: false, error: "prompt_unconfigured" };
  }

  // A MODEL OVERRIDE ON THE IMAGE STEP must not change what the customer was
  // quoted: the tool's panel priced its own model. An override that cannot
  // render the chosen size, or would cost more than the quote, is refused
  // here — before any analysis and before any charge.
  if (imageStep.modelId && imageStep.modelId !== input.generation.modelId) {
    const { data: model } = await supabase.from("ai_models")
      .select("id, active, pricing, credit_cost, metadata, supported_resolutions, supported_aspect_ratios")
      .eq("id", imageStep.modelId).maybeSingle();
    const res = input.generation.resolution ?? "1K";
    // Priced exactly the way runGeneration will price it (effective quality,
    // quantity), and able to draw the framing the tool already chose.
    const priced = model as unknown as Pick<AiModelRecord, "pricing" | "credit_cost" | "metadata">;
    const quality = model ? effectiveQuality(priced as never, input.generation.quality ?? undefined) ?? null : null;
    const fits = model?.active && (model.supported_resolutions ?? ["1K"]).includes(res)
      && (model.supported_aspect_ratios ?? []).includes(input.generation.aspectRatio)
      && priceFor(priced, res, quality) * Math.max(1, input.generation.quantity ?? 1) <= input.expectedCost;
    if (!fits) {
      await record("blocked", { error: "model_override_mismatch" });
      return { ok: false, error: "model_unavailable" };
    }
  }

  // Spend nothing on analysis for a customer who cannot pay for the result.
  const { data: wallet } = await supabase
    .from("credit_wallets").select("balance").eq("workspace_id", resolve.workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };
  if (wallet.balance < input.expectedCost) {
    return { ok: false, error: "insufficient_credits", missingCredits: input.expectedCost - wallet.balance };
  }

  // Resolve the shared variables once, for every step's template together:
  // one knowledge retrieval, one product analysis at most.
  const resolved = await resolveVariables(steps.map((s) => s.prompt), resolve);
  const knowledge = resolved.knowledge
    ? { ids: resolved.knowledge.exampleIds, scene: resolved.knowledge.sceneExampleId } : undefined;
  const values: CompileValues = { ...resolved.values };

  let images: ReferenceImage[] | null = null;
  const getImages = async () => (images ??= await resolve.images());
  let backends: VisionBackend[] | null = null;
  const getBackends = async () => (backends ??= await resolve.backends());

  let previous: string | null = null;
  for (const step of steps) {
    const n = step.position;
    const t0 = Date.now();
    const defs = workflowVariables(input.toolKey, n);

    if (!step.enabled) {
      trace.push({ n, name: step.name, op: step.operation, status: "skipped", ms: 0, attempts: 0, reason: "disabled" });
      continue;
    }
    const conditionMet = step.condition === "always"
      || (step.condition === "if_hint" && input.hint.trim().length > 0)
      || (step.condition === "if_previous_nonempty" && Boolean(previous?.trim()));
    if (!conditionMet && step.operation === "analyze") {
      trace.push({ n, name: step.name, op: step.operation, status: "skipped", ms: 0, attempts: 0, reason: "condition" });
      continue;
    }

    const compiled = compileForTool(step.prompt, defs, { ...values, previous });
    if (!compiled.ok) {
      trace.push({ n, name: step.name, op: step.operation, status: "failed", ms: Date.now() - t0, attempts: 0, error: compiled.error });
      await record("blocked", { error: compiled.error, knowledge });
      return { ok: false, error: compiled.error === "variable_missing" ? "variable_missing" : "prompt_unconfigured" };
    }

    if (step.operation === "analyze") {
      const stepBackends = orderBackends(await getBackends(), step.textProvider);
      const out = await runAnalyzeStep(stepBackends, {
        instruction: compiled.text,
        images: step.useImages ? await getImages() : [],
        timeoutMs: step.timeoutMs,
        maxAttempts: step.maxAttempts,
      });
      if (!out.ok) {
        trace.push({ n, name: step.name, op: step.operation, status: "failed", ms: Date.now() - t0, attempts: out.attempts, error: out.error });
        await record("failed", { error: `step${n}:${out.error}`, knowledge });
        return { ok: false, error: "workflow_step_failed" };
      }
      trace.push({ n, name: step.name, op: step.operation, status: "ok", ms: Date.now() - t0, attempts: out.attempts });
      values[`step${n}`] = out.output || null;
      previous = out.output || null;
      continue;
    }

    // THE IMAGE STEP — the only billed call. The hint rides as a separated
    // DATA block unless the admin placed {{hint}} in the template already.
    const usesHint = /\{\{\s*hint\b/.test(step.prompt);
    const prompt = usesHint ? compiled.text : appendCustomerBlock(compiled.text, "wskazówka sprzedawcy", input.hint, 1000);
    const result = await runGeneration(supabase, input.userId, resolve.workspaceId, {
      ...input.generation,
      modelId: step.modelId ?? input.generation.modelId,
      prompt,
      hidePromptText: true,
    });
    trace.push({
      n, name: step.name, op: step.operation, status: result.ok ? "ok" : "failed",
      ms: Date.now() - t0, attempts: 1, error: result.ok ? undefined : result.error,
    });
    if (!result.ok) {
      await record("failed", { error: result.error, knowledge });
      return result;
    }
    await record("ok", { jobId: result.jobId, credits: result.credits, knowledge });
    return { ok: true, result };
  }
  // Unreachable: the last step is the image step and always returns.
  await record("blocked", { error: "workflow_invalid" });
  return { ok: false, error: "prompt_unconfigured" };
}
