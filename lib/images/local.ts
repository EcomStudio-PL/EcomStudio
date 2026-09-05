import "server-only";
import sharp, { type Sharp, type OverlayOptions } from "sharp";
import type { EditorRatio, EditorState, ShadowPreset } from "./editor-state";

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

export type OutputFormat = "jpeg" | "png" | "webp" | "tiff";

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
  // TIFF for print pipelines: LZW is lossless, so the quality dial is moot.
  if (format === "tiff") return pipeline.tiff({ compression: "lzw" });
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
  /** The shadow's own colour. Black unless a scene calls for something warmer. */
  color?: string;
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

  // Tint it — black unless asked otherwise — at the requested opacity, then blur.
  const shadowLayer = await sharp({
    create: { width, height: shadowH, channels: 4, background: opts.color ?? { r: 0, g: 0, b: 0, alpha: 1 } },
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

/* ── the editor bake ───────────────────────────────────────────────────── */

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Which of dropShadow's three silhouette geometries each preset asks for.
 *  "strong" and "wall" are the same silhouette as "soft" — what separates them
 *  is opacity, blur and offset, which is genuinely all a cast shadow is. */
const PRESET_STYLE: Record<Exclude<ShadowPreset, "none">, ShadowStyle> = {
  soft: "soft",
  strong: "soft",
  floating: "floating",
  wall: "soft",
};

/** null = "whatever the photo already is". */
const RATIO_VALUE: Record<EditorRatio, number | null> = {
  original: null,
  custom: null,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

/**
 * COMPOSE — a whole editor state baked in one go.
 *
 * The order below is the entire correctness story, and it is not the order the
 * panel lists the controls in:
 *
 *   transform → background → shadow → adjust → fit the target box → encode
 *
 * The shadow is cut from the product's OWN alpha, so it has to be cast before
 * anything flattens that alpha away — which is why the background colour is
 * handed to dropShadow instead of being painted first. Adjustments and the
 * resize share one sharp chain: libvips resolves a chain in its own fixed order
 * (resize → extend → modulate → sharpen → linear), which puts the unsharp mask
 * AFTER the downscale, the only order in which sharpening survives at all.
 *
 * Every intermediate handoff is PNG: lossless, so a five-step edit does not
 * accumulate five generations of JPEG artefacts on the product.
 */
export async function composeEditor(input: Buffer, state: EditorState, opts: {
  format: OutputFormat;
  quality: number;
}): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) throw new Error("image_too_large");
  // There is no text-to-background generator here and no way to fetch a plate
  // from inside the pipeline, so this mode is REFUSED rather than quietly
  // ignored. A control that does nothing is worse than one that says no.
  if (state.background.mode === "image") throw new Error("background_unavailable");

  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable_image");

  // Normalise once, and only when it is actually needed: EXIF orientation has
  // to be resolved before any crop maths, and a one-band photo would break the
  // per-channel gains further down.
  const needsNormalising = (meta.channels ?? 3) < 3 || (meta.orientation ?? 1) > 1;
  let buffer = needsNormalising
    ? await sharp(input, { failOn: "none" }).rotate().toColourspace("srgb").png().toBuffer()
    : input;

  buffer = await applyTransform(buffer, state.transform);

  // JPEG has no alpha, and "paint the background" means the same thing.
  const opaque = opts.format === "jpeg" || state.background.mode === "color";
  const fill = state.background.mode === "color" ? state.background.color : "#FFFFFF";

  if (state.shadow.preset !== "none") {
    const facts = await sharp(buffer).metadata();
    // The cutout's alpha IS the shadow. Without one there is no silhouette to
    // cast, and inventing one would be a lie about the product's shape.
    if (!facts.hasAlpha) throw new Error("needs_transparency");
    buffer = await dropShadow(buffer, {
      style: PRESET_STYLE[state.shadow.preset],
      opacity: state.shadow.opacity / 100,
      blur: state.shadow.blur,
      offsetX: state.shadow.offsetX,
      offsetY: state.shadow.offsetY,
      color: state.shadow.color,
      // Flattened here, not later: the shadow belongs ON the backdrop, not
      // over a transparent hole punched through it.
      background: opaque ? fill : undefined,
      format: "png",
      quality: 100,
    });
  }

  const framed = await sharp(buffer).metadata();
  const frame = { width: framed.width ?? 0, height: framed.height ?? 0 };
  if (!frame.width || !frame.height) throw new Error("unreadable_image");

  const box = targetBox(frame, state.format);
  // Fit INSIDE the box and pad out to it: the canvas grows, the product is
  // never cropped to reach a ratio, and it is never enlarged to reach a size —
  // adding detail that was not photographed is the paid upscaler's job.
  const ratio = Math.min(box.width / frame.width, box.height / frame.height, 1);
  const inner = {
    width: Math.max(1, Math.round(frame.width * ratio)),
    height: Math.max(1, Math.round(frame.height * ratio)),
  };
  const padLeft = Math.floor((box.width - inner.width) / 2);
  const padTop = Math.floor((box.height - inner.height) / 2);

  let pipeline = sharp(buffer, { failOn: "none" });
  if (opaque) pipeline = pipeline.flatten({ background: fill });
  if (inner.width !== frame.width || inner.height !== frame.height) {
    pipeline = pipeline.resize({ width: inner.width, height: inner.height, fit: "fill" });
  }
  if (inner.width !== box.width || inner.height !== box.height) {
    pipeline = pipeline.extend({
      top: padTop,
      bottom: box.height - inner.height - padTop,
      left: padLeft,
      right: box.width - inner.width - padLeft,
      background: opaque ? fill : TRANSPARENT,
    });
  }
  return encode(applyAdjust(pipeline, state.adjust), opts.format, opts.quality).toBuffer();
}

/**
 * TRANSFORM — mirror, free rotation, then zoom and pan inside the frame.
 *
 * Two passes at most, and only when something actually moved: the frame that
 * the zoom pans within is the one the rotation produced, so its size cannot be
 * known until the rotation has run.
 */
async function applyTransform(input: Buffer, t: EditorState["transform"]): Promise<Buffer> {
  const framing = t.rotate !== 0 || t.flipH || t.flipV;
  const panning = t.scale !== 100 || t.offsetX !== 0 || t.offsetY !== 0;
  if (!framing && !panning) return input;

  let buffer = input;
  if (framing) {
    let pipeline = sharp(input, { failOn: "none" });
    // sharp names these after the axis the pixels travel along: flop is the
    // left/right mirror, flip the top/bottom one.
    if (t.flipH) pipeline = pipeline.flop();
    if (t.flipV) pipeline = pipeline.flip();
    // A free angle grows the canvas; the corners it opens up stay transparent
    // so the background step decides what fills them.
    if (t.rotate !== 0) pipeline = pipeline.rotate(t.rotate, { background: TRANSPARENT });
    buffer = await pipeline.png().toBuffer();
  }
  if (!panning) return buffer;

  const meta = await sharp(buffer).metadata();
  const frameW = meta.width ?? 0;
  const frameH = meta.height ?? 0;
  if (!frameW || !frameH) throw new Error("unreadable_image");

  // Where the zoomed image lands inside the frame it started from. Offsets are
  // a share of the frame, so the same pan reads identically on an 800px and a
  // 4000px photo.
  const scaledW = clampSide((frameW * t.scale) / 100);
  const scaledH = clampSide((frameH * t.scale) / 100);
  const left = Math.round((frameW - scaledW) / 2 + (frameW * t.offsetX) / 100);
  const top = Math.round((frameH - scaledH) / 2 + (frameH * t.offsetY) / 100);

  const vx0 = Math.max(0, left);
  const vy0 = Math.max(0, top);
  const vx1 = Math.min(frameW, left + scaledW);
  const vy1 = Math.min(frameH, top + scaledH);
  if (vx1 <= vx0 || vy1 <= vy0) {
    // Panned entirely out of frame. An empty canvas is the honest answer, not
    // a silently ignored offset.
    return sharp({ create: { width: frameW, height: frameH, channels: 4, background: TRANSPARENT } })
      .png().toBuffer();
  }

  // Crop the SOURCE to the slice that stays visible, scale that slice, then pad
  // back out to the frame. sharp resolves a pre-resize extract, the resize and
  // the extend in exactly that order, so this is one pass — and it never asks
  // for the negative composite offset that a zoomed-in frame would otherwise
  // need, which sharp does not accept.
  const visibleW = vx1 - vx0;
  const visibleH = vy1 - vy0;
  const sx = Math.max(0, Math.min(frameW - 1, Math.round(((vx0 - left) * frameW) / scaledW)));
  const sy = Math.max(0, Math.min(frameH - 1, Math.round(((vy0 - top) * frameH) / scaledH)));
  const sw = Math.max(1, Math.min(frameW - sx, Math.round((visibleW * frameW) / scaledW)));
  const sh = Math.max(1, Math.min(frameH - sy, Math.round((visibleH * frameH) / scaledH)));

  return sharp(buffer, { failOn: "none" })
    .extract({ left: sx, top: sy, width: sw, height: sh })
    .resize({ width: visibleW, height: visibleH, fit: "fill" })
    .extend({
      left: vx0,
      right: frameW - vx0 - visibleW,
      top: vy0,
      bottom: frameH - vy0 - visibleH,
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();
}

/**
 * The export box. A ratio with no size grows the short side (the expand
 * planner's rule: only ever add canvas); a size with no ratio keeps the photo's
 * own proportions; lockRatio means the height follows the width, so the number
 * the seller typed is the one that survives.
 */
function targetBox(frame: { width: number; height: number }, f: EditorState["format"]): {
  width: number; height: number;
} {
  const asked = RATIO_VALUE[f.ratio];
  const aspect = asked ?? frame.width / frame.height;
  let width = f.width;
  let height = f.height;

  if (width !== null && (height === null || f.lockRatio)) height = Math.round(width / aspect);
  else if (width === null && height !== null) width = Math.round(height * aspect);
  else if (width === null && height === null) {
    if (asked === null) return { width: frame.width, height: frame.height };
    const current = frame.width / frame.height;
    width = current < asked ? Math.round(frame.height * asked) : frame.width;
    height = current < asked ? frame.height : Math.round(frame.width / asked);
  }
  return { width: clampSide(width ?? frame.width), height: clampSide(height ?? frame.height) };
}

/**
 * ADJUST — only what sharp can genuinely do, in one chain.
 *
 * brightness and saturation are modulate()'s own multipliers in LCh; contrast
 * and temperature are both the linear pass a * in + b, so they are folded into
 * ONE linear() call — sharp keeps only the last one set on a pipeline, and two
 * calls would silently drop the first. Temperature is a red/blue channel gain,
 * which is what a warm or cool white balance physically is; sharpness is a real
 * unsharp mask upwards and a real gaussian blur downwards.
 */
function applyAdjust(pipeline: Sharp, a: EditorState["adjust"]): Sharp {
  let out = pipeline;
  if (a.brightness !== 0 || a.saturation !== 0) {
    out = out.modulate({
      brightness: Math.max(0.05, 1 + a.brightness / 100),
      saturation: Math.max(0, 1 + a.saturation / 100),
    });
  }
  if (a.sharpness > 0) out = out.sharpen({ sigma: 0.5 + (a.sharpness / 100) * 2.5 });
  else if (a.sharpness < 0) out = out.blur(0.3 + (-a.sharpness / 100) * 2.7);

  if (a.contrast !== 0 || a.temperature !== 0) {
    const gain = 1 + a.contrast / 100;          // 0 flattens to grey, 2 is hard
    const pivot = 128 * (1 - gain);             // mid grey stays where it is
    const warm = (a.temperature / 100) * 0.15;  // ±15% across the red/blue pair
    // Three multipliers on a four-band image is not a mistake: sharp lifts the
    // alpha channel out and puts it back, so a cutout keeps its transparency.
    out = out.linear([gain * (1 + warm), gain, gain * (1 - warm)], [pivot, pivot, pivot]);
  }
  return out;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampDimension(value?: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return Math.min(MAX_DIMENSION, Math.max(1, Math.round(value)));
}

/** Same ceiling as clampDimension, for sides that always have a value. */
function clampSide(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_DIMENSION, Math.max(1, Math.round(value)));
}
