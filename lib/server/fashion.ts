import "server-only";
import sharp from "sharp";
import type { Client } from "@/lib/services/workspace";
import { runGeneration } from "@/lib/server/generation";
import { resolveSystemPrompt } from "@/lib/server/ai-engine";
import { fashionTool, type FashionToolConfig } from "@/lib/fashion-tools";
import { RATIO_SHAPE, type AspectRatio, type Resolution } from "@/lib/ai/types";

/**
 * MODA — the four tools' server half.
 *
 * ONE RUNNER, NOT FOUR. The tools differ in their prompt, their price row and
 * which photographs they take; none of that justifies four endpoints or four
 * copies of the credit and storage plumbing. Everything below is driven by the
 * tool's config, and the whole pipeline — model resolution, decrypted provider
 * credential, credit reservation, storage, history, refund on failure — is the
 * existing `runGeneration`. There is no "Moda API".
 *
 * THE PROMPT IS NOT IN THIS FILE, AND THAT IS THE POINT.
 *
 * The retouch tool keeps its prompt as a server-only constant, which works
 * because it is one tool with one job. These four are meant to be tuned by an
 * operator without a deploy, so their prompts live where every other tool
 * prompt already lives: `ai_tool_prompts`, written from Admin → AI → the
 * tool's own screen, published with a version and a reason, and read here
 * through `resolveSystemPrompt`.
 *
 * UNTIL A PROMPT IS PUBLISHED THE TOOL REFUSES. It does not fall back to an
 * invented instruction. A made-up prompt would produce plausible-looking
 * images that nobody chose the behaviour of, charge real credits for them, and
 * be indistinguishable from a working tool — so the honest state is
 * `prompt_unconfigured`, which the panel shows as "not available yet".
 *
 * THE MODEL is resolved by its API identifier rather than its marketing name:
 * the row is operator-managed and the display name may change without the
 * endpoint changing. Switching these tools to a different model is a change to
 * that row, not to this file.
 */

/** Nano Banana Pro. The identifier is the provider's, and it is the one thing
 *  here that a rename in the admin panel must not break. */
const FASHION_MODEL_IDENTIFIER = "gemini-3-pro-image-preview";

export type FashionModelInfo = {
  id: string;
  resolutions: string[];
  ratios: string[];
  /** Size → credits for one image, carrying the operator's own override. */
  pricing: Record<string, number>;
  maxReferenceImages: number;
};

/**
 * The model row these tools run on, reduced to what a panel and a run need.
 * Null when the row is missing or switched off — every caller then reports the
 * tool as unavailable rather than guessing a substitute.
 */
export async function fashionModel(supabase: Client): Promise<FashionModelInfo | null> {
  const { data: model } = await supabase
    .from("ai_models")
    .select("id, credit_cost, pricing, supported_resolutions, supported_aspect_ratios, max_reference_images, active")
    .eq("model_identifier", FASHION_MODEL_IDENTIFIER)
    .eq("active", true)
    .maybeSingle();
  if (!model) return null;

  const resolutions = model.supported_resolutions ?? ["1K"];
  const raw = (model.pricing ?? {}) as Record<string, unknown>;
  const pricing: Record<string, number> = {};
  for (const size of resolutions) {
    pricing[size] = num(raw[size]) ?? model.credit_cost;
  }

  return {
    id: model.id,
    resolutions,
    ratios: model.supported_aspect_ratios ?? ["1:1"],
    pricing,
    maxReferenceImages: model.max_reference_images ?? 2,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;
}

/** Credits for one image at one size — the single source of truth for the
 *  quote the panel shows and the amount the server reserves. */
export function fashionPrice(model: FashionModelInfo, resolution: string): number {
  return model.pricing[resolution] ?? Object.values(model.pricing)[0] ?? 0;
}

/**
 * "Auto" means the shape of the file the seller uploaded, snapped to the
 * nearest framing the engine can actually draw. Measuring beats guessing: a
 * 3000×2000 photo asked for as 1:1 comes back cropped, and a garment that has
 * been cropped is a garment the seller cannot use.
 */
async function ratioOfSource(bytes: Buffer, allowed: string[]): Promise<AspectRatio> {
  const fallback = (allowed.includes("1:1") ? "1:1" : allowed[0] ?? "1:1") as AspectRatio;
  try {
    const meta = await sharp(bytes).metadata();
    // EXIF orientation 5–8 stores the image rotated a quarter turn.
    const swap = (meta.orientation ?? 1) >= 5;
    const w = (swap ? meta.height : meta.width) ?? 0;
    const h = (swap ? meta.width : meta.height) ?? 0;
    if (!w || !h) return fallback;
    const target = w / h;
    let best = fallback;
    let bestDelta = Infinity;
    for (const r of allowed) {
      const shape = RATIO_SHAPE[r as keyof typeof RATIO_SHAPE];
      if (!shape) continue;
      const delta = Math.abs(Math.log(shape.w / shape.h) - Math.log(target));
      if (delta < bestDelta) { bestDelta = delta; best = r as AspectRatio; }
    }
    return best;
  } catch {
    return fallback;
  }
}

export type FashionRunInput = {
  /** Workflow key — `ghostMannequin`, `flatlay`, `iron`, `changePerson`. */
  tool: string;
  /**
   * Storage paths in `product-images`, BY POOL. The pool name is load-bearing
   * for the paired tool: `reference` is the garment and `model` is the person,
   * and the two are handed to the provider in that order so the instruction
   * can refer to "the first image" and "the second image" and mean it.
   */
  inputs: Record<string, string[]>;
  resolution?: string;
  format?: string;
  /** The seller's own words, appended to the operator's prompt. Optional, and
   *  only on the tools whose panel offers the field. */
  hint?: string;
};

export type FashionRunResult =
  | { ok: true; jobId: string; url: string; path: string; credits: number }
  | { ok: false; error: string; missingCredits?: number };

/** Every path a run was given, in pool order — the order the provider sees. */
function orderedPaths(config: FashionToolConfig, inputs: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const slot of config.slots) {
    for (const path of inputs[slot.key] ?? []) out.push(path);
  }
  return out;
}

/**
 * Run ONE result. A batch is the caller looping, so a single failure refunds
 * and reports only itself and never takes the other results with it.
 */
export async function runFashionTool(
  supabase: Client, userId: string, workspaceId: string, input: FashionRunInput,
): Promise<FashionRunResult> {
  const config = fashionTool(input.tool);
  if (!config) return { ok: false, error: "unknown_tool" };

  // Every required pool must actually carry a photograph. The panel disables
  // the button, but a server action is its own entry point.
  for (const slot of config.slots) {
    if (slot.required && (input.inputs[slot.key]?.length ?? 0) === 0) {
      return { ok: false, error: "missing_input" };
    }
  }

  const model = await fashionModel(supabase);
  if (!model) return { ok: false, error: "model_unavailable" };

  // THE OPERATOR'S PROMPT, OR NOTHING. See the header: there is deliberately
  // no built-in fallback text.
  const prompt = await resolveSystemPrompt(supabase, config.toolKey);
  if (!prompt || !prompt.trim()) return { ok: false, error: "prompt_unconfigured" };

  const paths = orderedPaths(config, input.inputs);
  if (paths.length === 0) return { ok: false, error: "missing_input" };
  // More photographs than the model accepts would be silently dropped by the
  // provider, and the seller would pay for a result built from half the input.
  if (paths.length > model.maxReferenceImages) return { ok: false, error: "too_many_inputs" };

  const resolution = (config.showResolution && model.resolutions.includes(input.resolution ?? "")
    ? input.resolution
    : model.resolutions[0]) as Resolution;

  let aspectRatio: AspectRatio;
  if (config.showFormat && input.format && input.format !== "auto" && model.ratios.includes(input.format)) {
    aspectRatio = input.format as AspectRatio;
  } else {
    const { data: blob } = await supabase.storage.from("product-images").download(paths[0]!);
    if (!blob) return { ok: false, error: "source_unavailable" };
    aspectRatio = await ratioOfSource(Buffer.from(await blob.arrayBuffer()), model.ratios);
  }

  // The seller's hint is APPENDED, never substituted: the operator's prompt
  // carries the product-fidelity rules and must not be replaceable from a
  // textarea on the public side of the app.
  const hint = config.showHint ? (input.hint ?? "").trim().slice(0, 1000) : "";
  const fullPrompt = hint ? `${prompt}\n\n[WSKAZÓWKA OD SPRZEDAWCY]\n${hint}` : prompt;

  const result = await runGeneration(supabase, userId, workspaceId, {
    modelId: model.id,
    prompt: fullPrompt,
    aspectRatio,
    resolution,
    quantity: 1,
    // The seller's photographs ARE the subject: image-to-image throughout.
    referencePaths: paths,
    referenceImageIds: [],
    // GrovBase wrote the instruction, so the job row stores no prompt text and
    // the customer-facing projection has nothing to show.
    hidePromptText: true,
    promptOrigin: "ecomstudio",
    costOverride: fashionPrice(model, resolution),
    operation: config.operation,
  });

  if (!result.ok) return result;
  const first = result.images[0];
  return {
    ok: true,
    jobId: result.jobId,
    url: first?.url ?? "",
    path: first?.path ?? "",
    credits: result.credits,
  };
}

/**
 * Whether a tool can run right now, for the page that renders its panel.
 *
 * Both halves must be true: a model to call and a prompt an operator actually
 * wrote. Reported as one boolean because the seller can act on neither — the
 * panel says "not available yet" and the operator sees the detail in the admin
 * screen that owns it.
 */
export async function fashionToolAvailable(supabase: Client, toolKey: string): Promise<boolean> {
  const prompt = await resolveSystemPrompt(supabase, toolKey);
  return Boolean(prompt && prompt.trim());
}
