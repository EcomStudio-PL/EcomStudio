import type { TokenPrices } from "@/lib/thumbnail/config";

/**
 * WHAT ONE SUNBURST CALL COST — usage × the operator's price list, nothing else.
 *
 * GPT Image 2.5 is billed per token (text in, image in, image out), and no
 * per-image price exists for it. So the cost of a call is computed only from
 * the `usage` block of ITS OWN response and the rates an operator entered
 * from OpenAI's price list. No usage, or a token class with no rate → the cost
 * is UNKNOWN (null), never zero and never a guess.
 *
 * Pure: shared by the run (actual cost per call), the admin economics card
 * (estimates from the runs already made) and the tests.
 */

export type UsageLike = {
  inputTokens: number | null;
  inputTextTokens: number | null;
  inputImageTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  outputImageTokens: number | null;
  outputTextTokens: number | null;
};

export type CostBreakdown = {
  textInput: number;
  imageInput: number;
  cachedInput: number;
  imageOutput: number;
  textOutput: number;
};

export type SunburstCost =
  | { known: true; usdMicros: number; breakdown: CostBreakdown }
  | { known: false; reason: "no_usage" | "no_split" | "no_price" };

/** tokens × (USD per 1M tokens) is the cost in micro-USD, exactly. */
const perMTok = (tokens: number, usdPerMTok: number) => tokens * usdPerMTok;

/**
 * Tokens × rates, in USD micros.
 *
 * The input split must be reported (text vs image tokens) — they are priced
 * differently and a guessed split would be a guessed cost. Cached tokens are
 * reported as one figure without a text/image split; they are priced at the
 * cached IMAGE rate when every cached token could be an image token and that
 * rate exists, otherwise the cost is unknown. Output tokens with no split are
 * image tokens (the model outputs images; text output is listed as not billed).
 */
export function sunburstCost(usage: UsageLike | null, prices: TokenPrices): SunburstCost {
  if (!usage || (usage.inputTokens === null && usage.outputTokens === null)) return { known: false, reason: "no_usage" };
  const inText = usage.inputTextTokens;
  const inImage = usage.inputImageTokens;
  const inTotal = usage.inputTokens ?? ((inText ?? 0) + (inImage ?? 0));
  if (inTotal > 0 && (inText === null || inImage === null)) return { known: false, reason: "no_split" };
  const cached = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), inImage ?? 0);
  const outImage = usage.outputImageTokens ?? (usage.outputTextTokens === null ? usage.outputTokens ?? 0 : Math.max(0, (usage.outputTokens ?? 0) - usage.outputTextTokens));
  const outText = usage.outputTextTokens ?? 0;

  const need = (tokens: number, rate: number | null) => tokens === 0 || rate !== null;
  if (!need(inText ?? 0, prices.textInput)) return { known: false, reason: "no_price" };
  if (!need((inImage ?? 0) - cached, prices.imageInput)) return { known: false, reason: "no_price" };
  if (!need(cached, prices.cachedImageInput ?? prices.imageInput)) return { known: false, reason: "no_price" };
  if (!need(outImage, prices.imageOutput)) return { known: false, reason: "no_price" };
  if (!need(outText, prices.textOutput)) return { known: false, reason: "no_price" };

  const breakdown: CostBreakdown = {
    textInput: Math.round(perMTok(inText ?? 0, prices.textInput ?? 0)),
    imageInput: Math.round(perMTok((inImage ?? 0) - cached, prices.imageInput ?? 0)),
    cachedInput: Math.round(perMTok(cached, prices.cachedImageInput ?? prices.imageInput ?? 0)),
    imageOutput: Math.round(perMTok(outImage, prices.imageOutput ?? 0)),
    textOutput: Math.round(perMTok(outText, prices.textOutput ?? 0)),
  };
  const usdMicros = breakdown.textInput + breakdown.imageInput + breakdown.cachedInput + breakdown.imageOutput + breakdown.textOutput;
  return { known: true, usdMicros, breakdown };
}

/**
 * AN ESTIMATE BEFORE THE CALL — from what earlier calls really used, never
 * from a constant. The average reported tokens per input photo and per output
 * image of the runs already made, × the current rates. Fewer than one
 * measured call (or a missing rate) → unknown.
 */
export type MeasuredCall = { photos: number; usage: UsageLike };

export function estimateSunburstCost(
  history: readonly MeasuredCall[], photos: number, prices: TokenPrices,
): { known: true; usdMicros: number; samples: number } | { known: false; samples: number } {
  const usable = history.filter((h) => h.photos > 0 && h.usage.inputImageTokens !== null && h.usage.inputTextTokens !== null
    && (h.usage.outputImageTokens !== null || h.usage.outputTokens !== null));
  if (usable.length === 0) return { known: false, samples: 0 };
  const avg = (f: (h: MeasuredCall) => number) => usable.reduce((s, h) => s + f(h), 0) / usable.length;
  const imagePerPhoto = avg((h) => (h.usage.inputImageTokens ?? 0) / h.photos);
  const text = avg((h) => h.usage.inputTextTokens ?? 0);
  const out = avg((h) => h.usage.outputImageTokens ?? h.usage.outputTokens ?? 0);
  const cost = sunburstCost({
    inputTokens: Math.round(text + imagePerPhoto * photos),
    inputTextTokens: Math.round(text),
    inputImageTokens: Math.round(imagePerPhoto * photos),
    cachedInputTokens: 0,
    outputTokens: Math.round(out),
    outputImageTokens: Math.round(out),
    outputTextTokens: 0,
  }, prices);
  return cost.known ? { known: true, usdMicros: cost.usdMicros, samples: usable.length } : { known: false, samples: usable.length };
}

/**
 * The money side of one Miniaturka, in PLN — what the admin card shows next to
 * the price. Revenue = credits × the price of a credit; cost = provider USD ×
 * the analytics FX. Every figure that is unknown stays null.
 */
export function marginOf(input: {
  credits: number; plnPerCredit: number; costUsdMicros: number | null; usdToPln: number;
}): { revenuePln: number; costPln: number | null; marginPln: number | null; marginPercent: number | null } {
  const revenuePln = input.credits * input.plnPerCredit;
  if (input.costUsdMicros === null) return { revenuePln, costPln: null, marginPln: null, marginPercent: null };
  const costPln = (input.costUsdMicros / 1_000_000) * input.usdToPln;
  const marginPln = revenuePln - costPln;
  return { revenuePln, costPln, marginPln, marginPercent: revenuePln > 0 ? (marginPln / revenuePln) * 100 : null };
}
