import "server-only";
import sharp from "sharp";

/**
 * RETUSZ DELIVERY — the customer's 2K / 4K and format, applied to the FINAL
 * image AFTER Gemini answered. Deterministic bitmap work only (sharp): no AI,
 * no second provider call, no upscaler model.
 *
 * The Gemini request never carries the size or the ratio (the launch-safe
 * baseline 18ad7a8 / 5113398: {model, input:[text, image],
 * response_modalities:["image"], store:false}); these two choices change the
 * delivered FILE only:
 *   · quality — the longer side becomes 2048 (2K) or 4096 (4K) px, Lanczos3;
 *   · format  — "auto" (Oryginalny) keeps the provider image's exact
 *     proportions; a ratio builds a canvas of exactly that ratio and places
 *     the WHOLE image in it (fit: contain) on white #FFFFFF. Nothing is
 *     cropped, nothing in the picture is changed — only its pixel size.
 */

export const RETOUCH_DELIVERY_SIZES = ["2K", "4K"] as const;
export type RetouchDeliverySize = (typeof RETOUCH_DELIVERY_SIZES)[number];
const LONG_EDGE: Record<RetouchDeliverySize, number> = { "2K": 2048, "4K": 4096 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

export type RetouchDelivered = {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  /** "deterministic_resize" (Oryginalny) or "deterministic_resize_canvas" (a ratio). */
  postprocess: "deterministic_resize" | "deterministic_resize_canvas";
};

export function isRetouchDeliverySize(s: unknown): s is RetouchDeliverySize {
  return (RETOUCH_DELIVERY_SIZES as readonly unknown[]).includes(s);
}

/** Canvas size for a ratio "a:b" whose longer side is `edge`. */
export function retouchCanvasSize(ratio: string, edge: number): { width: number; height: number } | null {
  const m = /^(\d+):(\d+)$/.exec(ratio);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (!a || !b) return null;
  return a >= b ? { width: edge, height: Math.round((edge * b) / a) } : { width: Math.round((edge * a) / b), height: edge };
}

export async function deliverRetouch(
  source: Buffer, sourceMime: string, size: RetouchDeliverySize, aspectRatio: string,
): Promise<RetouchDelivered> {
  const edge = LONG_EDGE[size];
  const canvas = aspectRatio === "auto" ? null : retouchCanvasSize(aspectRatio, edge);
  let img = sharp(source, { failOn: "none" }).keepIccProfile();
  img = canvas
    ? img.resize({ width: canvas.width, height: canvas.height, fit: "contain", background: WHITE, kernel: "lanczos3" })
    : img.resize({ width: edge, height: edge, fit: "inside", kernel: "lanczos3" });
  // Same family as the provider's file: JPEG stays JPEG (q95, no chroma
  // subsampling), everything else is written as lossless PNG.
  const jpeg = /jpe?g/i.test(sourceMime);
  const { data, info } = await (jpeg ? img.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }) : img.png())
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: data,
    mime: jpeg ? "image/jpeg" : "image/png",
    width: info.width,
    height: info.height,
    postprocess: canvas ? "deterministic_resize_canvas" : "deterministic_resize",
  };
}
