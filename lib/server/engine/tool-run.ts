import "server-only";
import { promptDigest } from "@/lib/server/prompt-digest";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { TOOL_VARIABLES } from "@/lib/ai/prompt-variables";
import { resolveEngine } from "@/lib/server/ai-engine";
import { runGeneration, type GenerateInput, type GenerateOutput } from "@/lib/server/generation";
import { downloadReferences, textCapableBackends } from "@/lib/server/prompt-engine";
import { compileForTool, recordEngineRun, resolveVariables } from "@/lib/server/engine/runtime";
import { startWorkflowRun } from "@/lib/server/engine/workflow";
import { loadWorkflow } from "@/lib/server/engine/workflow-store";
import { finalStepIndex, maxOutputsOf } from "@/lib/ai/workflow-def";
import { textMeter, type TextMeter } from "@/lib/server/ai-usage";

/**
 * ONE ENTRY FOR THE PROMPT-DRIVEN IMAGE TOOLS (Retusz, Moda).
 *
 * The tool keeps everything it owned before — its model, its price, its input
 * validation, its aspect-ratio logic. This decides only WHICH INSTRUCTION the
 * one billed generation receives:
 *
 *   workflow  Workflow ON and a published version: a persistent run is
 *             STARTED (charged once) and returned as pending — the caller
 *             schedules the driver and the browser polls its status
 *   grovbase  the published prompt, variables compiled
 *   neither   the tool's built-in prompt (Retusz), or `prompt_unconfigured`
 *             for a tool that has none (Moda) — never an invented one.
 *
 * The engine configuration is read ONCE, at the start: a publish that lands
 * while this request runs does not change what this request does.
 */
export type EngineToolInput = {
  toolKey: string;
  /** The seller's hint (already capped); "" when the tool has none. It reaches
   *  the model only where the published prompt places {{hint}}. */
  hint: string;
  referencePaths: string[];
  generation: Omit<GenerateInput, "prompt" | "referencePaths"> & { modelId: string };
  expectedCost: number;
  /** Results per run the panel quoted (Workflow ON); see startWorkflowRun. */
  quotedOutputs?: number;
};

/** A workflow run that was started (and charged) but not finished yet. */
export type EnginePending = {
  ok: true; pending: true; runId: string; jobId: string | null; credits: number; expected: number;
  productId: null; images: [];
};
export type EngineToolOutput = GenerateOutput | EnginePending;

export function isPending(r: EngineToolOutput): r is EnginePending {
  return r.ok && "pending" in r && r.pending === true;
}

export async function runEngineImageTool(
  supabase: Client, userId: string, workspaceId: string, input: EngineToolInput,
): Promise<EngineToolOutput> {
  // Analysis requests made to resolve this tool's variables (and workflow
  // analyze steps) go into the provider trace; the image call traces itself
  // inside runGeneration. Tracking only — nothing about the run changes.
  const meter = textMeter(supabase, { actorKind: "customer", consumer: "workflow", userId, workspaceId, toolKey: input.toolKey });
  try {
    return await runEngineImageToolMetered(supabase, userId, workspaceId, input, meter);
  } finally {
    await meter.flush();
  }
}

async function runEngineImageToolMetered(
  supabase: Client, userId: string, workspaceId: string, input: EngineToolInput, meter: TextMeter,
): Promise<EngineToolOutput> {
  const started = Date.now();
  const engine = await resolveEngine(supabase, input.toolKey);
  const strategy = engine?.knowledgeStrategy ?? "proven";
  const defs = TOOL_VARIABLES[input.toolKey] ?? [];
  // Derived from the customer's inputs only: the same request picks the same
  // "diverse" examples, and a double submit hashes to the same ledger key.
  const inputHash = createHash("sha256").update(JSON.stringify([input.toolKey, input.referencePaths, input.hint])).digest("hex").slice(0, 24);
  const resolveBase = {
    supabase, workspaceId, toolKey: input.toolKey, strategy,
    seed: `${input.toolKey}:${workspaceId}:${inputHash}`,
    referencePaths: input.referencePaths,
    images: () => downloadReferences(supabase, input.referencePaths),
    backends: async () => meter.wrap(await textCapableBackends(supabase)),
    knowledgeQuery: [input.toolKey.replace(/_/g, " "), input.hint].filter(Boolean).join("\n"),
    base: {
      tool_name: input.toolKey,
      aspect_ratio: input.generation.aspectRatio,
      resolution: input.generation.resolution ?? null,
      image_count: String(input.referencePaths.length),
      hint: input.hint || null,
    },
  };

  if (engine?.workflowEnabled) {
    // The PUBLISHED version, read once: a publish that lands while this run
    // is going changes nothing for it (the run is pinned to this version).
    const workflow = await loadWorkflow(supabase, input.toolKey, null);
    if (workflow && workflow.status === "published") {
      const started = await startWorkflowRun(supabase, userId, workspaceId, {
        toolKey: input.toolKey, workflow, hint: input.hint, referencePaths: input.referencePaths,
        aspectRatio: input.generation.aspectRatio, resolution: input.generation.resolution ?? null,
        quality: input.generation.quality ?? null,
        toolModelId: input.generation.modelId, toolFallbackId: input.generation.fallbackModelIds?.[0] ?? null,
        unitCredits: input.expectedCost, operation: input.generation.operation ?? input.toolKey,
        knowledgeStrategy: strategy, quotedOutputs: input.quotedOutputs,
      });
      if (!started.ok) return { ok: false, error: started.error, missingCredits: started.missingCredits };
      return {
        ok: true, pending: true, runId: started.runId, jobId: started.jobId, credits: started.credits,
        expected: started.expected, productId: null, images: [],
      };
    }
    // Switch ON but nothing published (the switch refuses to turn on without
    // a published version, so this is a safety net): the tool keeps its
    // single-call path below, which refuses honestly when it has no prompt.
  }

  const engineMode = engine && (engine.mode === "grovbase" || engine.mode === "hybrid");
  const published = engineMode ? engine.systemPrompt?.trim() ? engine.systemPrompt : null : null;
  // A version IS published but could not be opened: refused, nothing charged
  // (there is no other text to send — tools have no built-in prompt).
  if (engineMode && !published && engine.promptVersion !== null) {
    await recordEngineRun(supabase, {
      toolKey: input.toolKey, workspaceId, userId, mode: engine.mode, promptVersion: engine.promptVersion,
      modelId: input.generation.modelId, status: "blocked", error: "prompt_unavailable", durationMs: Date.now() - started,
    });
    return { ok: false, error: "prompt_unavailable" };
  }
  // THE PUBLISHED PROMPT OR NOTHING. No built-in, legacy or default text
  // exists for a tool; with nothing published the run stops here — no
  // provider call, no credits, no fallback.
  const template = published;
  if (!template || !template.trim()) return { ok: false, error: "prompt_unconfigured" };

  // A template that makes model calls to resolve (analysis, knowledge) is
  // only resolved for a customer who can pay for the result.
  if (usesCostlyVariables(template)) {
    const { data: wallet } = await supabase
      .from("credit_wallets").select("balance").eq("workspace_id", workspaceId).maybeSingle();
    if (!wallet) return { ok: false, error: "no_wallet" };
    if (wallet.balance < input.expectedCost) {
      return { ok: false, error: "insufficient_credits", missingCredits: input.expectedCost - wallet.balance };
    }
  }
  const resolved = await resolveVariables([template], resolveBase);
  const compiled = compileForTool(template, defs, resolved.values);
  const knowledge = resolved.knowledge;
  const trace = {
    toolKey: input.toolKey, workspaceId, userId,
    mode: engine?.mode ?? "grovbase",
    promptVersion: published ? engine?.promptVersion ?? null : null,
    modelId: input.generation.modelId,
    knowledgeExampleIds: knowledge?.exampleIds ?? [],
    sceneExampleId: knowledge?.sceneExampleId ?? null,
  } as const;
  if (!compiled.ok) {
    // Fail safe BEFORE runGeneration: nothing reserved, nothing charged.
    await recordEngineRun(supabase, { ...trace, status: "blocked", error: compiled.error, durationMs: Date.now() - started });
    return { ok: false, error: compiled.error === "variable_missing" ? "variable_missing" : "prompt_unconfigured" };
  }

  // THE FINAL PROMPT — compiled once, never changed after this line. The
  // seller's hint is in it only where the template placed {{hint}}.
  const prompt = compiled.text;

  const result = await runGeneration(supabase, userId, workspaceId, {
    ...input.generation,
    prompt,
    referencePaths: input.referencePaths,
    hidePromptText: true,
    // The resolved published prompt is the ONLY text the provider may get;
    // runGeneration refuses (before charging) if what it would send differs.
    promptContract: {
      resolved: prompt ?? "", publishedDigest: promptDigest(template ?? ""),
      version: engine?.promptVersion ?? null, variables: compiled.used,
      // What else could have reached the request from earlier runs — 0 for a
      // stateless tool, whose template cannot even place those variables.
      knowledgeCount: (knowledge?.exampleIds.length ?? 0) + (knowledge?.sceneExampleId ? 1 : 0),
      examplesCount: knowledge?.exampleIds.length ?? 0,
    },
    dedupePrompt: `engine:${input.toolKey}:p${engine?.promptVersion ?? 0}:${inputHash}`,
    // The panel's "Limit czasu" and "Próby na modelu głównym" are what the
    // image call really gets (clamped to the route budget) — not a label.
    ...(engine ? { callTimeoutMs: engine.timeoutMs, maxAttempts: engine.maxAttempts } : {}),
  });
  await recordEngineRun(supabase, {
    ...trace,
    status: result.ok ? "ok" : "failed",
    error: result.ok ? null : result.error,
    jobId: result.ok ? result.jobId : null,
    credits: result.ok ? result.credits : null,
    durationMs: Date.now() - started,
  });
  return result;
}

/** Whether a prompt-driven tool can run at all right now (for its panel). */
export async function engineToolConfigured(supabase: Client, toolKey: string, hasBuiltIn: boolean): Promise<boolean> {
  if (hasBuiltIn) return true;
  const engine = await resolveEngine(supabase, toolKey);
  if (!engine) return false;
  if (engine.workflowEnabled && (await loadWorkflow(supabase, toolKey, null))?.status === "published") return true;
  if (engine.mode === "grovbase" || engine.mode === "hybrid") return Boolean(engine.systemPrompt?.trim());
  return false;
}

/**
 * How many results ONE click delivers (and is priced for): 1 on the normal
 * path, the published workflow's result count when Workflow is ON. The panel
 * multiplies its per-image price by this — the server charges the same.
 */
export async function engineOutputsPerRun(supabase: Client, toolKey: string): Promise<number> {
  const engine = await resolveEngine(supabase, toolKey);
  if (!engine?.workflowEnabled) return 1;
  const wf = await loadWorkflow(supabase, toolKey, null);
  if (!wf || wf.status !== "published") return 1;
  const idx = finalStepIndex(wf.steps);
  return idx < 0 ? 1 : maxOutputsOf(wf.steps[idx]);
}

/* ── generator (hybrid) ───────────────────────────────────────────────────*/

export type GeneratorEngine =
  | {
      ok: true; enginePrompt: string | null; finish: (result: GenerateOutput) => Promise<void>;
    }
  | { ok: false; error: string };

/**
 * The generator's template path in HYBRID mode: the published GrovBase
 * template, compiled with its explicit variables — the customer's prompt
 * where it places {{user_prompt}}, their negative where it places
 * {{negative_prompt}}, the lock where it places {{fidelity_rules}}. Nothing
 * is appended; a template without {{user_prompt}} cannot carry the customer's
 * words and is refused. In 'user' mode (or hybrid with nothing published) this
 * returns `enginePrompt: null` and the customer's prompt goes out 1:1.
 */
export async function prepareGeneratorEngine(
  supabase: Client, userId: string, workspaceId: string,
  input: {
    userPrompt: string; negative: string | null; productDescription: string | null;
    aspectRatio: string; resolution: string | null; referencePaths: string[];
  },
): Promise<GeneratorEngine> {
  const noop: GeneratorEngine = { ok: true, enginePrompt: null, finish: async () => {} };
  const started = Date.now();
  const inputHash = createHash("sha256").update(JSON.stringify([input.userPrompt, input.negative, input.referencePaths])).digest("hex").slice(0, 24);
  const engine = await resolveEngine(supabase, "generator");
  if (!engine || engine.mode !== "hybrid" || !engine.systemPrompt?.trim()) return noop;
  const template = engine.systemPrompt;
  // A template that makes model calls to resolve runs them only for a
  // workspace with credits (the exact price is checked by runGeneration).
  if (usesCostlyVariables(template)) {
    const { data: wallet } = await supabase
      .from("credit_wallets").select("balance").eq("workspace_id", workspaceId).maybeSingle();
    if (!wallet) return { ok: false, error: "no_wallet" };
    if (wallet.balance <= 0) return { ok: false, error: "insufficient_credits" };
  }
  const meter = textMeter(supabase, { actorKind: "customer", consumer: "workflow", userId, workspaceId, toolKey: "generator" });
  const resolved = await resolveVariables([template], {
    supabase, workspaceId, toolKey: "generator", strategy: engine.knowledgeStrategy,
    seed: `generator:${workspaceId}:${inputHash}`,
    referencePaths: input.referencePaths,
    images: () => downloadReferences(supabase, input.referencePaths),
    backends: async () => meter.wrap(await textCapableBackends(supabase)),
    knowledgeQuery: [input.userPrompt, input.productDescription].filter(Boolean).join("\n"),
    base: {
      user_prompt: input.userPrompt || null,
      negative_prompt: input.negative || null,
      product_description: input.productDescription || null,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
    },
  });
  await meter.flush();
  const compiled = compileForTool(template, TOOL_VARIABLES.generator, resolved.values);
  const trace = {
    toolKey: "generator", workspaceId, userId, mode: "hybrid" as const,
    promptVersion: engine.promptVersion,
    knowledgeExampleIds: resolved.knowledge?.exampleIds ?? [],
    sceneExampleId: resolved.knowledge?.sceneExampleId ?? null,
  };
  if (!compiled.ok) {
    await recordEngineRun(supabase, { ...trace, status: "blocked", error: compiled.error, durationMs: Date.now() - started });
    return { ok: false, error: compiled.error === "variable_missing" ? "variable_missing" : "prompt_unconfigured" };
  }
  // The template must say where the customer's words go; GrovBase never
  // decides that for it.
  if (!/\{\{\s*user_prompt\b/.test(template)) {
    await recordEngineRun(supabase, { ...trace, status: "blocked", error: "prompt_unconfigured", durationMs: Date.now() - started });
    return { ok: false, error: "prompt_unconfigured" };
  }
  return {
    ok: true,
    enginePrompt: compiled.text,
    finish: (result) => recordEngineRun(supabase, {
      ...trace,
      status: result.ok ? "ok" : "failed",
      error: result.ok ? null : result.error,
      jobId: result.ok ? result.jobId : null,
      credits: result.ok ? result.credits : null,
      durationMs: Date.now() - started,
    }),
  };
}

/** Whether a template references a variable that costs a model call. */
function usesCostlyVariables(template: string): boolean {
  return /\{\{\s*(product_analysis|knowledge_hints|knowledge_scene)\b/.test(template);
}
