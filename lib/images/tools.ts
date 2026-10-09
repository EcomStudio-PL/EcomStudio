import { EDITOR_DEFAULTS, type EditorState } from "./editor-state";

/**
 * IMAGE TOOLS — the catalogue.
 *
 * One editor and eight micro-tools for product photos, split by what they
 * actually cost us:
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
  "editor", "upscale", "remove_bg", "white_bg", "expand",
  "shadow", "format", "compress", "watermark",
  // Generative edits. Each is one /v2/edit call at the provider, so they all
  // share the "edit" capability and differ only by which operation they ask
  // for — see EDIT_OPERATIONS in lib/images/providers.ts.
  "ai_background", "relight", "ai_shadow", "beautify", "uncrop", "ghost_mannequin",
] as const;
export type ToolSlug = (typeof TOOL_SLUGS)[number];

/** Provider capability a paid tool needs. Local tools declare none. */
export type ToolCapability = "background" | "upscale" | "expand" | "edit";

/** Which generative edit an "edit"-capability tool asks the provider for.
 *  Mirrors EDIT_OPERATIONS in lib/images/providers.ts, which is server-only —
 *  this file is imported by the browser and must stay free of it. */
export type EditOperationSlug =
  | "ai_background" | "relight" | "ai_shadow" | "beautify" | "uncrop" | "ghost_mannequin";

export type ToolDefinition = {
  slug: ToolSlug;
  kind: "local" | "paid";
  capability?: ToolCapability;
  /** Catalog service slug — the price snapshot and ledger entry hang off it. */
  service: string;
  /** Tools whose output can carry transparency (PNG/WebP only). */
  keepsAlpha: boolean;
  sortOrder: number;
  /** Only for capability "edit": the operation the provider is asked for. */
  operation?: EditOperationSlug;
  /**
   * The ONE vendor this tool runs on, when it is not "whichever key is
   * cheapest". The four photo tools are sold as Photoroom operations — their
   * price, their endpoint and their admin economics are Photoroom's — so they
   * never fall through to another backend just because its key exists.
   */
  provider?: "photoroom";
  /** A photo that already carries real transparency needs no provider call:
   *  the colour is composited locally and the run costs nothing. */
  freeWhenTransparent?: boolean;
};

export const TOOLS: ToolDefinition[] = [
  // The editor is the whole toolbox in one pass — crop, background, shadow,
  // colour and transform baked by our own sharp pipeline, so it is free for
  // exactly the same reason the other local tools are.
  { slug: "editor",    kind: "local", service: "tool_editor",    keepsAlpha: true,  sortOrder: 0 },
  { slug: "upscale",   kind: "paid",  capability: "upscale",    service: "tool_upscale",       keepsAlpha: false, sortOrder: 1 },
  { slug: "remove_bg", kind: "paid",  capability: "background", service: "tool_remove_bg",     keepsAlpha: true,  sortOrder: 2,
    provider: "photoroom" },
  // "Zmień kolor tła": one /v1/segment call with `bg_color` — the cutout and
  // the colour in a single Basic-rate request. A photo that is ALREADY cut out
  // is flattened onto the colour locally instead, for nothing.
  { slug: "white_bg",  kind: "paid",  capability: "background", service: "tool_white_bg",      keepsAlpha: false, sortOrder: 3,
    provider: "photoroom", freeWhenTransparent: true },
  { slug: "expand",    kind: "paid",  capability: "expand",     service: "tool_expand",        keepsAlpha: false, sortOrder: 4 },
  { slug: "shadow",    kind: "local", service: "tool_shadow",    keepsAlpha: true,  sortOrder: 5 },
  { slug: "format",    kind: "local", service: "tool_format",    keepsAlpha: true,  sortOrder: 6 },
  { slug: "compress",  kind: "local", service: "tool_compress",  keepsAlpha: true,  sortOrder: 7 },
  { slug: "watermark", kind: "local", service: "tool_watermark", keepsAlpha: true,  sortOrder: 8 },

  // ── Generative edits ───────────────────────────────────────────────────
  // All six are the same provider call with a different operation, so they
  // share one capability and one runner branch. keepsAlpha is true only where
  // the result can legitimately come back cut out: a new background, a cast
  // shadow and a ghost mannequin all replace what was behind the product.
  { slug: "ai_background",   kind: "paid", capability: "edit", operation: "ai_background",
    service: "tool_ai_background",   keepsAlpha: true,  sortOrder: 9, provider: "photoroom" },
  { slug: "relight",         kind: "paid", capability: "edit", operation: "relight",
    service: "tool_relight",         keepsAlpha: false, sortOrder: 10 },
  { slug: "ai_shadow",       kind: "paid", capability: "edit", operation: "ai_shadow",
    service: "tool_ai_shadow",       keepsAlpha: true,  sortOrder: 11, provider: "photoroom" },
  { slug: "beautify",        kind: "paid", capability: "edit", operation: "beautify",
    service: "tool_beautify",        keepsAlpha: false, sortOrder: 12 },
  { slug: "uncrop",          kind: "paid", capability: "edit", operation: "uncrop",
    service: "tool_uncrop",          keepsAlpha: false, sortOrder: 13 },
  { slug: "ghost_mannequin", kind: "paid", capability: "edit", operation: "ghost_mannequin",
    service: "tool_ghost_mannequin", keepsAlpha: true,  sortOrder: 14 },
];

export function toolBySlug(slug: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

/* ── The four photo tools ──────────────────────────────────────────────── */

/**
 * "Usuń tło", "Zmień kolor tła", "Dodaj tło AI" and "Dodaj cień" — each with a
 * screen of its own at /tools/<slug>, all four running through the same runner,
 * ledger and provider registry as every other tool. These are their EXISTING
 * runner slugs; the catalogue cards keep their own keys (remove_bg, background,
 * ai_background, shadow) and point here.
 */
export const PHOTO_TOOLS = ["remove_bg", "white_bg", "ai_background", "ai_shadow"] as const;
export type PhotoToolSlug = (typeof PHOTO_TOOLS)[number];

export function isPhotoTool(slug: string): slug is PhotoToolSlug {
  return (PHOTO_TOOLS as readonly string[]).includes(slug);
}

/** Photos one batch of a photo tool may carry, and the size of each — the
 *  same ceiling Retusz and the generator put on what goes to a provider. */
export const PHOTO_MAX_PHOTOS = 10;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

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

/** Lighting intents the relight model accepts. The wire values live in
 *  lib/images/providers.ts; these are the panel's own words for them. */
export const LIGHTING_INTENTS = ["auto", "preserve", "portrait"] as const;
export type LightingIntent = (typeof LIGHTING_INTENTS)[number];

/** Miękki / Mocny / Unoszący się — Photoroom's documented `ai.soft`,
 *  `ai.hard` and `ai.floating`. The wire values live in providers.ts. */
export const AI_SHADOW_STYLES = ["soft", "hard", "floating"] as const;
export type AiShadowStyle = (typeof AI_SHADOW_STYLES)[number];

/** What the shadow is cast onto. An AI shadow is drawn under a CUT-OUT
 *  product, so the original backdrop is never kept by accident: the seller
 *  chooses white, transparent or a colour of their own. */
export const AI_SHADOW_BACKGROUNDS = ["white", "transparent", "color"] as const;
export type AiShadowBackground = (typeof AI_SHADOW_BACKGROUNDS)[number];

/** How closely an inspiration photo steers a generated background (0–1),
 *  Photoroom's own default. */
export const AI_BACKGROUND_GUIDANCE_DEFAULT = 0.6;

/** "Zmień kolor tła" — the palette: white, black, greys and soft pastels. */
export const COLOR_PALETTE = [
  "#FFFFFF", "#000000", "#F3F4F6", "#D1D5DB", "#6B7280",
  "#FDE2E4", "#FDEBD3", "#FFF6CC", "#DDF3E4", "#DCEBFA", "#E8E0F7", "#F5EFE6",
] as const;

export const BEAUTIFY_SUBJECTS = ["auto", "food"] as const;
export type BeautifySubject = (typeof BEAUTIFY_SUBJECTS)[number];

/** A described background is free text, and free text goes to a model — so it
 *  is capped here as well as on the server. */
export const BACKGROUND_PROMPT_MAX = 300;

/** Every tool's settings object, discriminated by the tool slug. */
export type ToolSettings = {
  /** The editor sends its whole state; the panel owns the shape, not this file. */
  editor: { state: EditorState; format: OutputFormatOption; quality: number };
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
  /** A scene: one of the operator's presets (by key — its prompt never
   *  leaves the server) or the seller's own description. `guidance` is how
   *  closely an optional inspiration photo steers it. */
  ai_background: { preset: string; prompt: string; guidance: number; format: "png" | "jpeg" | "webp" };
  relight: { intent: LightingIntent; format: "png" | "jpeg" | "webp" };
  ai_shadow: { style: AiShadowStyle; background: AiShadowBackground; color: string; format: "png" | "jpeg" | "webp" };
  beautify: { subject: BeautifySubject; format: "png" | "jpeg" | "webp" };
  uncrop: { format: "png" | "jpeg" | "webp" };
  ghost_mannequin: { format: "png" | "webp" };
};

export const DEFAULT_SETTINGS: { [K in ToolSlug]: ToolSettings[K] } = {
  editor: { state: EDITOR_DEFAULTS, format: "jpeg", quality: 92 },
  upscale: { factor: 2 },
  remove_bg: { format: "png" },
  // PNG by default: a solid backdrop plus a lossless product — the seller
  // chooses JPEG when the file size matters more.
  white_bg: { color: "#FFFFFF", padding: 0, format: "png", quality: 92 },
  expand: { ratio: "1:1" },
  shadow: { style: "soft", opacity: 35, blur: 24, offsetX: 0, offsetY: 18, background: "#FFFFFF" },
  format: { format: "jpeg", width: null, height: null, quality: 90, fit: "inside" },
  compress: { level: "auto", format: "keep" },
  watermark: {
    position: "bottom-right", scale: 18, opacity: 60,
    margin: 4, rotation: 0, spacing: 24, format: "keep", quality: 90,
  },
  ai_background: { preset: "", prompt: "", guidance: AI_BACKGROUND_GUIDANCE_DEFAULT, format: "png" },
  relight: { intent: "auto", format: "jpeg" },
  ai_shadow: { style: "soft", background: "white", color: "#FFFFFF", format: "png" },
  beautify: { subject: "auto", format: "jpeg" },
  uncrop: { format: "jpeg" },
  ghost_mannequin: { format: "png" },
};

/** Background presets next to the colour picker on the white-background tool. */
export const BACKGROUND_PRESETS = ["#FFFFFF", "#F5F5F7", "#EFEFEF", "#F7F3EE", "#111827", "#0B1220"];

/** Upload limits mirrored on the server; the browser rejects early so a
 *  seller does not wait for a 20 MB upload only to be refused. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_BATCH_FILES = 100;
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"];
