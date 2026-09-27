import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import type { AspectRatio, Quality, ReferenceImage, Resolution } from "@/lib/ai/types";
import type { VisionBackend } from "@/lib/ai/engine/vision";
import type { KnowledgeStrategy } from "@/lib/ai/knowledge-ranking";
import {
  TOOL_VARIABLES, appendCustomerBlock, workflowVariables, type CompileValues, type VariableDef,
} from "@/lib/ai/prompt-variables";
import {
  finalStepIndex, imageProducing, maxOutputsOf, stepVariables, validateWorkflow, type WorkflowStepDef,
} from "@/lib/ai/workflow-def";
import {
  imagesOf, iterate, parseStepValue, renderValue, toJson, type ImageRef, type StepValue,
} from "@/lib/ai/workflow-values";
import { sumKnownCosts } from "@/lib/ai/usage-cost";
import { startUsage, completeUsage, failUsage } from "@/lib/services/usage";
import { dispatchToken } from "@/lib/server/integrations";
import { downloadReferences, textCapableBackends } from "@/lib/server/prompt-engine";
import { readTokenPrices, readUnitPrices, recordProviderCalls, textMeter } from "@/lib/server/ai-usage";
import { compileForTool, ENGINE_RUNTIME_VERSION, resolveVariables } from "@/lib/server/engine/runtime";
import {
  beginStep, claimRun, createRun, finishStep, loadWorkflow, patchRun, readRun, readStepRuns,
  type LoadedWorkflow, type RunRow, type StepRunRow,
} from "@/lib/server/engine/workflow-store";
import {
  loadImage, runImageStep, runTextStep, runToolStep, type ExecContext, type ExecResult,
} from "@/lib/server/engine/workflow-exec";

/**
 * WORKFLOW RUNTIME v2 — one customer click, one run, ONE charge.
 *
 *   start   validate the published version, check the wallet, create the job,
 *           charge ONCE through the ledger (tool price × the most results the
 *           workflow can deliver), create the persistent run pinned to that
 *           exact workflow version. Nothing has been sent to a provider yet.
 *   drive   one invocation's worth of work: claim the run's lease (a second
 *           poller cannot drive it at the same time), walk the steps IN ORDER,
 *           fan FOR EACH items out in parallel under a concurrency cap, and
 *           record every step / item as it finishes. A step that already
 *           succeeded is never executed again — its stored output is reused —
 *           so a resumed run never pays a provider twice for the same work.
 *           When the invocation's time runs out the lease is released and the
 *           next poll resumes exactly where this one stopped.
 *   finish  store the final images as the job's results, refund what was not
 *           delivered (all of it if nothing was), close the usage event with
 *           the provider/model that REALLY produced the images and the real
 *           summed cost of every step.
 *
 * The runtime works in the CUSTOMER's session because the ledger requires it;
 * runs and step runs are admin-read and reached only through the server token.
 * The customer sees status, progress and their images — never a step, a
 * prompt, a model or a step output.
 *
 * Infrastructure time and AI time are different things: an invocation has a
 * hard ceiling (the platform's function limit), a step does not share it — a
 * slow provider call is not cut short to fit a request, the run simply
 * continues in the next invocation.
 */

export type WorkflowRunKind = "workflow" | "workflow_test";

export type WorkflowStartInput = {
  toolKey: string;
  workflow: LoadedWorkflow;
  /** The seller's hint (already capped by the tool). Untrusted data. */
  hint: string;
  /** Storage paths in `product-images`, verified by the route. */
  referencePaths: string[];
  aspectRatio: AspectRatio;
  resolution: Resolution | null;
  quality: Quality | null;
  toolModelId: string;
  toolFallbackId: string | null;
  /** Credits for ONE delivered result — the tool's own price. */
  unitCredits: number;
  /** `generation_jobs.settings.operation`, so the tool's gallery lists it. */
  operation: string;
  knowledgeStrategy: KnowledgeStrategy;
  /** Admin test: no ledger, no job; images land in a test folder. */
  test?: boolean;
  /** The result count the customer's panel quoted (and priced). A publish
   *  between page load and click must not charge more than was shown. */
  quotedOutputs?: number;
};

export type WorkflowStartOutput =
  | { ok: true; runId: string; jobId: string | null; credits: number; expected: number }
  | { ok: false; error: string; missingCredits?: number };

/** Same 5-minute tumbling bucket as a generation's duplicate-submit key. */
const DEDUPE_WINDOW_MS = 5 * 60_000;

export async function startWorkflowRun(
  supabase: Client, userId: string, workspaceId: string, input: WorkflowStartInput,
): Promise<WorkflowStartOutput> {
  const wf = input.workflow;
  const finalIdx = finalStepIndex(wf.steps);
  if (finalIdx < 0 || !imageProducing(wf.steps[finalIdx])) return { ok: false, error: "prompt_unconfigured" };
  // Defence in depth: the save path validated it; a v1 definition keeps its
  // own (older) rules and was validated by the 0126 save function.
  if (!wf.legacy && !validateWorkflow(input.toolKey, { steps: wf.steps, concurrency: wf.concurrency }).ok) {
    return { ok: false, error: "prompt_unconfigured" };
  }
  const expected = maxOutputsOf(wf.steps[finalIdx]);
  if (!input.test && input.quotedOutputs !== undefined && input.quotedOutputs !== expected) {
    return { ok: false, error: "price_changed" };
  }
  const credits = input.test ? 0 : Math.max(0, Math.trunc(input.unitCredits)) * expected;

  const runInput = {
    reference_paths: input.referencePaths.slice(0, 10),
    hint: input.hint.slice(0, 1000),
    aspect_ratio: input.aspectRatio, resolution: input.resolution, quality: input.quality,
    tool_model_id: input.toolModelId, tool_fallback_id: input.toolFallbackId,
    unit_credits: input.test ? 0 : Math.max(0, Math.trunc(input.unitCredits)),
    operation: input.operation, knowledge_strategy: input.knowledgeStrategy,
  };

  if (input.test) {
    const folder = randomUUID();
    const run = await createRun(supabase, {
      tool_key: input.toolKey, workspace_id: workspaceId, user_id: userId, run_kind: "workflow_test",
      idempotency_key: `wft:${folder}`, engine_version: ENGINE_RUNTIME_VERSION,
      workflow_id: wf.id, workflow_version: wf.version, expected_outputs: expected, credits: 0,
      input: { ...runInput, storage_prefix: `${workspaceId}/wf-test/${folder}` },
    });
    return run ? { ok: true, runId: run.id, jobId: null, credits: 0, expected } : { ok: false, error: "run_create_failed" };
  }

  const { data: wallet } = await supabase
    .from("credit_wallets").select("id, balance").eq("workspace_id", workspaceId).maybeSingle();
  if (!wallet) return { ok: false, error: "no_wallet" };
  if (wallet.balance < credits) return { ok: false, error: "insufficient_credits", missingCredits: credits - wallet.balance };

  const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
    workspace_id: workspaceId, user_id: userId, model_id: input.toolModelId,
    // GrovBase's workflow is GrovBase's: no prompt text on the job row.
    prompt_text: null, negative_prompt: null, aspect_ratio: input.aspectRatio, quantity: expected,
    resolution: input.resolution, prompt_origin: "ecomstudio",
    status: "processing", started_at: new Date().toISOString(),
    reference_image_ids: [],
    settings: {
      operation: input.operation, resolution: input.resolution, quality: input.quality,
      reference_paths: runInput.reference_paths, workflow: true,
    } as never,
  }).select("id").single();
  if (jobError || !job) return { ok: false, error: "job_create_failed" };

  // THE ONE CHARGE. Derived from what the request means (tool, workflow
  // version, photos, hint, format), so a double submit is one charge and one
  // run; the ledger's unique key is the arbiter.
  const digest = createHash("sha256").update(JSON.stringify([
    input.toolKey, wf.id, wf.version, runInput.reference_paths, runInput.hint,
    input.aspectRatio, input.resolution, input.quality, credits,
  ])).digest("hex").slice(0, 40);
  const usage = await startUsage(supabase, {
    serverToken: dispatchToken(),
    userId, workspaceId, walletId: wallet.id, serviceSlug: "image_generation",
    generationJobId: job.id,
    idempotencyKey: `wf:${workspaceId}:${Math.floor(Date.now() / DEDUPE_WINDOW_MS)}:${digest}`,
    // `quantity` is what the reconciler compares delivered results against if
    // this run is ever abandoned mid-way (refund pro rata, never a free run).
    metadata: {
      quantity: expected, operation: input.operation, workflow_id: wf.id, workflow_version: wf.version,
      prompt_origin: "ecomstudio",
    },
    creditsCharged: credits,
  });
  if (!usage.ok) {
    await supabase.from("generation_jobs").update({ status: "failed", error_message: usage.error }).eq("id", job.id);
    return { ok: false, error: usage.error === "duplicate_request" ? "already_running" : usage.error };
  }

  const run = await createRun(supabase, {
    tool_key: input.toolKey, workspace_id: workspaceId, user_id: userId, job_id: job.id,
    run_kind: "workflow", idempotency_key: `run:${usage.eventId}`, usage_event_id: usage.eventId,
    engine_version: ENGINE_RUNTIME_VERSION, workflow_id: wf.id, workflow_version: wf.version,
    expected_outputs: expected, credits,
    input: { ...runInput, storage_prefix: `${workspaceId}/${job.id}/wf` },
  });
  if (!run) {
    await failUsage(supabase, { serverToken: dispatchToken(), eventId: usage.eventId, walletId: wallet.id, error: "run_create_failed" });
    await supabase.from("generation_jobs").update({ status: "failed", error_message: "run_create_failed" }).eq("id", job.id);
    return { ok: false, error: "run_create_failed" };
  }
  await supabase.rpc("log_activity", {
    p_workspace_id: workspaceId, p_action: "workflow.run_started",
    p_entity_type: "generation_job", p_entity_id: job.id,
    p_metadata: { tool: input.toolKey, workflow_version: wf.version, expected, credits },
  });
  return { ok: true, runId: run.id, jobId: job.id, credits, expected };
}

/* ── drive ────────────────────────────────────────────────────────────────*/

export type DriveStatus = "queued" | "running" | "ok" | "partial" | "failed" | "blocked" | "busy" | "not_found";

type RunInput = {
  reference_paths: string[]; hint: string; aspect_ratio: AspectRatio; resolution: Resolution | null;
  quality: Quality | null; tool_model_id: string; tool_fallback_id: string | null; unit_credits: number;
  operation: string; knowledge_strategy: KnowledgeStrategy; storage_prefix: string;
};

/** Below this much time left, no new step or item is started in this call. */
const MIN_START_MS = 30_000;

function readInput(raw: Json): RunInput | null {
  const v = (raw ?? {}) as Record<string, unknown>;
  if (typeof v.tool_model_id !== "string" || typeof v.storage_prefix !== "string" || typeof v.aspect_ratio !== "string") return null;
  return {
    reference_paths: Array.isArray(v.reference_paths) ? v.reference_paths.filter((x): x is string => typeof x === "string") : [],
    hint: typeof v.hint === "string" ? v.hint : "",
    aspect_ratio: v.aspect_ratio as AspectRatio,
    resolution: typeof v.resolution === "string" ? v.resolution as Resolution : null,
    quality: typeof v.quality === "string" ? v.quality as Quality : null,
    tool_model_id: v.tool_model_id,
    tool_fallback_id: typeof v.tool_fallback_id === "string" ? v.tool_fallback_id : null,
    unit_credits: typeof v.unit_credits === "number" ? v.unit_credits : 0,
    operation: typeof v.operation === "string" ? v.operation : "",
    knowledge_strategy: v.knowledge_strategy === "diverse" ? "diverse" : "proven",
    storage_prefix: v.storage_prefix,
  };
}

/** Run `fn` over `items` with at most `limit` in flight. Order-preserving. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Drive a run for one invocation. Safe to call from any number of requests at
 * once — only the lease holder does work; the others return `busy`.
 */
export async function driveWorkflowRun(
  supabase: Client, runId: string, opts: { deadlineAt: number },
): Promise<DriveStatus> {
  const owner = `inv:${randomUUID()}`;
  const leaseSeconds = Math.ceil(Math.max(10_000, opts.deadlineAt - Date.now()) / 1000) + 30;
  const claim = await claimRun(supabase, runId, owner, leaseSeconds);
  if (!claim.claimed) {
    if (claim.reason === "not_found") return "not_found";
    if (claim.reason === "finished") return (claim.status as DriveStatus) ?? "ok";
    return "busy";
  }
  const run = await readRun(supabase, runId);
  if (!run) return "not_found";
  const test = run.run_kind === "workflow_test";
  const input = readInput(run.input);
  const wf = input ? await loadWorkflow(supabase, run.tool_key, run.workflow_id) : null;
  if (!input || !wf || wf.version !== run.workflow_version) {
    return finishRun(supabase, run, owner, null, { images: [], error: "workflow_unavailable", test, input });
  }

  const [tokenPrices, unitPrices] = await Promise.all([readTokenPrices(supabase), readUnitPrices(supabase)]);
  let backendsCache: VisionBackend[] | null = null;
  const rawBackends = async () => (backendsCache ??= await textCapableBackends(supabase));
  let customerCache: ReferenceImage[] | null = null;
  const customerImages = async () => (customerCache ??= await downloadReferences(supabase, input.reference_paths));

  const ctx: ExecContext = {
    supabase, toolKey: run.tool_key, workspaceId: run.workspace_id ?? "", userId: run.user_id ?? "",
    runId, jobId: run.job_id, usageEventId: run.usage_event_id,
    consumer: test ? "workflow_test" : "workflow", actorKind: test ? "admin" : "customer",
    deadlineAt: opts.deadlineAt, storagePrefix: input.storage_prefix,
    aspectRatio: input.aspect_ratio, resolution: input.resolution, quality: input.quality,
    toolModelId: input.tool_model_id, toolFallbackId: input.tool_fallback_id,
    customerImages, backends: rawBackends, tokenPrices, unitPrices, trace: [],
  };

  // The tool's own variables (analysis, knowledge), resolved once per call:
  // the product analysis is cached per photo set and knowledge retrieval is
  // seeded by the run, so a resumed invocation resolves the same values.
  const meter = textMeter(supabase, {
    actorKind: ctx.actorKind, consumer: ctx.consumer, userId: ctx.userId, workspaceId: ctx.workspaceId,
    toolKey: run.tool_key, usageEventId: run.usage_event_id, jobId: run.job_id, runRef: runId,
  });
  // A variable a step PRODUCES (product_analysis) is never resolved
  // automatically as well: its references are the step's output.
  const produced = new Set(wf.steps.map((s) => s.outputName));
  const unshadowed = (p: string) => p.replace(/\{\{\s*([a-z][a-z0-9_]*)[^}]*\}\}/g, (m, name: string) => (produced.has(name) ? "" : m));
  const resolved = await resolveVariables(wf.steps.map((s) => unshadowed(s.prompt)), {
    supabase, workspaceId: ctx.workspaceId, toolKey: run.tool_key, strategy: input.knowledge_strategy,
    seed: `${run.tool_key}:${runId}`, referencePaths: input.reference_paths,
    images: customerImages, backends: async () => meter.wrap(await rawBackends()),
    knowledgeQuery: [run.tool_key.replace(/_/g, " "), input.hint].filter(Boolean).join("\n"),
    base: {
      tool_name: run.tool_key, aspect_ratio: input.aspect_ratio, resolution: input.resolution,
      image_count: String(input.reference_paths.length), hint: input.hint || null,
    },
  });
  await meter.flush();
  if (resolved.knowledge?.exampleIds.length) {
    await patchRun(supabase, runId, owner, { knowledge_example_ids: resolved.knowledge.exampleIds });
  }

  try {
    const outcome = await walkSteps(ctx, run, wf, owner, resolved.values, input.hint);
    if (outcome.kind === "yield") {
      // Out of time: release nothing — the lease simply runs out — and let
      // the next poll pick it up. Progress is already recorded.
      return "running";
    }
    return await finishRun(supabase, run, owner, wf, { images: outcome.images, error: outcome.error, test, input, ctx });
  } finally {
    await recordProviderCalls(supabase, ctx.trace.splice(0));
  }
}

type WalkOutcome =
  | { kind: "yield" }
  | { kind: "done"; images: { ref: ImageRef; provider: string | null; model: string | null }[]; error: string | null };

async function walkSteps(
  ctx: ExecContext, run: RunRow, wf: LoadedWorkflow, owner: string, toolValues: CompileValues, hint: string,
): Promise<WalkOutcome> {
  const steps = wf.steps;
  const finalIdx = finalStepIndex(steps);
  const expected = run.expected_outputs ?? maxOutputsOf(steps[finalIdx]);
  const existing = new Map<string, StepRunRow>();
  for (const r of await readStepRuns(ctx.supabase, run.id)) existing.set(`${r.position}:${r.item_index}`, r);

  const outputs = new Map<string, StepValue>();
  let previous: string | null = null;
  const hintSupported = (TOOL_VARIABLES[run.tool_key] ?? []).some((d) => d.key === "hint");
  const leaseSeconds = () => Math.ceil(Math.max(10_000, ctx.deadlineAt - Date.now()) / 1000) + 10;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const position = i + 1;
    if (!step.enabled) continue;
    await patchRun(ctx.supabase, run.id, owner, {
      progress: { step: position, steps: steps.length, done: 0, total: expected, failed: 0 },
      lease_seconds: leaseSeconds(),
    });

    // v1 conditions keep their meaning.
    const conditionMet = step.condition === "always"
      || (step.condition === "if_hint" && hint.trim().length > 0)
      || (step.condition === "if_previous_nonempty" && Boolean(previous?.trim()));
    if (!conditionMet && step.operation === "ai_text") continue;

    const defs: VariableDef[] = wf.legacy ? workflowVariables(run.tool_key, position) : stepVariables(run.tool_key, steps, i);
    const values: CompileValues = { ...toolValues, previous };
    for (const [name, v] of outputs) values[name] = renderValue(v);

    /** ONE unit of work: the step, or one FOR EACH item. */
    const unit = async (itemIndex: number, item: StepValue | null): Promise<"yield" | StepValue | null> => {
      const key = `${position}:${itemIndex}`;
      const prior = existing.get(key);
      if (prior?.status === "succeeded") return parseStepValue(prior.output);
      if (prior?.status === "failed" || prior?.status === "skipped") return null;
      if (ctx.deadlineAt - Date.now() < MIN_START_MS) return "yield";

      const begun = await beginStep(ctx.supabase, run.id, owner, position, itemIndex, step.name, step.operation, leaseSeconds());
      if (begun.state === "done") return parseStepValue(begun.output);
      if (begun.state === "failed" || begun.state === "skipped") return null;
      if (begun.state !== "run") return "yield";

      const started = Date.now();
      // RESUME BUDGET. Every begin is counted by the database; a step that keeps
      // being resumed (each time a paid provider call) is failed once it has
      // used its attempts plus two resumes — never retried forever.
      if (begun.attempts >= Math.max(1, step.maxAttempts) + 2) {
        await finishStep(ctx.supabase, run.id, owner, position, itemIndex, {
          status: "failed", attempts: begun.attempts, cost: { basis: "estimated", usdMicros: 0 },
          errorCode: "resume_limit", durationMs: 0,
        });
        return null;
      }
      const result = await executeUnit(ctx, step, i, defs, { ...values, ...(step.itemName && item ? { [step.itemName]: renderValue(item) } : {}) },
        item, outputs, hint, hintSupported, itemIndex);
      if (!result.ok && result.retryLater) return "yield";
      const recorded = await finishStep(ctx.supabase, run.id, owner, position, itemIndex, {
        status: result.ok ? "succeeded" : "failed",
        attempts: result.attempts,
        providerSlug: result.providerSlug, model: result.model,
        inputTokens: result.ok ? result.inputTokens : null, outputTokens: result.ok ? result.outputTokens : null,
        units: result.ok ? result.units : null, unitKind: result.ok ? result.unitKind : null,
        cost: result.cost, errorCode: result.ok ? null : result.error,
        output: result.ok ? toJson(result.value) : null,
        durationMs: Date.now() - started,
      });
      // Not recorded = this invocation lost the run's lease (another driver
      // owns it now): stop here, the owner carries on from the stored state.
      if (!recorded) return "yield";
      return result.ok ? result.value : null;
    };

    let value: StepValue | null;
    if (step.forEach !== null) {
      // FAN-OUT: one child per item of the earlier collection, in parallel
      // under the workflow's concurrency cap; each child has its own
      // idempotent step-run row (run, position, item) — never two for one item.
      const items = iterate(outputs.get(step.forEach), step.maxItems ?? 1);
      if (items.length === 0) return { kind: "done", images: [], error: "workflow_input_missing" };
      const results = await pool(items, wf.concurrency, (item, idx) => unit(idx, item));
      if (results.some((r) => r === "yield")) return { kind: "yield" };
      const collected = results.map((r) => (r === "yield" ? null : r));
      const failed = collected.filter((r) => r === null).length;
      if (failed > 0 && (step.onItemError === "fail_run" || failed === collected.length)) {
        if (step.onError === "stop" || i === finalIdx) return { kind: "done", images: [], error: "workflow_step_failed" };
        continue;
      }
      value = { kind: "collection", items: collected };
    } else {
      const r = await unit(-1, null);
      if (r === "yield") return { kind: "yield" };
      if (r === null) {
        if (step.onError === "stop" || i === finalIdx) return { kind: "done", images: [], error: "workflow_step_failed" };
        continue;
      }
      value = r;
    }
    outputs.set(step.outputName, value);
    previous = renderValue(value);
  }

  // THE RESULT is the last enabled step's images, with the executor that
  // made each one (read back from the step runs — the recorded truth).
  const finalValue = outputs.get(steps[finalIdx].outputName);
  const finalRows = (await readStepRuns(ctx.supabase, run.id)).filter((r) => r.position === finalIdx + 1 && r.status === "succeeded");
  const images: { ref: ImageRef; provider: string | null; model: string | null }[] = [];
  const list = finalValue?.kind === "collection" ? finalValue.items : finalValue ? [finalValue] : [];
  list.forEach((v, idx) => {
    if (v?.kind !== "image") return;
    const row = finalRows.find((r) => r.item_index === (finalValue?.kind === "collection" ? idx : -1));
    images.push({ ref: v.image, provider: row?.provider_slug ?? null, model: row?.model ?? null });
  });
  return { kind: "done", images: images.slice(0, expected), error: images.length ? null : "workflow_no_result" };
}

/** Compile the step's instruction, collect its image input, dispatch. */
async function executeUnit(
  ctx: ExecContext, step: WorkflowStepDef, index: number, defs: VariableDef[],
  values: CompileValues, item: StepValue | null, outputs: Map<string, StepValue>,
  hint: string, hintSupported: boolean, itemIndex: number,
): Promise<ExecResult> {
  const fail = (error: string): ExecResult =>
    ({ ok: false, error, retryLater: false, attempts: 0, providerSlug: null, model: null, cost: { basis: "estimated", usdMicros: 0 } });

  // A REQUIRED INPUT THAT IS MISSING STOPS HERE — before any provider call.
  let instruction = "";
  if (step.prompt.trim()) {
    const compiled = compileForTool(step.prompt, defs, values);
    if (!compiled.ok) return fail(compiled.error === "variable_missing" ? "variable_missing" : "prompt_unconfigured");
    instruction = compiled.text;
  } else if (step.operation !== "tool") {
    return fail("prompt_unconfigured");
  }

  // The image(s) this step works on.
  let refs: ReferenceImage[] = [];
  if (step.inputImage === "customer") {
    refs = await ctx.customerImages();
    if (refs.length === 0 && step.operation !== "ai_text" && step.operation !== "image_generation") return fail("input_missing");
  } else if (step.inputImage !== "none") {
    const source = step.forEach !== null && step.inputImage === step.itemName ? item : outputs.get(step.inputImage) ?? null;
    const images = imagesOf(source);
    if (images.length === 0) return fail("input_missing");
    const loaded = await Promise.all(images.slice(0, 6).map((r) => loadImage(ctx.supabase, r)));
    refs = loaded.filter((x): x is ReferenceImage => x !== null);
    if (refs.length === 0) return fail("input_missing");
  }

  const outputName = `s${index + 1}${itemIndex >= 0 ? `-${itemIndex}` : ""}`;
  if (step.operation === "ai_text") return runTextStep(ctx, step, instruction, refs);
  if (step.operation === "tool") {
    if (refs.length === 0) return fail("input_missing");
    return runToolStep(ctx, step, refs[0], outputName, values);
  }
  // The seller's hint rides as a separated DATA block unless the admin placed
  // {{hint}} in the instruction already.
  const prompt = hintSupported && !/\{\{\s*hint\b/.test(step.prompt)
    ? appendCustomerBlock(instruction, "wskazówka sprzedawcy", hint, 1000) : instruction;
  return runImageStep(ctx, step, prompt, refs, outputName);
}

/* ── finish ───────────────────────────────────────────────────────────────*/

async function finishRun(
  supabase: Client, run: RunRow, owner: string, wf: LoadedWorkflow | null,
  r: {
    images: { ref: ImageRef; provider: string | null; model: string | null }[];
    error: string | null; test: boolean; input: RunInput | null; ctx?: ExecContext;
  },
): Promise<DriveStatus> {
  // Only the CURRENT lease holder closes a run: renewing the lease is the
  // proof. A driver that lost it does nothing — no assets, no ledger call.
  if (!(await patchRun(supabase, run.id, owner, { lease_seconds: 120 }))) return "busy";

  // The charge must still be open. The stale-charge reconciler refunds a
  // pending event that shows nothing delivered; a run finished after that
  // must not hand over images for free.
  if (!r.test && run.usage_event_id) {
    const { data: ev } = await supabase.from("usage_events").select("status").eq("id", run.usage_event_id).maybeSingle();
    if (ev && ev.status !== "pending") {
      await patchRun(supabase, run.id, owner, { status: "failed", error: "charge_closed", outputs: [] });
      return "failed";
    }
  }

  const rows = await readStepRuns(supabase, run.id);
  const closed = rows.filter((x) => x.status === "succeeded" || x.status === "failed");
  // RUN COST = the sum of the real step costs. A step whose price is not
  // configured is counted as unknown — the run then says so; never 0.00.
  const costs = sumKnownCosts(closed.map((x) => (x.cost_basis === "unknown" || x.cost_usd_micros == null
    ? { basis: "unknown" as const } : { basis: "estimated" as const, usdMicros: Number(x.cost_usd_micros) })));
  // The admin trace: ONE entry per step (a fan-out as N/N), with the
  // executor(s) that really answered. Codes, names and numbers only.
  const byPosition = new Map<number, StepRunRow[]>();
  for (const x of rows) byPosition.set(x.position, [...(byPosition.get(x.position) ?? []), x]);
  const stepsTrace = [...byPosition.entries()].sort((a, b) => a[0] - b[0]).map(([n, list]) => {
    const ok = list.filter((x) => x.status === "succeeded").length;
    const fan = list.some((x) => x.item_index >= 0);
    return {
      n, name: list[0].step_name ?? list[0].operation, op: list[0].operation,
      status: ok === list.length ? "ok" : ok > 0 ? "partial" : list.every((x) => x.status === "skipped") ? "skipped" : "failed",
      ms: Math.max(0, ...list.map((x) => x.duration_ms ?? 0)),
      attempts: Math.max(0, ...list.map((x) => x.attempts)),
      items: fan ? `${ok}/${list.length}` : null,
      executors: [...new Set(list.map((x) => [x.provider_slug, x.model].filter(Boolean).join("/")).filter(Boolean))].slice(0, 4),
      error: list.find((x) => x.error_code)?.error_code ?? null,
    };
  });
  const expected = run.expected_outputs ?? 1;
  const delivered = r.images.length;
  const status: "ok" | "partial" | "failed" = delivered === 0 ? "failed" : delivered < expected ? "partial" : "ok";
  const durationMs = Date.now() - new Date(run.created_at).getTime();

  // WHO MADE THE RESULT: the final step's executor when every image agrees;
  // otherwise the provider alone when that agrees; otherwise unknown (the
  // step runs still hold each image's own executor).
  const providers = [...new Set(r.images.map((x) => x.provider))];
  const models = [...new Set(r.images.map((x) => x.model))];
  const executor = {
    providerSlug: providers.length === 1 ? providers[0] : null,
    modelSlug: providers.length === 1 && models.length === 1 ? models[0] : null,
  };

  if (!r.test && run.job_id && run.usage_event_id && r.input) {
    const token = dispatchToken();
    if (delivered === 0) {
      await failUsage(supabase, { serverToken: token, eventId: run.usage_event_id, walletId: "", error: r.error ?? "workflow_failed", apiCostUsdMicros: costs.usdMicros });
      await supabase.from("generation_jobs").update({
        status: "failed", error_message: r.error ?? "workflow_failed", error_class: r.error ?? "workflow_failed",
        latency_ms: durationMs, completed_at: new Date().toISOString(),
      }).eq("id", run.job_id);
      await supabase.from("notifications").insert({
        user_id: run.user_id ?? "", type: "generation_failed", title: "generation_failed", body: r.error ?? "workflow_failed", href: "/history",
      });
    } else {
      // The results, as ordinary generation assets of the job — idempotent:
      // a finisher that runs twice finds the rows it already wrote.
      const { data: existingGen } = await supabase.from("generations").select("id").eq("job_id", run.job_id).maybeSingle();
      const generation = existingGen ?? (await supabase.from("generations").insert({
        job_id: run.job_id, workspace_id: run.workspace_id ?? "", quality_status: "skipped",
      }).select("id").single()).data;
      if (generation) {
        const { data: have } = await supabase.from("generation_assets").select("storage_path").eq("generation_id", generation.id);
        const known = new Set((have ?? []).map((a) => a.storage_path));
        const fresh = r.images.filter((x) => !known.has(x.ref.path));
        if (fresh.length) {
          await supabase.from("generation_assets").insert(fresh.map((x) => ({
            generation_id: generation.id, asset_type: "image" as const, storage_path: x.ref.path,
            metadata: { provider: x.provider, model: x.model, workflow: true },
          })));
        }
      }
      const unit = r.input.unit_credits;
      const shortfall = expected - delivered;
      let refunded = 0;
      if (shortfall > 0 && unit > 0) {
        const { data: tx } = await supabase.rpc("usage_event_refund_partial", {
          p_token: token, p_event_id: run.usage_event_id, p_amount: shortfall * unit,
        });
        if (tx) refunded = shortfall * unit;
      }
      await completeUsage(supabase, token, run.usage_event_id, delivered, {
        apiCostUsdMicros: costs.usdMicros, providerRequestId: null, executor,
      });
      await supabase.from("generation_jobs").update({
        status: "completed", credits_charged: (run.credits ?? 0) - refunded, latency_ms: durationMs,
        completed_at: new Date().toISOString(), ...(executor.providerSlug ? { provider_slug: executor.providerSlug } : {}),
      }).eq("id", run.job_id);
      await supabase.from("notifications").insert({
        user_id: run.user_id ?? "", type: "generation_done", title: "generation_done",
        body: `workflow ×${delivered}`, href: "/library",
      });
      await supabase.rpc("log_activity", {
        p_workspace_id: run.workspace_id ?? "", p_action: "generation.completed",
        p_entity_type: "generation_job", p_entity_id: run.job_id,
        p_metadata: { workflow_version: run.workflow_version, count: delivered, expected, refunded, provider: executor.providerSlug, model: executor.modelSlug },
      });
    }
  }

  await patchRun(supabase, run.id, owner, {
    status: wf === null ? "blocked" : status,
    error: status === "ok" ? null : (r.error ?? (status === "partial" ? "partial_result" : "workflow_failed")),
    outputs: r.images.map((x) => ({ path: x.ref.path })),
    progress: { step: wf?.steps.length ?? 0, steps: wf?.steps.length ?? 0, done: delivered, total: expected, failed: expected - delivered },
    steps: stepsTrace as unknown as Json,
    api_cost_usd_micros: costs.usdMicros,
    cost_unknown: costs.unknown,
    model_label: executor.modelSlug ?? executor.providerSlug ?? null,
    duration_ms: durationMs,
  });
  return wf === null ? "blocked" : status;
}
