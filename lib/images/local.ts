import "server-only";
import sharp, { type Sharp, type OverlayOptions } from "sharp";

/**
 * LOCAL IMAGE PROCESSOR — everything GrovBase can do without paying a
 * provider. Resize, format conversion, compression, watermarking, flattening
 * an alpha channel onto white and casting a product shadow are all
 * deterministic pixel work, so they run in our own Node runtime and cost the
 * seller nothing.
 *
 * Every function takes and returns a Buffer, so the same code serves the API
 * route, a batch worker and any future queue without changes.
 */

export type OutputFormat = "jpeg" | "png" | "webp";

export const MAX_DIMENSION = 8000;
/** Above this the serverless function starts fighting its memory limit. */
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export type ImageFacts = {
  width: number;
  height: number;
  format: string;
  bytes: number;
  hasAlpha: boolean;
};

export async function inspect(input: Buffer): Promise<ImageFacts> {
  const meta = await sharp(input).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? "unknown",
    bytes: input.length,
    hasAlpha: Boolean(meta.hasAlpha),
  };
}

function encode(pipeline: Sharp, format: OutputFormat, quality: number) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  if (format === "jpeg") return pipeline.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: "4:4:4" });
  if (format === "webp") return pipeline.webp({ quality: q, effort: 4 });
  // PNG has no quality dial; the palette+effort pair is the closest analogue.
  return pipeline.png({ compressionLevel: 9, palette: q < 90, quality: q, effort: 7 });
}

/**
 * RESIZE + CONVERT. Width and height are both optional: giving one keeps the
 * aspect ratio, giving both either fits inside the box (default) or crops to
 * fill it. Never upscales — that is what the paid upscaler is for.
 */
export async function resizeConvert(input: Buffer, opts: {
  format: OutputFormat;
  width?: number | null;
  height?: number | null;
  quality?: number;
  fit?: "inside" | "cover";
  /** Background for the letterbox when fitting a transparent image to JPEG. */
  background?: string;
}): Promise<Buffer> {
  const width = clampDimension(opts.width);
  const height = clampDimension(opts.height);
  let pipeline = sharp(input, { failOn: "none" }).rotate(); // honour EXIF orientation

  if (width || height) {
    pipeline = pipeline.resize({
      width: width ?? undefined,
      height: height ?? undefined,
      fit: opts.fit === "cover" ? "cover" : "inside",
      withoutEnlargement: true,
    });
  }
  // JPEG has no alpha: flatten onto a known colour instead of black.
  if (opts.format === "jpeg") pipeline = pipeline.flatten({ background: opts.background ?? "#ffffff" });
  return encode(pipeline, opts.format, opts.quality ?? 82).toBuffer();
}

/**
 * COMPRESS. Keeps the pixel dimensions and the format, and only re-encodes.
 * "auto" walks the quality down until the file is meaningfully smaller,
 * because a fixed quality either wastes bytes on simple images or ruins
 * detailed ones.
 */
export async function compress(input: Buffer, opts: {
  level: "light" | "balanced" | "strong" | "auto";
  format?: OutputFormat;
}): Promise<{ output: Buffer; quality: number }> {
  const meta = await sharp(input).metadata();
  const format: OutputFormat = opts.format
    ?? (meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpeg");

  if (opts.level !== "auto") {
    const quality = { light: 88, balanced: 78, strong: 62 }[opts.level];
    const output = await encode(sharp(input).rotate(), format, quality).toBuffer();
    return { output: output.length < input.length ? output : input, quality };
  }

  // Auto: stop at the first quality that saves at least a quarter of the file.
  let best = input;
  let bestQuality = 100;
  for (const quality of [86, 78, 70, 62]) {
    const candidate = await encode(sharp(input).rotate(), format, quality).toBuffer();
    best = candidate;
    bestQuality = quality;
    if (candidate.length <= input.length * 0.75) break;
  }
  return best.length < input.length
    ? { output: best, quality: bestQuality }
    : { output: input, quality: 100 };
}

export const WATERMARK_POSITIONS = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
  "pattern",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/**
 * WATERMARK. A single mark placed on one of nine anchors, or a rotated
 * repeating pattern tiled across the whole image. Scale is a share of the
 * image width so the same settings look right on a 800px and a 4000px photo.
 */
export async function watermark(input: Buffer, logo: Buffer, opts: {
  position: WatermarkPosition;
  /** Mark width as a fraction of the image width, 0.02–1. */
  scale: number;
  /** 0–1. */
  opacity: number;
  /** Edge margin in pixels, for the nine anchored positions. */
  margin?: number;
  /** Pattern only: degrees, and the gap between marks in pixels. */
  rotation?: number;
  spacing?: number;
  format?: OutputFormat;
  quality?: number;
}): Promise<Buffer> {
  const base = sharp(input, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("unreadable_image");

  const markWidth = Math.max(16, Math.round(width * clamp(opts.scale, 0.02, 1)));
  const alpha = clamp(opts.opacity, 0.02, 1);

  // Apply opacity by multiplying the logo's own alpha channel.
  const mark = await sharp(logo, { failOn: "none" })
    .resize({ width: markWidth, withoutEnlargement: false })
    .ensureAlpha()
    .composite([{
      input: Buffer.from([255, 255, 255, Math.round(alpha * 255)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: "dest-in",
    }])
    .png()
    .toBuffer();

  const format = opts.format ?? (meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpeg");
  const encodeAs = (p: Sharp) => encode(p, format as OutputFormat, opts.quality ?? 90);

  if (opts.position !== "pattern") {
    // sharp accepts either a gravity or an absolute top/left, never a gravity
    // plus an offset — so the margin is resolved into absolute coordinates.
    const markMeta = await sharp(mark).metadata();
    const mw = markMeta.width ?? markWidth;
    const mh = markMeta.height ?? markWidth;
    const margin = Math.round(opts.margin ?? width * 0.03);
    const place = (position: number, size: number, extent: number) =>
      Math.max(0, Math.min(extent - size, position === -1 ? margin : position === 1 ? extent - size - margin : Math.round((extent - size) / 2)));
    const xAxis = opts.position.endsWith("left") ? -1 : opts.position.endsWith("right") ? 1 : 0;
    const yAxis = opts.position.startsWith("top") ? -1 : opts.position.startsWith("bottom") ? 1 : 0;

    const composed = sharp(input, { failOn: "none" }).rotate().composite([{
      input: mark,
      left: place(xAxis, mw, width),
      top: place(yAxis, mh, height),
    }]);
    return encodeAs(composed).toBuffer();
  }

  // PATTERN — rotate the mark once, then tile it across a transparent layer
  // large enough that rotation cannot leave uncovered corners.
  const rotated = await sharp(mark)
    .rotate(opts.rotation ?? -30, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const rotatedMeta = await sharp(rotated).metadata();
  const stepX = (rotatedMeta.width ?? markWidth) + Math.max(0, opts.spacing ?? Math.round(markWidth * 0.5));
  const stepY = (rotatedMeta.height ?? markWidth) + Math.max(0, opts.spacing ?? Math.round(markWidth * 0.5));

  const tiles: OverlayOptions[] = [];
  // Cap the tile count so a huge image with a tiny mark cannot exhaust memory.
  const maxTiles = 600;
  for (let y = -stepY; y < height + stepY && tiles.length < maxTiles; y += stepY) {
    for (let x = -stepX; x < width + stepX && tiles.length < maxTiles; x += stepX) {
      tiles.push({ input: rotated, left: Math.round(x), top: Math.round(y) });
    }
  }
  const layer = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(tiles).png().toBuffer();

  return encodeAs(sharp(input, { failOn: "none" }).rotate().composite([{ input: layer }])).toBuffer();
}

/**
 * WHITE BACKGROUND. Flattening an existing alpha channel onto white is pure
 * pixel work — no AI, no cost. When the image has no alpha there is nothing
 * to flatten and the caller must remove the background first.
 */
export async function flattenToColor(input: Buffer, opts: {
  color?: string;
  format?: OutputFormat;
  quality?: number;
  /** Pad the subject away from the frame edge, as a share of the width. */
  padding?: number;
}): Promise<Buffer> {
  const color = opts.color ?? "#ffffff";
  let pipeline = sharp(input, { failOn: "none" }).rotate();
  if (opts.padding && opts.padding > 0) {
    const meta = await sharp(input).metadata();
    const pad = Math.round((meta.width ?? 1000) * clamp(opts.padding, 0, 0.3));
    pipeline = pipeline.extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  return encode(pipeline.flatten({ background: color }), opts.format ?? "jpeg", opts.quality ?? 90).toBuffer();
}

export const SHADOW_STYLES = ["soft", "contact", "floating"] as const;
export type ShadowStyle = (typeof SHADOW_STYLES)[number];

/**
 * PRODUCT SHADOW from the cutout's own alpha channel.
 *
 * The subject's silhouette IS the shadow: take the alpha, blur it, tint it,
 * offset it and lay the product back on top. "contact" squashes the
 * silhouette against the base so it reads as sitting on a surface;
 * "floating" keeps it round and further away. No model involved, so no cost.
 * A realistic ray-traced shadow can be added later as a paid option.
 */
export async function dropShadow(input: Buffer, opts: {
  style: ShadowStyle;
  /** 0–1 */
  opacity?: number;
  /** Blur radius in pixels, before scaling to the image. */
  blur?: number;
  offsetX?: number;
  offsetY?: number;
  background?: string;
  format?: OutputFormat;
  quality?: number;
}): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  if (!meta.hasAlpha) throw new Error("needs_transparency");
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("unreadable_image");

  const style = opts.style;
  const opacity = clamp(opts.opacity ?? (style === "contact" ? 0.5 : 0.35), 0.02, 1);
  const blur = Math.max(1, opts.blur ?? Math.round(width * (style === "contact" ? 0.012 : 0.03)));
  const offsetX = Math.round(opts.offsetX ?? 0);
  const offsetY = Math.round(opts.offsetY ?? (style === "floating" ? width * 0.05 : width * 0.015));

  // Grow the canvas so the blurred, offset silhouette is not clipped.
  const pad = Math.round(blur * 3 + Math.max(Math.abs(offsetX), Math.abs(offsetY)) + width * 0.04);
  const canvasW = width + pad * 2;
  const canvasH = height + pad * 2;

  // The silhouette: the alpha channel as a greyscale mask.
  const silhouette = await sharp(input).ensureAlpha().extractChannel("alpha").toBuffer();
  const squashed = style === "contact"
    ? await sharp(silhouette).resize({
        width, height: Math.max(8, Math.round(height * 0.16)), fit: "fill",
      }).toBuffer()
    : silhouette;
  const shadowH = style === "contact" ? Math.max(8, Math.round(height * 0.16)) : height;

  // Tint it black at the requested opacity, then blur.
  const shadowLayer = await sharp({
    create: { width, height: shadowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: squashed, blend: "dest-in" }])
    .ensureAlpha()
    .composite([{
      input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: "dest-in",
    }])
    .blur(blur)
    .png()
    .toBuffer();

  const shadowTop = style === "contact"
    ? pad + height - shadowH + offsetY
    : pad + offsetY;

  const composed = sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: shadowLayer, left: pad + offsetX, top: shadowTop },
    { input: await sharp(input).png().toBuffer(), left: pad, top: pad },
  ]);

  const format = opts.format ?? (opts.background ? "jpeg" : "png");
  const flattened = opts.background
    ? composed.flatten({ background: opts.background })
    : composed;
  return encode(flattened, format, opts.quality ?? 92).toBuffer();
}

/**
 * CANVAS FOR OUTPAINTING. Places the original inside a transparent canvas of
 * the target aspect ratio and returns both the canvas and the mask marking
 * what has to be generated. Building this locally means the paid provider
 * only ever does the one thing we cannot: invent the new pixels.
 */
export async function expandCanvas(input: Buffer, ratio: string): Promise<{
  canvas: Buffer; mask: Buffer; width: number; height: number;
}> {
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("unreadable_image");

  const [rw, rh] = ratio.split(":").map(Number);
  if (!rw || !rh) throw new Error("bad_ratio");
  const target = rw / rh;
  const current = w / h;

  // Grow the short side; the original is never cropped or scaled.
  const width = current < target ? Math.round(h * target) : w;
  const height = current < target ? h : Math.round(w / target);
  const left = Math.round((width - w) / 2);
  const top = Math.round((height - h) / 2);

  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: await sharp(input).rotate().png().toBuffer(), left, top }]).png().toBuffer();

  // Mask convention (OpenAI images/edits): transparent = repaint this area,
  // opaque = keep. So the original's footprint is punched out as opaque.
  const mask = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: await sharp({
      create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer(),
    left, top,
  }]).png().toBuffer();

  return { canvas, mask, width, height };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampDimension(value?: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return Math.min(MAX_DIMENSION, Math.max(1, Math.round(value)));
}
