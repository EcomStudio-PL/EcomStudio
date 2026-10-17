import "server-only";
import sharp from "sharp";
import { crc32 } from "zlib";
import type { TrialWatermarkConfig } from "@/lib/trial-watermark/config";
import { TRIAL_WATERMARK_ASSET_HEIGHT, TRIAL_WATERMARK_ASSET_WIDTH, watermarkMask } from "./asset";

/**
 * TRIAL WATERMARK — the LAST thing done to a trial image's pixels.
 *
 * Runs after everything else a producer does (Retusz delivery, the Miniaturka
 * finish), on the exact bytes that would otherwise be stored, and returns a
 * file of the same format and the same pixel size with the GrovBase mark
 * baked in. The clean bytes it was given are never altered here; the caller
 * keeps them (encrypted) as the original.
 *
 *   1. The mark is centred, its width a share of the image's SHORTER side
 *      (config.widthRatio, 0.5 by default), proportions kept, never wider
 *      than the 3328 px asset itself — the asset is only ever scaled down.
 *   2. The image's luminance is measured over exactly the rectangle the mark
 *      will cover (sRGB-encoded Rec.709 luma, 0..1). Brighter than
 *      config.luminanceThreshold → the dark variant (config.darkColor);
 *      otherwise the asset's own white.
 *   3. A soft glow of the OPPOSITE colour sits under the mark (Gaussian, its
 *      radius a share of the mark's width, its own opacity), so the mark
 *      reads on busy backgrounds too.
 *   4. Glow, then mark, are composited; the result is re-encoded in the input's
 *      format (JPEG q95 4:4:4, PNG, WebP q95) with its ICC profile kept, and
 *      tagged "Generated with GrovBase – grovbase.com" (EXIF, XMP, and a PNG
 *      iTXt chunk).
 *
 * Both colour variants come from the asset's ALPHA alone: every visible pixel
 * of the supplied PNG is white, so the logo is entirely in its alpha.
 *
 * Anything this cannot do — an unsupported format, an unreadable file, a
 * missing asset — THROWS. Callers treat a throw as "this image cannot be
 * delivered" (refund), never as "deliver it clean".
 */

export const TRIAL_WATERMARK_TEXT = "Generated with GrovBase – grovbase.com";
/** EXIF ASCII fields cannot hold the en dash; libvips would transliterate it anyway. */
export const TRIAL_WATERMARK_TEXT_ASCII = "Generated with GrovBase - grovbase.com";

export type TrialWatermarkParams = Pick<TrialWatermarkConfig,
  "widthRatio" | "opacity" | "luminanceThreshold" | "darkColor" | "glowRadiusRatio" | "glowOpacity">;

export type TrialWatermarkInfo = {
  variant: "light" | "dark";
  /** Mean luma of the covered region, 0..1. */
  luminance: number;
  threshold: number;
  markWidth: number;
  markHeight: number;
  /** markWidth / asset width (≤ 1: the asset is never enlarged). */
  scale: number;
  opacity: number;
  glowRadiusPx: number;
  glowOpacity: number;
  left: number;
  top: number;
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp";
};

export class TrialWatermarkError extends Error {
  constructor(public readonly code: "unsupported_format" | "unreadable" | "too_small") {
    super(code);
  }
}

const MIME: Record<TrialWatermarkInfo["format"], string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const WHITE: [number, number, number] = [255, 255, 255];

function rgbOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [17, 17, 17];
}

/** Geometry of the mark on an image of `width`×`height` (already upright). */
export function markGeometry(width: number, height: number, widthRatio: number) {
  const shorter = Math.min(width, height);
  const markWidth = Math.max(1, Math.min(TRIAL_WATERMARK_ASSET_WIDTH, Math.round(widthRatio * shorter)));
  const markHeight = Math.max(1, Math.round(markWidth * TRIAL_WATERMARK_ASSET_HEIGHT / TRIAL_WATERMARK_ASSET_WIDTH));
  return {
    markWidth, markHeight,
    left: Math.floor((width - markWidth) / 2),
    top: Math.floor((height - markHeight) / 2),
  };
}

/** Mean sRGB-encoded luma (0..1) of an interleaved 3-channel raw buffer. */
export function meanLuma(raw: Buffer): number {
  let sum = 0;
  const px = Math.floor(raw.length / 3);
  if (px === 0) return 0;
  for (let i = 0; i < px * 3; i += 3) sum += 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
  return sum / px / 255;
}

type Layers = { mark: Buffer; glow: Buffer | null; pad: number; w: number; h: number };
const layerCache = new Map<string, Promise<Layers>>();
const LAYER_CACHE_MAX = 8;

/** The mark (and its glow) at `w`×`h`, as raw RGBA, cached by every input that shapes them. */
function layers(w: number, h: number, pad: number, sigma: number, p: TrialWatermarkParams, variant: "light" | "dark"): Promise<Layers> {
  const key = [w, h, pad, sigma, p.opacity, p.glowOpacity, p.darkColor, variant].join("|");
  const hit = layerCache.get(key);
  if (hit) return hit;
  const made = (async (): Promise<Layers> => {
    const mask = await watermarkMask();
    const alpha = w === mask.width && h === mask.height
      ? mask.alpha
      : await sharp(mask.alpha, { raw: { width: mask.width, height: mask.height, channels: 1 } })
        .resize(w, h, { kernel: "lanczos3", fit: "fill" })
        // A one-band input comes back as three bands unless asked otherwise.
        .extractChannel(0)
        .raw().toBuffer();
    if (alpha.length !== w * h) throw new TrialWatermarkError("unreadable");
    const dark = rgbOf(p.darkColor);
    const markRgb = variant === "dark" ? dark : WHITE;
    const glowRgb = variant === "dark" ? WHITE : dark;
    const mark = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      mark[i * 4] = markRgb[0]; mark[i * 4 + 1] = markRgb[1]; mark[i * 4 + 2] = markRgb[2];
      mark[i * 4 + 3] = Math.round(alpha[i] * p.opacity);
    }
    let glow: Buffer | null = null;
    if (pad > 0 && sigma >= 0.3 && p.glowOpacity > 0) {
      const gw = w + 2 * pad, gh = h + 2 * pad;
      const blurred = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0 } })
        .blur(sigma)
        .extractChannel(0)
        .raw().toBuffer();
      if (blurred.length !== gw * gh) throw new TrialWatermarkError("unreadable");
      glow = Buffer.alloc(gw * gh * 4);
      for (let i = 0; i < gw * gh; i++) {
        glow[i * 4] = glowRgb[0]; glow[i * 4 + 1] = glowRgb[1]; glow[i * 4 + 2] = glowRgb[2];
        glow[i * 4 + 3] = Math.round(blurred[i] * p.glowOpacity);
      }
    }
    return { mark, glow, pad, w, h };
  })();
  layerCache.set(key, made);
  made.catch(() => layerCache.delete(key));
  while (layerCache.size > LAYER_CACHE_MAX) layerCache.delete(layerCache.keys().next().value as string);
  return made;
}

const XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${TRIAL_WATERMARK_TEXT}</rdf:li></rdf:Alt></dc:description>
   <xmp:CreatorTool>GrovBase</xmp:CreatorTool>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/**
 * A PNG with an uncompressed iTXt "Description" chunk carrying the exact
 * (UTF-8) text, right after IHDR. sharp writes EXIF (eXIf) and XMP (zTXt) but
 * has no PNG text writer; this chunk is what most viewers show as the file's
 * description. Pixels are untouched.
 */
export function withPngDescription(png: Buffer, text: string): Buffer {
  const SIG = 8;
  if (png.length < SIG + 25 || png.toString("latin1", SIG + 4, SIG + 8) !== "IHDR") return png;
  const ihdrEnd = SIG + 8 + png.readUInt32BE(SIG) + 4;
  const data = Buffer.concat([
    Buffer.from("Description", "latin1"), Buffer.from([0, 0, 0]), // keyword\0, compression flag, method
    Buffer.from([0]), Buffer.from([0]),                             // language tag "", translated keyword ""
    Buffer.from(text, "utf8"),
  ]);
  const type = Buffer.from("iTXt", "latin1");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  return Buffer.concat([png.subarray(0, ihdrEnd), len, type, data, crc, png.subarray(ihdrEnd)]);
}

/**
 * The watermarked file for `input`. Same format, same (upright) pixel size.
 * Throws TrialWatermarkError / TrialWatermarkAssetError when it cannot be
 * made — the caller must then not deliver the image at all.
 */
export async function applyTrialWatermark(
  input: Buffer, params: TrialWatermarkParams,
): Promise<{ bytes: Buffer; mime: string; info: TrialWatermarkInfo }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { failOn: "none" }).metadata();
  } catch {
    throw new TrialWatermarkError("unreadable");
  }
  const format = meta.format === "jpeg" || meta.format === "png" || meta.format === "webp" ? meta.format : null;
  if (!format) throw new TrialWatermarkError("unsupported_format");
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new TrialWatermarkError("unreadable");
  if (Math.min(width, height) < 16) throw new TrialWatermarkError("too_small");

  const g = markGeometry(width, height, params.widthRatio);

  // Luminance of exactly the covered rectangle, on an upright, white-backed
  // copy (a transparent cutout reads as the white it is usually shown on).
  // A small proxy is enough: only the mean is needed.
  const region = await sharp(input, { failOn: "none" })
    .autoOrient()
    .extract({ left: g.left, top: g.top, width: g.markWidth, height: g.markHeight })
    .resize({ width: Math.min(g.markWidth, 256), height: Math.min(g.markHeight, 256), fit: "fill" })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw().toBuffer();
  const luminance = meanLuma(region);
  const variant: "light" | "dark" = luminance > params.luminanceThreshold ? "dark" : "light";

  // The glow's reach: radius = share of the mark's width; σ = radius / 2, and
  // the layer is padded by 3σ — clipped to what fits inside the image.
  const glowRadiusPx = params.glowRadiusRatio * g.markWidth;
  const sigma = glowRadiusPx / 2;
  const room = Math.min(g.left, g.top, width - g.markWidth - g.left, height - g.markHeight - g.top);
  const pad = params.glowOpacity > 0 && sigma >= 0.3 ? Math.max(0, Math.min(Math.ceil(3 * sigma), room)) : 0;

  const L = await layers(g.markWidth, g.markHeight, pad, sigma, params, variant);
  const overlays: sharp.OverlayOptions[] = [];
  if (L.glow) {
    overlays.push({ input: L.glow, raw: { width: L.w + 2 * L.pad, height: L.h + 2 * L.pad, channels: 4 }, left: g.left - L.pad, top: g.top - L.pad });
  }
  overlays.push({ input: L.mark, raw: { width: L.w, height: L.h, channels: 4 }, left: g.left, top: g.top });

  let pipe = sharp(input, { failOn: "none" }).autoOrient().composite(overlays);
  if (!meta.hasAlpha) pipe = pipe.removeAlpha();
  pipe = pipe
    .keepIccProfile()
    .withExif({ IFD0: { ImageDescription: TRIAL_WATERMARK_TEXT_ASCII, Software: "GrovBase", XPComment: TRIAL_WATERMARK_TEXT } })
    .withXmp(XMP);
  let out: Buffer;
  if (format === "jpeg") out = await pipe.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  else if (format === "webp") out = await pipe.webp({ quality: 95 }).toBuffer();
  else out = withPngDescription(await pipe.png().toBuffer(), TRIAL_WATERMARK_TEXT);

  return {
    bytes: out,
    mime: MIME[format],
    info: {
      variant,
      luminance: Math.round(luminance * 10000) / 10000,
      threshold: params.luminanceThreshold,
      markWidth: g.markWidth,
      markHeight: g.markHeight,
      scale: Math.round((g.markWidth / TRIAL_WATERMARK_ASSET_WIDTH) * 10000) / 10000,
      opacity: params.opacity,
      glowRadiusPx: Math.round(glowRadiusPx * 100) / 100,
      glowOpacity: params.glowOpacity,
      left: g.left,
      top: g.top,
      width,
      height,
      format,
    },
  };
}
