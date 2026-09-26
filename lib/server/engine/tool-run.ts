import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { TOOL_VARIABLES, appendCustomerBlock } from "@/lib/ai/prompt-variables";
import { loadPublishedWorkflow, resolveEngine } from "@/lib/server/ai-engine";
import { runGeneration, type GenerateInput, type GenerateOutput } from "@/lib/server/generation";
import { downloadReferences, textCapableBackends } from "@/lib/server/prompt-engine";
import { compileForTool, recordEngineRun, resolveVariables } from "@/lib/server/engine/runtime";
import { runImageWorkflow } from "@/lib/server/engine/workflow";

/**
 * ONE ENTRY FOR THE PROMPT-DRIVEN IMAGE TOOLS (Retusz, Moda).
 *
 * The tool keeps everything it owned before — its model, its price, its input
 * validation, its aspect-ratio logic. This decides only WHICH INSTRUCTION the
 * one billed generation receives:
 *
 *   workflow  the published workflow (analysis steps, then the image step)
 *   grovbase  the published prompt, variables compiled
 *   neither   the tool's built-in prompt (Retusz), or `prompt_unconfigured`
 *             for a tool that has none (Moda) — never an invented one.
 *
 * The engine configuration is read ONCE, at the start: a publish that lands
 * while this request runs does not change what this request does.
 */
export type EngineToolInput = {
  toolKey: string;
  /** The tool's built-in instruction, or null when it has none. */
  builtInPrompt: string | null;
  /** The seller's hint (already capped); "" when the tool has none. */
  hint: string;
  referencePaths: string[];
  generation: Omit<GenerateInput, "prompt" | "referencePaths"> & { modelId: string };
  expectedCost: number;
};

export async function runEngineImageTool(
  supabase: Client, userId: string, workspaceId: string, input: EngineToolInput,
): Promise<GenerateOutput> {
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
    backends: () => textCapableBackends(supabase),
    knowledgeQuery: [input.toolKey.replace(/_/g, " "), input.hint].filter(Boolean).join("\n"),
    base: {
      tool_name: input.toolKey,
      aspect_ratio: input.generation.aspectRatio,
      resolution: input.generation.resolution ?? null,
      image_count: String(input.referencePaths.length),
      hint: input.hint || null,
    },
  };

  if (engine?.mode === "workflow") {
    const workflow = await loadPublishedWorkflow(supabase, input.toolKey);
    if (workflow) {
      const out = await runImageWorkflow(supabase, {
        toolKey: input.toolKey, workflow, hint: input.hint, resolve: resolveBase,
        generation: {
          ...input.generation, referencePaths: input.referencePaths,
          dedupePrompt: `engine:${input.toolKey}:w${workflow.version}:${inputHash}`,
        },
        expectedCost: input.expectedCost, userId,
      });
      return out.ok ? out.result : { ok: false, error: out.error, missingCredits: out.missingCredits };
    }
    // No published workflow: a tool with a built-in prompt keeps working on
    // it; a tool without one refuses honestly.
    if (input.builtInPrompt === null) return { ok: false, error: "prompt_unconfigured" };
  }

  const published = engine && (engine.mode === "grovbase" || engine.mode === "hybrid")
    ? engine.systemPrompt?.trim() ? engine.systemPrompt : null
    : null;
  const template = published ?? input.builtInPrompt;
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

  // The seller's words stay DATA: a separated block after the instruction,
  // unless the admin placed {{hint}} in the prompt (then it is wrapped there).
  const usesHint = /\{\{\s*hint\b/.test(template);
  const prompt = usesHint ? compiled.text : appendCustomerBlock(compiled.text, "wskazówka sprzedawcy", input.hint, 1000);

  const result = await runGeneration(supabase, userId, workspaceId, {
    ...input.generation,
    prompt,
    referencePaths: input.referencePaths,
    hidePromptText: true,
    dedupePrompt: `engine:${input.toolKey}:p${published ? engine?.promptVersion ?? 0 : "builtin"}:${inputHash}`,
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
  if (engine.mode === "workflow") return (await loadPublishedWorkflow(supabase, toolKey)) !== null;
  if (engine.mode === "grovbase" || engine.mode === "hybrid") return Boolean(engine.systemPrompt?.trim());
  return false;
}

/* ── generator (hybrid) ───────────────────────────────────────────────────*/

export type GeneratorEngine =
  | { ok: true; enginePrompt: string | null; finish: (result: GenerateOutput) => Promise<void> }
  | { ok: false; error: string };

/**
 * The generator's own-prompt path in HYBRID mode: the published GrovBase
 * instruction first, the customer's prompt (and negative prompt) after it as a
 * separated DATA block — never glued into the instruction. In 'user' mode, or
 * in hybrid with nothing published, this returns `enginePrompt: null` and the
 * generator behaves exactly as it always has.
 *
 * Product Lock is untouched either way: runGeneration appends the fidelity
 * contract to whatever text reaches the provider.
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
  const resolved = await resolveVariables([template], {
    supabase, workspaceId, toolKey: "generator", strategy: engine.knowledgeStrategy,
    seed: `generator:${workspaceId}:${inputHash}`,
    referencePaths: input.referencePaths,
    images: () => downloadReferences(supabase, input.referencePaths),
    backends: () => textCapableBackends(supabase),
    knowledgeQuery: [input.userPrompt, input.productDescription].filter(Boolean).join("\n"),
    base: {
      user_prompt: input.userPrompt || null,
      negative_prompt: input.negative || null,
      product_description: input.productDescription || null,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
    },
  });
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
  let text = compiled.text;
  if (!/\{\{\s*user_prompt\b/.test(template)) text = appendCustomerBlock(text, "prompt klienta", input.userPrompt, 6000);
  if (input.negative?.trim() && !/\{\{\s*negative_prompt\b/.test(template)) {
    text = appendCustomerBlock(text, "czego klient chce uniknąć", input.negative, 1000);
  }
  return {
    ok: true,
    enginePrompt: text,
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
