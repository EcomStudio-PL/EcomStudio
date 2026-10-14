import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { innerPx, marginPx, type FinishConfig } from "@/lib/thumbnail/config";

/**
 * MINIATURKA'S LOCAL FINISH — deterministic pixel work, no AI, no provider.
 *
 *   1. The composition as the model returned it, flattened onto pure white
 *      (no alpha survives) and converted to sRGB.
 *   2. Scaled to fit INSIDE the inner square (target − 2·margin) with the
 *      configured kernel (Lanczos3 by default): proportions kept, nothing
 *      cropped, nothing stretched. 2048 → 2406 for the default 2560 / 3%.
 *   3. Brightness raised (+5% by default) on THAT inner image only — sharp's
 *      `modulate({ brightness })`, a lightness multiplier. 0% skips the step.
 *   4. Placed centred on a 2560×2560 canvas of #FFFFFF. The margin is created
 *      AFTER the brightness step, so it is pure white by construction.
 *   5. Encoded (PNG by default; JPEG q95 4:4:4 if the operator chose it),
 *      three channels, sRGB.
 *   6. VERIFIED from the encoded bytes: exact size, no alpha, three channels,
 *      and every pixel of the margin RGB 255/255/255 — a file that fails is
 *      never delivered.
 *
 * Each stage is its own sharp pass over raw pixels, so the order above is the
 * order that happens (a single sharp chain applies its operations in a fixed
 * internal order of its own, not the order they are written in).
 */

const WHITE = { r: 255, g: 255, b: 255 };

export type FinishResult = {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
  width: number;
  height: number;
  sha256: string;
  source: { width: number; height: number; format: string | null; hasAlpha: boolean };
  inner: { width: number; height: number; left: number; top: number };
  marginPx: number;
  config: FinishConfig;
  checks: { size: boolean; channels: number; alpha: boolean; marginWhite: boolean };
  postprocess: string[];
};

export class FinishError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export async function finishThumbnail(raw: Buffer, cfg: FinishConfig): Promise<FinishResult> {
  const meta = await sharp(raw, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) throw new FinishError("finish_unreadable");
  const m = marginPx(cfg.target, cfg.marginPercent);
  const box = innerPx(cfg.target, cfg.marginPercent);
  if (box < 1) throw new FinishError("finish_config");
  const steps: string[] = [];

  // 1 + 2 — flatten onto white, sRGB, fit inside the inner square.
  const scaled = await sharp(raw, { failOn: "none" })
    .toColourspace("srgb")
    .flatten({ background: WHITE })
    .resize({ width: box, height: box, fit: "inside", kernel: cfg.kernel })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  steps.push(`flatten:#FFFFFF`, `resize:${meta.width}x${meta.height}->${scaled.info.width}x${scaled.info.height}:${cfg.kernel}:inside`);

  // 3 — brightness on the inner image only.
  let inner = scaled.data;
  if (cfg.brightnessPercent !== 0) {
    inner = await sharp(scaled.data, { raw: { width: scaled.info.width, height: scaled.info.height, channels: 3 } })
      .modulate({ brightness: 1 + cfg.brightnessPercent / 100 })
      .removeAlpha()
      .raw()
      .toBuffer();
    steps.push(`brightness:${cfg.brightnessPercent > 0 ? "+" : ""}${cfg.brightnessPercent}%:inner_only`);
  }

  // 4 — centre on the white canvas.
  const left = m + Math.floor((box - scaled.info.width) / 2);
  const top = m + Math.floor((box - scaled.info.height) / 2);
  // (composite hands back RGBA; the alpha it adds is dropped in a pass of
  // its own, after which the image is three opaque sRGB channels.)
  const placed = await sharp({ create: { width: cfg.target, height: cfg.target, channels: 3, background: WHITE } })
    .composite([{ input: inner, raw: { width: scaled.info.width, height: scaled.info.height, channels: 3 }, left, top }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  const canvas = sharp(placed.data, { raw: { width: placed.info.width, height: placed.info.height, channels: placed.info.channels } })
    .removeAlpha()
    .toColourspace("srgb");
  steps.push(`canvas:${cfg.target}x${cfg.target}:#FFFFFF:margin_${m}px`);

  // 5 — encode.
  const jpeg = cfg.format === "jpeg";
  const bytes = jpeg
    ? await canvas.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer()
    : await canvas.png({ compressionLevel: 9 }).toBuffer();
  steps.push(jpeg ? "encode:jpeg:q95:444" : "encode:png");

  // 6 — verify what will actually be stored.
  const check = await verifyThumbnail(bytes, cfg.target, m);
  if (!check.size) throw new FinishError("finish_size");
  if (check.alpha || check.channels !== 3) throw new FinishError("finish_alpha");
  if (!check.marginWhite) throw new FinishError("finish_margin");

  return {
    bytes,
    mime: jpeg ? "image/jpeg" : "image/png",
    ext: jpeg ? "jpg" : "png",
    width: cfg.target,
    height: cfg.target,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source: { width: meta.width, height: meta.height, format: meta.format ?? null, hasAlpha: Boolean(meta.hasAlpha) },
    inner: { width: scaled.info.width, height: scaled.info.height, left, top },
    marginPx: m,
    config: cfg,
    checks: check,
    postprocess: steps,
  };
}

/**
 * Decode the encoded file and check it: size, channels, alpha, and the margin
 * band on all four sides. Exported for the tests and for the run's record.
 *
 * PNG is lossless, so its margin must be exactly 255/255/255 everywhere. A
 * JPEG's 8×8 blocks straddle the inner edge and ring into it, so for JPEG the
 * band 8 px next to the photo is not judged and the rest may sit 2 levels
 * below 255.
 */
export async function verifyThumbnail(bytes: Buffer, target: number, margin: number):
  Promise<{ size: boolean; channels: number; alpha: boolean; marginWhite: boolean }> {
  const meta = await sharp(bytes, { failOn: "none" }).metadata();
  const decoded = await sharp(bytes, { failOn: "none" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  const size = width === target && height === target;
  const lossy = meta.format === "jpeg";
  const tol = lossy ? 2 : 0;
  // The band that is judged: the full margin (PNG), or all but its inner 8 px.
  margin = lossy ? Math.max(0, margin - 8) : margin;
  let marginWhite = true;
  if (size && margin > 0) {
    const px = decoded.data;
    const isWhite = (x: number, y: number) => {
      const o = (y * width + x) * channels;
      for (let c = 0; c < Math.min(3, channels); c++) if (px[o + c] < 255 - tol) return false;
      return true;
    };
    outer: for (let y = 0; y < height; y++) {
      const band = y < margin || y >= height - margin;
      for (let x = 0; x < width; x++) {
        if (!band && x >= margin && x < width - margin) { x = width - margin - 1; continue; }
        if (!isWhite(x, y)) { marginWhite = false; break outer; }
      }
    }
  }
  return { size, channels, alpha: Boolean(meta.hasAlpha) || channels === 4, marginWhite };
}
