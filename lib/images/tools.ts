/**
 * IMAGE TOOLS — the catalogue.
 *
 * Eight micro-tools for product photos, split by what they actually cost us:
 *
 *   LOCAL  — pure pixel work done by sharp in our own runtime. No provider,
 *            no per-image fee, therefore ZERO credits for the seller.
 *   PAID   — needs a real AI model (segmentation, super-resolution,
 *            outpainting). Charged in credits, priced by the cost engine so
 *            the gross margin can never fall below the configured floor.
 *
 * This module is imported by the browser as well as the server, so it holds
 * only descriptions, option shapes and defaults — never a key, never a URL,
 * never a prompt.
 */

export const TOOL_SLUGS = [
  "upscale", "remove_bg", "white_bg", "expand",
  "shadow", "format", "compress", "watermark",
] as const;
export type ToolSlug = (typeof TOOL_SLUGS)[number];

/** Provider capability a paid tool needs. Local tools declare none. */
export type ToolCapability = "background" | "upscale" | "expand";

export type ToolDefinition = {
  slug: ToolSlug;
  kind: "local" | "paid";
  capability?: ToolCapability;
  /** Catalog service slug — the price snapshot and ledger entry hang off it. */
  service: string;
  /** Tools whose output can carry transparency (PNG/WebP only). */
  keepsAlpha: boolean;
  sortOrder: number;
};

export const TOOLS: ToolDefinition[] = [
  { slug: "upscale",   kind: "paid",  capability: "upscale",    service: "tool_upscale",       keepsAlpha: false, sortOrder: 1 },
  { slug: "remove_bg", kind: "paid",  capability: "background", service: "tool_remove_bg",     keepsAlpha: true,  sortOrder: 2 },
  { slug: "white_bg",  kind: "local", service: "tool_white_bg",   keepsAlpha: false, sortOrder: 3 },
  { slug: "expand",    kind: "paid",  capability: "expand",     service: "tool_expand",        keepsAlpha: false, sortOrder: 4 },
  { slug: "shadow",    kind: "local", service: "tool_shadow",    keepsAlpha: true,  sortOrder: 5 },
  { slug: "format",    kind: "local", service: "tool_format",    keepsAlpha: true,  sortOrder: 6 },
  { slug: "compress",  kind: "local", service: "tool_compress",  keepsAlpha: true,  sortOrder: 7 },
  { slug: "watermark", kind: "local", service: "tool_watermark", keepsAlpha: true,  sortOrder: 8 },
];

export function toolBySlug(slug: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

/* ── Option shapes ─────────────────────────────────────────────────────── */

/** Local sharp encodes all four honestly — TIFF (LZW, lossless) included,
 *  which print/marketplace pipelines still ask for. */
export const OUTPUT_FORMATS = ["jpeg", "png", "webp", "tiff"] as const;
export type OutputFormatOption = (typeof OUTPUT_FORMATS)[number];

/** Presets sellers actually ask for, plus "original" and a free box. */
export const SIZE_PRESETS = [
  { key: "original", width: null, height: null },
  { key: "square2000", width: 2000, height: 2000 },
  { key: "square1600", width: 1600, height: 1600 },
  { key: "allegro", width: 1600, height: 1600 },
  { key: "amazon", width: 2000, height: 2000 },
  { key: "shopify", width: 2048, height: 2048 },
  { key: "web1200", width: 1200, height: null },
] as const;

export const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const COMPRESSION_LEVELS = ["light", "balanced", "strong", "auto"] as const;
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];

export const WATERMARK_POSITIONS = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
  "pattern",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const SHADOW_STYLES = ["soft", "contact", "floating"] as const;
export type ShadowStyle = (typeof SHADOW_STYLES)[number];

export const UPSCALE_FACTORS = [2, 4] as const;
export type UpscaleFactor = (typeof UPSCALE_FACTORS)[number];

/** Every tool's settings object, discriminated by the tool slug. */
export type ToolSettings = {
  upscale: { factor: UpscaleFactor };
  remove_bg: { format: "png" | "webp" };
  white_bg: { color: string; padding: number; format: OutputFormatOption; quality: number };
  expand: { ratio: AspectRatio };
  shadow: { style: ShadowStyle; opacity: number; blur: number; offsetX: number; offsetY: number; background: string };
  format: { format: OutputFormatOption; width: number | null; height: number | null; quality: number; fit: "inside" | "cover" };
  compress: { level: CompressionLevel; format: OutputFormatOption | "keep" };
  watermark: {
    position: WatermarkPosition; scale: number; opacity: number;
    margin: number; rotation: number; spacing: number;
    format: OutputFormatOption | "keep"; quality: number;
  };
};

export const DEFAULT_SETTINGS: { [K in ToolSlug]: ToolSettings[K] } = {
  upscale: { factor: 2 },
  remove_bg: { format: "png" },
  white_bg: { color: "#FFFFFF", padding: 0, format: "jpeg", quality: 92 },
  expand: { ratio: "1:1" },
  shadow: { style: "soft", opacity: 35, blur: 24, offsetX: 0, offsetY: 18, background: "#FFFFFF" },
  format: { format: "jpeg", width: null, height: null, quality: 90, fit: "inside" },
  compress: { level: "auto", format: "keep" },
  watermark: {
    position: "bottom-right", scale: 18, opacity: 60,
    margin: 4, rotation: 0, spacing: 24, format: "keep", quality: 90,
  },
};

/** Background presets next to the colour picker on the white-background tool. */
export const BACKGROUND_PRESETS = ["#FFFFFF", "#F5F5F7", "#EFEFEF", "#F7F3EE", "#111827", "#0B1220"];

/** Upload limits mirrored on the server; the browser rejects early so a
 *  seller does not wait for a 20 MB upload only to be refused. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_BATCH_FILES = 100;
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"];
