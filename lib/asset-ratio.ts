/**
 * WHAT SHAPE IS THIS FILE, REALLY?
 *
 * Every gallery in GrovBase used to paint a square, whatever the file was. A
 * 16:9 render came out of the engine wide and was shown cropped to a box; a
 * 9:16 render came out tall and was shown cropped to the same box. The seller
 * could not tell, from the grid, what they had actually produced — which is
 * the one thing a grid of your own work is for.
 *
 * This is the single place that answers "what is this asset's aspect ratio",
 * so the answer is the same in the library, in a tool's results and in a batch
 * sheet, and so there is one place to improve when the data improves.
 *
 * THE ORDER OF PREFERENCE IS THE ORDER OF TRUTH:
 *
 *   1. THE ASSET'S OWN PIXELS — `generation_assets.width/height`. Exact, and
 *      the only source that is right when a model returns something other
 *      than what was asked for.
 *   2. THE JOB'S REQUESTED RATIO — `generation_jobs.aspect_ratio`, a label
 *      like "16:9". This is what every asset produced before today has,
 *      because nothing has ever written the width/height columns: on
 *      production, 85 of 85 assets have NULL dimensions and 77 of them were
 *      rendered 16:9. So this branch is not a fallback in practice — it is
 *      currently the whole library, and it is why the grid is about to stop
 *      looking like a chessboard.
 *   3. A SQUARE. Only when there is nothing at all to go on. Never a guess
 *      dressed up as knowledge.
 *
 * The browser's own `naturalWidth` is deliberately NOT consulted. It is the
 * most accurate source there is, and it arrives too late: reading it means the
 * box was already laid out at some other shape, and correcting it afterwards
 * is exactly the layout shift this feature is supposed to remove. What the
 * browser learns is instead written back at GENERATION time (see
 * lib/images/dimensions.ts), so tomorrow's assets take branch 1.
 */

/** Sensible bounds. A ratio outside them is data corruption, not a panorama,
 *  and honouring it would hand one tile a whole screen. */
const MIN_ASPECT = 0.2;   // taller than 1:5
const MAX_ASPECT = 5;     // wider than 5:1

export const SQUARE = 1;

/** The labels the product actually offers, plus the ones a job may carry from
 *  an older release. Parsed generically, so a new one needs no edit here. */
export function parseRatioLabel(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/xX×]\s*(\d+(?:\.\d+)?)\s*$/.exec(label);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return clamp(w / h);
}

function clamp(aspect: number): number | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return null;
  return aspect;
}

/** What a gallery needs to know to shape one tile. Structurally typed on
 *  purpose: the library, the generator gallery and the batch sheet each have
 *  their own item type, and all three already carry these three fields. */
export type RatioSource = {
  width?: number | null;
  height?: number | null;
  /** The job's label, e.g. "16:9". */
  ratio?: string | null;
};

/**
 * The aspect ratio to paint this asset at, as width ÷ height.
 * 1.778 for 16:9, 1 for a square, 0.5625 for 9:16.
 */
export function assetAspect(source: RatioSource | null | undefined): number {
  if (!source) return SQUARE;
  const { width, height } = source;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    const exact = clamp(width / height);
    if (exact !== null) return exact;
  }
  return parseRatioLabel(source.ratio) ?? SQUARE;
}

/** The same answer as a CSS `aspect-ratio` value. Rounded because a style
 *  string that differs in the twelfth decimal between renders is a diff for
 *  no reason. */
export function aspectCss(aspect: number): string {
  return String(Math.round(aspect * 10000) / 10000);
}

/** True when the asset is wider than it is tall — used where a surface wants
 *  to treat landscape and portrait differently (a list row's thumbnail). */
export function isLandscape(source: RatioSource | null | undefined): boolean {
  return assetAspect(source) > 1;
}

/**
 * A HUMAN LABEL FOR THE SHAPE, e.g. "16:9".
 *
 * Prefers the job's own label when there is one — it is what the customer
 * asked for and what they will recognise. Falls back to reducing the real
 * pixels, so an asset with dimensions but no label still says something
 * useful. Returns null rather than inventing a label for an unknown asset.
 */
export function ratioLabel(source: RatioSource | null | undefined): string | null {
  if (!source) return null;
  if (typeof source.ratio === "string" && parseRatioLabel(source.ratio) !== null) {
    return source.ratio.replace(/\s+/g, "");
  }
  const { width, height } = source;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    const d = gcd(Math.round(width), Math.round(height));
    const w = Math.round(width) / d;
    const h = Math.round(height) / d;
    // A reduction like 1237:983 is noise, not a label.
    if (w <= 32 && h <= 32) return `${w}:${h}`;
    return `${Math.round((width / height) * 100) / 100}:1`;
  }
  return null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
