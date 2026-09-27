import { RATIO_SHAPE, type AspectRatio } from "./types";

/**
 * "ORYGINALNY" = THE SOURCE PHOTO'S OWN PROPORTIONS — stated, not hoped for.
 *
 * Sending no ratio leaves the output shape to the model, and the model does
 * not reliably keep the photo's shape: on PROD the same 933×700 photo came
 * back 2388×1792 (4:3, kept) at 2K and 5632×3072 (≈ 11:6, re-framed) at 4K.
 * So "Oryginalny" is translated into the official ratio NEAREST the photo
 * and that ratio is sent explicitly. The photo itself is never touched — no
 * crop, no resize, no letterbox; only the requested output shape is named.
 *
 * Nearest = smallest |ln(ratio) − ln(width / height)|: distance in log space
 * treats 2:1-too-wide and 1:2-too-tall alike, so portrait and landscape are
 * judged the same way. Deterministic: the same dimensions and list always
 * give the same answer, and an exact tie keeps the ratio listed first.
 * Returns null when the dimensions are unknown or not positive — the caller
 * then sends no ratio (the provider's default), and records that it did.
 */
export function resolveOriginalAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
  supported: readonly AspectRatio[],
): AspectRatio | null {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const target = Math.log(width / height);
  let best: AspectRatio | null = null;
  let bestDelta = Infinity;
  for (const r of supported) {
    if (r === "auto") continue;
    const shape = RATIO_SHAPE[r];
    if (!shape) continue;
    const delta = Math.abs(Math.log(shape.w / shape.h) - target);
    if (delta < bestDelta) { bestDelta = delta; best = r; }
  }
  return best;
}

/** width / height, rounded for the record (never used to decide anything). */
export function sourceAspect(width: number | null | undefined, height: number | null | undefined): number | null {
  return width && height && width > 0 && height > 0 ? Math.round((width / height) * 1e6) / 1e6 : null;
}
