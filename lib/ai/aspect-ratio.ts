import { RATIO_SHAPE, type AspectRatio } from "./types";

/**
 * DIAGNOSTICS ONLY — never used to build a provider request.
 *
 * The official ratio nearest a photo's proportions (log distance,
 * deterministic). Retusz "Oryginalny" sends NO aspectRatio (Google picks the
 * shape from the reference image); sending this derived value was tried in
 * 30b6f7c and reverted after worse PROD results. Kept for the admin record /
 * future comparison only.
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
