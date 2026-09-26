/**
 * WORKFLOW DEFINITION — the shape of a tool workflow and the rules that make
 * one runnable. Pure and client-safe: the admin builder, the save action and
 * the runtime all validate with THIS code, so the panel can never accept a
 * workflow the runtime would refuse (and the SQL save function re-checks the
 * shape it can see).
 *
 * A workflow is an ordered list of steps. Each step does one thing, reads
 * NAMED inputs and writes ONE named output:
 *
 *   ai_text           a text/vision model call → text, a list of strings, or
 *                     a JSON object ({{scene_prompts}}, {{product_analysis}}…)
 *   image_edit        an image model working ON an input image → image
 *   image_generation  an image model producing a new image (references
 *                     optional) → image
 *   tool              an existing GrovBase tool as a step (Retusz, usuwanie
 *                     tła, powiększanie, rozszerzanie) → image
 *
 * FOR EACH turns a step into a fan-out: it runs once per item of an earlier
 * LIST (or of an earlier fan-out's results), in parallel, with the item bound
 * to a variable (`{{scene_prompt}}`). Its output is then a collection.
 *
 * DATA FLOW IS EXPLICIT. A step can only reference names produced by EARLIER
 * steps (or the tool's own variables): no forward edge means no cycle, and no
 * recursion inside a definition. A 'tool' step never runs another workflow —
 * it runs that tool's single-call engine — so a workflow cannot call itself.
 *
 * Numbers such as "5 scenes" are configuration (`maxItems`), never code.
 */

import {
  TOOL_VARIABLES, malformedPlaceholders, parsePlaceholders, type VariableDef,
} from "@/lib/ai/prompt-variables";

export const STEP_OPERATIONS = ["ai_text", "image_edit", "image_generation", "tool"] as const;
export type StepOperation = (typeof STEP_OPERATIONS)[number];

export const OUTPUT_KINDS = ["text", "list", "json", "image"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Existing GrovBase tools a step may run. Each is a SINGLE provider call
 *  through that tool's own engine — never that tool's workflow. */
export const TOOL_STEP_SLUGS = ["retouch", "remove_bg", "upscale", "expand"] as const;
export type ToolStepSlug = (typeof TOOL_STEP_SLUGS)[number];

/** Safety bounds — technical, not product limits. */
export const MAX_STEPS = 50;
export const MAX_ITEMS = 50;
export const MAX_ATTEMPTS = 5;
export const MAX_CONCURRENCY = 10;
export const STEP_PROMPT_MAX = 20000;
/** A step may wait for a slow provider up to this; the default is the whole
 *  invocation budget, not a short quality-killing timeout. */
export const STEP_TIMEOUT_MIN_MS = 5_000;
export const STEP_TIMEOUT_MAX_MS = 900_000;
export const STEP_TIMEOUT_DEFAULT_MS = 280_000;

export type WorkflowStepDef = {
  name: string;
  enabled: boolean;
  operation: StepOperation;
  outputKind: OutputKind;
  /** {{outputName}} for later steps. */
  outputName: string;
  /** 'customer' (the seller's photos), 'none', an earlier image output, or
   *  the step's own FOR EACH item when it iterates images. */
  inputImage: string;
  /** Name of an earlier collection to iterate, or null. */
  forEach: string | null;
  /** The variable the current item is bound to (required with forEach). */
  itemName: string | null;
  /** List output: how many items to return. Fan-out: the most items to run. */
  maxItems: number | null;
  /** Image steps: model and optional fallback (null = the tool's own). */
  modelId: string | null;
  fallbackModelId: string | null;
  /** Text steps: provider and model inside it (null = configured order). */
  textProvider: "openai" | "google" | null;
  textModel: string | null;
  /** Tool steps: which tool. */
  toolSlug: ToolStepSlug | null;
  timeoutMs: number;
  maxAttempts: number;
  /** A failed step stops the run, or the run continues without it. */
  onError: "stop" | "continue";
  /** A failed fan-out item: continue (partial result) or fail the run. */
  onItemError: "continue" | "fail_run";
  /** Legacy (v1) conditions stay supported. */
  condition: "always" | "if_hint" | "if_previous_nonempty";
  /** The step instruction (admin-authored, secret). */
  prompt: string;
};

export type WorkflowDefinition = {
  steps: WorkflowStepDef[];
  concurrency: number;
};

const IDENT = /^[a-z][a-z0-9_]{0,39}$/;
const TEXT_MODEL = /^[a-z0-9][a-z0-9.\-]{0,79}$/;

/** Names a workflow may not take: the tool's own variables and the v1 names. */
export function reservedNames(toolKey: string): Set<string> {
  const names = new Set((TOOL_VARIABLES[toolKey] ?? []).map((d) => d.key));
  for (const n of ["previous", "customer", "none", "item", "input", "output"]) names.add(n);
  for (let i = 1; i <= MAX_STEPS; i++) names.add(`step${i}`);
  return names;
}

export const imageProducing = (s: Pick<WorkflowStepDef, "outputKind">) => s.outputKind === "image";

/** A step whose results form a collection (it can feed a later FOR EACH). */
export const isCollection = (s: Pick<WorkflowStepDef, "outputKind" | "forEach">) =>
  s.outputKind === "list" || s.forEach !== null;

/**
 * The variables a step's instruction may use: the tool's own, every EARLIER
 * step's output (as a DATA block — model output is never an instruction), and
 * the step's own FOR EACH item.
 */
export function stepVariables(toolKey: string, steps: readonly WorkflowStepDef[], index: number): VariableDef[] {
  const base = TOOL_VARIABLES[toolKey] ?? [];
  const earlier: VariableDef[] = steps.slice(0, index)
    .filter((s) => IDENT.test(s.outputName))
    .map((s) => ({
      key: s.outputName, source: "workflow" as const, render: "block" as const, max: 8000,
      sample: s.outputKind === "image" ? "(obraz z kroku)" : `(wynik: ${s.name})`,
    }));
  const own = steps[index];
  const item: VariableDef[] = own?.forEach && own.itemName && IDENT.test(own.itemName)
    ? [{ key: own.itemName, source: "workflow", render: "block", max: 4000, sample: "(bieżący element listy)" }]
    : [];
  return [...base, ...earlier, ...item];
}

export type ValidationError = {
  error:
    | "invalid_steps" | "step_name" | "output_name" | "output_duplicate" | "output_reserved"
    | "empty_prompt" | "too_long" | "variable_unknown" | "variable_malformed"
    | "input_unknown" | "input_required" | "for_each_unknown" | "item_name" | "max_items"
    | "image_step_last" | "tool_unknown" | "text_model" | "limits";
  step?: number;
  names?: string[];
};

/**
 * Validate a whole definition. Returns the number of final results one run
 * delivers at most (what the customer is quoted), or the first error.
 */
export function validateWorkflow(toolKey: string, def: WorkflowDefinition):
  { ok: true; maxOutputs: number } | ({ ok: false } & ValidationError) {
  const { steps } = def;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) return { ok: false, error: "invalid_steps" };
  if (!Number.isInteger(def.concurrency) || def.concurrency < 1 || def.concurrency > MAX_CONCURRENCY) {
    return { ok: false, error: "limits" };
  }
  const reserved = reservedNames(toolKey);
  const produced = new Map<string, WorkflowStepDef>();
  let lastEnabled = -1;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const n = i + 1;
    const fail = (error: ValidationError["error"], names?: string[]) => ({ ok: false as const, error, step: n, names });
    if (!(STEP_OPERATIONS as readonly string[]).includes(s.operation)) return fail("invalid_steps");
    if (!(OUTPUT_KINDS as readonly string[]).includes(s.outputKind)) return fail("invalid_steps");
    const name = String(s.name ?? "").trim();
    if (!name || name.length > 80) return fail("step_name");
    if (!IDENT.test(s.outputName)) return fail("output_name");
    if (reserved.has(s.outputName)) return fail("output_reserved", [s.outputName]);
    if (produced.has(s.outputName)) return fail("output_duplicate", [s.outputName]);

    // Operation ↔ output shape.
    if (s.operation === "ai_text" && s.outputKind === "image") return fail("invalid_steps");
    if (s.operation !== "ai_text" && s.outputKind !== "image") return fail("invalid_steps");
    if (s.operation === "tool" && !(TOOL_STEP_SLUGS as readonly string[]).includes(s.toolSlug ?? "")) return fail("tool_unknown");
    if (s.operation !== "tool" && s.toolSlug) return fail("invalid_steps");
    if (s.operation === "ai_text" && (s.modelId || s.fallbackModelId)) return fail("invalid_steps");
    if (s.operation !== "ai_text" && (s.textProvider || s.textModel)) return fail("invalid_steps");
    if (s.textProvider !== null && s.textProvider !== "openai" && s.textProvider !== "google") return fail("invalid_steps");
    if (s.textModel !== null && !TEXT_MODEL.test(s.textModel)) return fail("text_model");

    // Limits.
    if (!Number.isInteger(s.maxAttempts) || s.maxAttempts < 1 || s.maxAttempts > MAX_ATTEMPTS) return fail("limits");
    if (!Number.isInteger(s.timeoutMs) || s.timeoutMs < STEP_TIMEOUT_MIN_MS || s.timeoutMs > STEP_TIMEOUT_MAX_MS) return fail("limits");
    if (s.onError !== "stop" && s.onError !== "continue") return fail("invalid_steps");
    if (s.onItemError !== "continue" && s.onItemError !== "fail_run") return fail("invalid_steps");

    // FOR EACH: an earlier collection, a fresh item name, a cap.
    if (s.forEach !== null) {
      const src = produced.get(s.forEach);
      if (!src || !isCollection(src)) return fail("for_each_unknown", [s.forEach]);
      if (!s.itemName || !IDENT.test(s.itemName) || reserved.has(s.itemName)
        || produced.has(s.itemName) || s.itemName === s.outputName) return fail("item_name");
      if (!Number.isInteger(s.maxItems) || (s.maxItems ?? 0) < 1 || (s.maxItems ?? 0) > MAX_ITEMS) return fail("max_items");
    } else if (s.itemName !== null) {
      return fail("item_name");
    }
    // A list output must say how many items it returns.
    if (s.outputKind === "list" && s.forEach === null
      && (!Number.isInteger(s.maxItems) || (s.maxItems ?? 0) < 1 || (s.maxItems ?? 0) > MAX_ITEMS)) {
      return fail("max_items");
    }

    // Image input: the customer's photos, nothing, an earlier image, or the
    // item of an image collection being iterated.
    const input = s.inputImage;
    if (input !== "customer" && input !== "none") {
      const src = produced.get(input);
      const itemOfImages = s.forEach !== null && input === s.itemName && produced.get(s.forEach)?.outputKind === "image";
      if (!itemOfImages && (!src || src.outputKind !== "image")) return fail("input_unknown", [input]);
    }
    if ((s.operation === "image_edit" || s.operation === "tool") && input === "none") return fail("input_required");

    // The instruction and the variables it uses.
    const prompt = String(s.prompt ?? "");
    if (s.operation !== "tool" && !prompt.trim()) return fail("empty_prompt");
    if (prompt.length > STEP_PROMPT_MAX) return fail("too_long");
    if (malformedPlaceholders(prompt).length) return fail("variable_malformed");
    const known = new Set(stepVariables(toolKey, steps, i).map((d) => d.key));
    const unknown = [...new Set(parsePlaceholders(prompt).map((p) => p.name).filter((x) => !known.has(x)))];
    if (unknown.length) return fail("variable_unknown", unknown);

    produced.set(s.outputName, s);
    if (s.enabled) lastEnabled = i;
  }

  // The result of a run is its LAST ENABLED step, and it must be images.
  if (lastEnabled < 0 || !imageProducing(steps[lastEnabled])) return { ok: false, error: "image_step_last" };
  return { ok: true, maxOutputs: maxOutputsOf(steps[lastEnabled]) };
}

/** Results one run delivers at most: the final step's fan-out cap, or 1. */
export function maxOutputsOf(finalStep: Pick<WorkflowStepDef, "forEach" | "maxItems">): number {
  return finalStep.forEach !== null ? Math.min(MAX_ITEMS, Math.max(1, finalStep.maxItems ?? 1)) : 1;
}

/** The last enabled step (the run's result), by index. */
export function finalStepIndex(steps: readonly Pick<WorkflowStepDef, "enabled">[]): number {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].enabled) return i;
  return -1;
}

/**
 * v1 rows (0126: 'analyze' then one 'generate_image') expressed as v2 steps,
 * so a v1 workflow runs through the same runtime unchanged: outputs are named
 * step1..stepN (the names v1 prompts already use) and {{previous}} keeps
 * meaning the step right before.
 */
export function fromV1(rows: {
  operation: string; outputKind: string; name: string; enabled: boolean; useImages: boolean;
  modelId: string | null; textProvider: "openai" | "google" | null;
  timeoutMs: number; maxAttempts: number; condition: WorkflowStepDef["condition"]; prompt: string;
}[]): WorkflowStepDef[] {
  return rows.map((r, i) => {
    const image = r.operation === "generate_image";
    return {
      name: r.name, enabled: r.enabled,
      operation: image ? "image_generation" : "ai_text",
      outputKind: image ? "image" : "text",
      outputName: `step${i + 1}`,
      inputImage: image || r.useImages ? "customer" : "none",
      forEach: null, itemName: null, maxItems: null,
      modelId: image ? r.modelId : null, fallbackModelId: null,
      textProvider: image ? null : r.textProvider, textModel: null, toolSlug: null,
      timeoutMs: r.timeoutMs, maxAttempts: r.maxAttempts,
      onError: "stop", onItemError: "continue", condition: r.condition, prompt: r.prompt,
    };
  });
}

/** A fresh step of a given kind, for the builder's "+ Dodaj krok". */
export function blankStep(operation: StepOperation, outputName: string, name: string): WorkflowStepDef {
  return {
    name, enabled: true, operation,
    outputKind: operation === "ai_text" ? "text" : "image",
    outputName,
    inputImage: operation === "image_generation" ? "customer" : operation === "ai_text" ? "customer" : "customer",
    forEach: null, itemName: null, maxItems: null,
    modelId: null, fallbackModelId: null, textProvider: null, textModel: null,
    toolSlug: operation === "tool" ? "retouch" : null,
    timeoutMs: STEP_TIMEOUT_DEFAULT_MS, maxAttempts: 2,
    onError: "stop", onItemError: "continue", condition: "always", prompt: "",
  };
}
