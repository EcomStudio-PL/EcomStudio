/**
 * MINIATURKA AI — the fixed facts and the operator's settings, in one place.
 *
 *   photos ──(optional, per photo: Retusz AI, unchanged)──▶ inputs
 *   inputs ──(ONE request: OpenAI images.edits, GPT Image 2.5 Sunburst)──▶ raw
 *   raw ────(local, deterministic: white margin, Lanczos3, brightness)──▶ PNG
 *
 * Client-safe on purpose (no I/O, no secrets): the admin form validates with
 * the same rules the server action enforces, and the customer panel reads the
 * stage names from here. The settings row itself (`app_settings.thumbnail`)
 * is private — the server reads it through a token-gated function.
 */

/** Registry key — the feature switch, the ai_tools row, the prompt's tool
 *  and the library operation are the same string, like the Moda tools. */
export const THUMBNAIL_TOOL_KEY = "ecommerce_thumbnail";
export const THUMBNAIL_OPERATION = THUMBNAIL_TOOL_KEY;
/** The catalogue row that bills the Sunburst step (price set by the operator). */
export const THUMBNAIL_SERVICE = "tool_thumbnail";
/** The route the tool lives on — unchanged from when it was a preset. */
export const THUMBNAIL_CATEGORY = "ecommerce";
export const THUMBNAIL_WORKFLOW = "thumbnail";
export const THUMBNAIL_PATH = "/k/ecommerce/thumbnail";

/**
 * SHA-256 of the production prompt as handed over for this release
 * (UTF-8, no header, no separator lines, no trailing newline; 8705 bytes).
 * The prompt itself is published in Admin → Narzędzia i silniki → Silnik and
 * never committed. A published text that hashes to this runs as-is; any
 * other text runs only after an operator explicitly approves that version
 * (Admin → Miniaturka), so a prompt can never change silently.
 */
export const THUMBNAIL_REFERENCE_PROMPT_SHA256 = "cac2e4f7d1f562262294f47fd42de098dbff7c500522ae3ba237cba79bc89a0e";

/** OpenAI's documented ceiling for `image[]` on GPT Image models. */
export const OPENAI_EDIT_MAX_IMAGES = 16;
/** OpenAI's per-image ceiling (png/webp/jpg, "less than 50MB"). */
export const OPENAI_EDIT_MAX_IMAGE_BYTES = 50 * 1024 * 1024 - 1;
/** What `product-images` accepts — the uploader enforces the same. */
export const THUMBNAIL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** The models this tool may call — Sunburst and its dated snapshot. No other
 *  model is ever a fallback. */
export const THUMBNAIL_MODELS = ["gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08"] as const;
export type ThumbnailModel = (typeof THUMBNAIL_MODELS)[number];

/** `quality` values the SDK spec lists for Sunburst. */
export const THUMBNAIL_QUALITIES = ["low", "medium", "high", "xhigh", "max", "auto"] as const;
export type ThumbnailQuality = (typeof THUMBNAIL_QUALITIES)[number];

/** Square request sizes (both edges divisible by 16, within the spec's limits). */
export const THUMBNAIL_SIZES = ["1024x1024", "1536x1536", "2048x2048"] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

/** sharp kernels offered for the local upscale. */
export const THUMBNAIL_KERNELS = ["lanczos3", "lanczos2", "mitchell", "cubic"] as const;
export type ThumbnailKernel = (typeof THUMBNAIL_KERNELS)[number];

export const THUMBNAIL_FORMATS = ["png", "jpeg"] as const;
export type ThumbnailFormat = (typeof THUMBNAIL_FORMATS)[number];

/** Validated ranges — the form, the action and the reader share them. */
export const RANGES = {
  maxPhotos: { min: 1, max: OPENAI_EDIT_MAX_IMAGES },
  target: { min: 1024, max: 4096 },
  marginPercent: { min: 0, max: 15 },
  brightnessPercent: { min: -20, max: 20 },
  timeoutMs: { min: 60_000, max: 240_000 },
  /** USD per 1M tokens; anything above is a typo, not a price. */
  tokenPrice: { min: 0, max: 1000 },
} as const;

export type FinishConfig = {
  /** Edge of the delivered square, px. */
  target: number;
  /** White margin on every side, % of `target` (rounded to whole px). */
  marginPercent: number;
  /** Brightness of the inner image only, % (0 = untouched). */
  brightnessPercent: number;
  kernel: ThumbnailKernel;
  format: ThumbnailFormat;
};

/** USD per one million tokens. Null = not entered → cost UNKNOWN, never 0. */
export type TokenPrices = {
  textInput: number | null;
  cachedTextInput: number | null;
  imageInput: number | null;
  cachedImageInput: number | null;
  imageOutput: number | null;
  textOutput: number | null;
};

export type ApprovedPrompt = {
  /** Keyed digest (server-side HMAC) of the approved text — never the text. */
  digest: string;
  version: number | null;
  approvedAt: string;
  approvedBy: string | null;
};

export type ThumbnailConfig = {
  model: ThumbnailModel;
  size: ThumbnailSize;
  quality: ThumbnailQuality;
  maxPhotos: number;
  timeoutMs: number;
  finish: FinishConfig;
  tokenPrices: TokenPrices;
  approvedPrompt: ApprovedPrompt | null;
};

export const DEFAULT_FINISH: FinishConfig = {
  target: 2560, marginPercent: 3, brightnessPercent: 5, kernel: "lanczos3", format: "png",
};

export const EMPTY_TOKEN_PRICES: TokenPrices = {
  textInput: null, cachedTextInput: null, imageInput: null, cachedImageInput: null, imageOutput: null, textOutput: null,
};

export const DEFAULT_CONFIG: ThumbnailConfig = {
  model: "gpt-image-2.5-sunburst",
  size: "2048x2048",
  quality: "high",
  maxPhotos: 10,
  timeoutMs: 200_000,
  finish: DEFAULT_FINISH,
  tokenPrices: EMPTY_TOKEN_PRICES,
  approvedPrompt: null,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
const intIn = (v: unknown, r: { min: number; max: number }, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max ? v : fallback;
const numIn = (v: unknown, r: { min: number; max: number }, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max ? v : fallback;
const priceOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= RANGES.tokenPrice.min && v <= RANGES.tokenPrice.max ? v : null;

/**
 * The stored row → a complete, valid config. Anything missing or out of range
 * falls back to the default for THAT field only (an operator's other choices
 * survive one bad value), and a price that is not a valid number stays null.
 */
export function parseThumbnailConfig(raw: unknown): ThumbnailConfig {
  const r = isObj(raw) ? raw : {};
  const f = isObj(r.finish) ? r.finish : {};
  const p = isObj(r.token_prices) ? r.token_prices : {};
  const a = isObj(r.approved_prompt) ? r.approved_prompt : null;
  return {
    model: oneOf(THUMBNAIL_MODELS, r.model, DEFAULT_CONFIG.model),
    size: oneOf(THUMBNAIL_SIZES, r.size, DEFAULT_CONFIG.size),
    quality: oneOf(THUMBNAIL_QUALITIES, r.quality, DEFAULT_CONFIG.quality),
    maxPhotos: intIn(r.max_photos, RANGES.maxPhotos, DEFAULT_CONFIG.maxPhotos),
    timeoutMs: intIn(r.timeout_ms, RANGES.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    finish: {
      target: intIn(f.target, RANGES.target, DEFAULT_FINISH.target),
      marginPercent: numIn(f.margin_percent, RANGES.marginPercent, DEFAULT_FINISH.marginPercent),
      brightnessPercent: numIn(f.brightness_percent, RANGES.brightnessPercent, DEFAULT_FINISH.brightnessPercent),
      kernel: oneOf(THUMBNAIL_KERNELS, f.kernel, DEFAULT_FINISH.kernel),
      format: oneOf(THUMBNAIL_FORMATS, f.format, DEFAULT_FINISH.format),
    },
    tokenPrices: {
      textInput: priceOf(p.text_input),
      cachedTextInput: priceOf(p.cached_text_input),
      imageInput: priceOf(p.image_input),
      cachedImageInput: priceOf(p.cached_image_input),
      imageOutput: priceOf(p.image_output),
      textOutput: priceOf(p.text_output),
    },
    approvedPrompt: a && typeof a.digest === "string" && /^[0-9a-f]{64}$/.test(a.digest) ? {
      digest: a.digest,
      version: typeof a.version === "number" && Number.isInteger(a.version) ? a.version : null,
      approvedAt: typeof a.approved_at === "string" ? a.approved_at : "",
      approvedBy: typeof a.approved_by === "string" ? a.approved_by : null,
    } : null,
  };
}

/** A config → the stored row shape (snake_case, the approval kept as is). */
export function serializeThumbnailConfig(c: ThumbnailConfig): Record<string, unknown> {
  return {
    v: 1,
    model: c.model,
    size: c.size,
    quality: c.quality,
    max_photos: c.maxPhotos,
    timeout_ms: c.timeoutMs,
    finish: {
      target: c.finish.target, margin_percent: c.finish.marginPercent,
      brightness_percent: c.finish.brightnessPercent, kernel: c.finish.kernel, format: c.finish.format,
    },
    token_prices: {
      text_input: c.tokenPrices.textInput, cached_text_input: c.tokenPrices.cachedTextInput,
      image_input: c.tokenPrices.imageInput, cached_image_input: c.tokenPrices.cachedImageInput,
      image_output: c.tokenPrices.imageOutput, text_output: c.tokenPrices.textOutput,
    },
    approved_prompt: c.approvedPrompt ? {
      digest: c.approvedPrompt.digest, version: c.approvedPrompt.version,
      approved_at: c.approvedPrompt.approvedAt, approved_by: c.approvedPrompt.approvedBy,
    } : null,
  };
}

/** What the admin form may change — everything except the prompt approval,
 *  which has its own action. */
export type ThumbnailSettingsInput = Omit<ThumbnailConfig, "approvedPrompt">;

/**
 * STRICT validation of an operator's edit: unlike the reader, nothing is
 * silently replaced — the first invalid field is reported and nothing saves.
 */
export function validateSettingsInput(input: unknown): { ok: true; value: ThumbnailSettingsInput } | { ok: false; field: string } {
  if (!isObj(input)) return { ok: false, field: "input" };
  const f = isObj(input.finish) ? input.finish : null;
  const p = isObj(input.tokenPrices) ? input.tokenPrices : null;
  if (!(THUMBNAIL_MODELS as readonly unknown[]).includes(input.model)) return { ok: false, field: "model" };
  if (!(THUMBNAIL_SIZES as readonly unknown[]).includes(input.size)) return { ok: false, field: "size" };
  if (!(THUMBNAIL_QUALITIES as readonly unknown[]).includes(input.quality)) return { ok: false, field: "quality" };
  const int = (v: unknown, r: { min: number; max: number }) => typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;
  const num = (v: unknown, r: { min: number; max: number }) => typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max;
  if (!int(input.maxPhotos, RANGES.maxPhotos)) return { ok: false, field: "maxPhotos" };
  if (!int(input.timeoutMs, RANGES.timeoutMs)) return { ok: false, field: "timeoutMs" };
  if (!f) return { ok: false, field: "finish" };
  if (!int(f.target, RANGES.target)) return { ok: false, field: "target" };
  if (!num(f.marginPercent, RANGES.marginPercent)) return { ok: false, field: "marginPercent" };
  if (!num(f.brightnessPercent, RANGES.brightnessPercent)) return { ok: false, field: "brightnessPercent" };
  if (!(THUMBNAIL_KERNELS as readonly unknown[]).includes(f.kernel)) return { ok: false, field: "kernel" };
  if (!(THUMBNAIL_FORMATS as readonly unknown[]).includes(f.format)) return { ok: false, field: "format" };
  // The inner image must keep at least half the canvas.
  if (marginPx(f.target as number, f.marginPercent as number) * 4 > (f.target as number)) return { ok: false, field: "marginPercent" };
  if (!p) return { ok: false, field: "tokenPrices" };
  const prices: TokenPrices = { ...EMPTY_TOKEN_PRICES };
  for (const k of Object.keys(EMPTY_TOKEN_PRICES) as (keyof TokenPrices)[]) {
    const v = p[k];
    if (v === null || v === undefined || v === "") { prices[k] = null; continue; }
    if (!num(v, RANGES.tokenPrice)) return { ok: false, field: `tokenPrices.${k}` };
    prices[k] = v as number;
  }
  return {
    ok: true,
    value: {
      model: input.model as ThumbnailModel,
      size: input.size as ThumbnailSize,
      quality: input.quality as ThumbnailQuality,
      maxPhotos: input.maxPhotos as number,
      timeoutMs: input.timeoutMs as number,
      finish: {
        target: f.target as number, marginPercent: f.marginPercent as number,
        brightnessPercent: f.brightnessPercent as number,
        kernel: f.kernel as ThumbnailKernel, format: f.format as ThumbnailFormat,
      },
      tokenPrices: prices,
    },
  };
}

/** The white margin in whole pixels: 3% of 2560 = 76.8 → 77. */
export function marginPx(target: number, marginPercent: number): number {
  return Math.round((target * marginPercent) / 100);
}

/** The inner square's edge: 2560 − 2·77 = 2406. */
export function innerPx(target: number, marginPercent: number): number {
  return target - 2 * marginPx(target, marginPercent);
}

/** The request size's edge, px ("2048x2048" → 2048). */
export function sizeEdge(size: ThumbnailSize): number {
  return Number(size.split("x")[0]);
}

/**
 * THE STAGES THE CUSTOMER SEES — each one a real step of the run, reported by
 * the server (never a timer): preparing the photos, the Retusz passes (only
 * when chosen), the composition, the local finish, done.
 */
export const THUMBNAIL_STAGES = ["prepare", "retouch", "compose", "finish", "done"] as const;
export type ThumbnailStage = (typeof THUMBNAIL_STAGES)[number];

/** Step positions in ai_engine_step_runs. */
export const STEP = { retouch: 1, compose: 2, finish: 3 } as const;

/** Statuses of a run as the panel reads them. */
export type ThumbnailRunStatus = "queued" | "running" | "ok" | "failed";

/** The price shown before anything starts — the server recomputes it. */
export type ThumbnailQuote = {
  photos: number;
  retouch: boolean;
  /** Credits for ONE Retusz pass (Retusz's own price at 2K), or null when
   *  Retusz is not available. */
  retouchUnit: number | null;
  /** Retusz passes charged (photos with Retusz on, minus reused results). */
  retouchCount: number;
  retouchCredits: number;
  /** Credits for the composition (the operator's catalogue price). */
  thumbnailCredits: number;
  total: number;
};

export function quoteTotal(input: {
  photos: number; retouch: boolean; retouchUnit: number | null; thumbnailCredits: number; reused?: number;
}): ThumbnailQuote {
  const retouchCount = input.retouch ? Math.max(0, input.photos - (input.reused ?? 0)) : 0;
  const retouchCredits = retouchCount * (input.retouchUnit ?? 0);
  return {
    photos: input.photos,
    retouch: input.retouch,
    retouchUnit: input.retouchUnit,
    retouchCount,
    retouchCredits,
    thumbnailCredits: input.thumbnailCredits,
    total: retouchCredits + input.thumbnailCredits,
  };
}
