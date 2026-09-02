import type { Tables } from "@/lib/database.types";

export type AiModelRecord = Tables<"ai_models">;
export type AiProviderRecord = Tables<"ai_providers">;

export type AspectRatio = "1:1" | "3:4" | "4:5" | "16:9" | "9:16";
export type Resolution = "1K" | "2K" | "4K";

/** Every format the platform knows, in display order. What a given model
 *  actually offers = this ∩ adapter capability ∩ ai_models.supported_aspect_ratios. */
export const ALL_ASPECT_RATIOS: readonly AspectRatio[] = ["1:1", "3:4", "4:5", "16:9", "9:16"];

/** Per-resolution credit price from the admin-editable model config
 *  (ai_models.pricing). Falls back to the model's base credit_cost. */
export function priceForResolution(model: Pick<AiModelRecord, "pricing" | "credit_cost">, resolution: string): number {
  const pricing = (model.pricing ?? {}) as Record<string, number>;
  const p = pricing[resolution];
  return typeof p === "number" && p >= 0 ? p : model.credit_cost;
}

/**
 * RENDER QUALITY — a parameter of ONE model, not three models.
 *
 * OpenAI's image endpoint takes `quality: low | medium | high` on the same
 * model id. It used to be modelled as three display rows ("GPT Image 2
 * Medium", "GPT Image 2 High"), which put a provider parameter in the model
 * list. Now a model that accepts the parameter declares it in
 * `metadata.qualities`, the UI shows a "Jakość" field for exactly those
 * models, and `metadata.quality_pricing` (optional, per quality → per size)
 * lets the price follow the real API cost. A row that PINS one quality via
 * `metadata.quality` (the old split rows, kept for history and admin
 * pinning) is deliberately not selectable — it has already decided.
 */
export const QUALITIES = ["low", "medium", "high"] as const;
export type Quality = typeof QUALITIES[number];

type QualityMeta = {
  quality?: unknown;
  qualities?: unknown;
  quality_pricing?: unknown;
};

function metaOf(model: Pick<AiModelRecord, "metadata">): QualityMeta {
  return (model.metadata && typeof model.metadata === "object" ? model.metadata : {}) as QualityMeta;
}

/** The qualities a customer may choose for this model, in display order.
 *  Empty when the model does not take the parameter or has it pinned. */
export function modelQualities(model: Pick<AiModelRecord, "metadata">): Quality[] {
  const meta = metaOf(model);
  if (typeof meta.quality === "string") return [];
  if (!Array.isArray(meta.qualities)) return [];
  return QUALITIES.filter((q) => (meta.qualities as unknown[]).includes(q));
}

/**
 * The quality a model will actually render at for a request: the request
 * if declared, else "medium", else the first declared tier — and undefined
 * for a model without the knob. EVERY quote and EVERY charge goes through
 * this one rule, so the two can never resolve differently.
 */
export function effectiveQuality(model: Pick<AiModelRecord, "metadata">, requested?: string | null): Quality | undefined {
  const declared = modelQualities(model);
  if (declared.length === 0) return undefined;
  if (requested && (declared as string[]).includes(requested)) return requested as Quality;
  return declared.includes("medium") ? "medium" : declared[0];
}

/** Credits for one image at a size AND quality. Falls back through the
 *  per-size price to the base cost, so a model without quality pricing
 *  charges the same whatever quality is sent. */
export function priceFor(
  model: Pick<AiModelRecord, "pricing" | "credit_cost" | "metadata">,
  resolution: string,
  quality?: Quality | null,
): number {
  if (quality) {
    const table = metaOf(model).quality_pricing;
    const row = table && typeof table === "object" ? (table as Record<string, unknown>)[quality] : undefined;
    const p = row && typeof row === "object" ? (row as Record<string, unknown>)[resolution] : undefined;
    if (typeof p === "number" && p >= 0) return p;
  }
  return priceForResolution(model, resolution);
}

export type ProviderCredential = { apiKey: string; baseUrl?: string | null };

export type ReferenceImage = { base64: string; mime: string };

export interface GenerationRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  resolution?: Resolution;
  /** Only ever set to a value the model declared in `metadata.qualities`;
   *  adapters that have no such knob ignore it. */
  quality?: Quality;
  quantity: number;
  referenceImages: ReferenceImage[];
  productLock: {
    /** Instructions the provider MUST preserve: shape, proportions, colors, item count, buttons, ports, labels, accessories, materials, scale. */
    fidelityInstructions: string;
  };
}

export type GeneratedImage = { base64?: string; url?: string; mime: string; width?: number; height?: number };

export interface GenerationResult {
  images: GeneratedImage[];
  providerMetadata?: Record<string, unknown>;
}

/**
 * Provider adapter contract. Every AI vendor (Google, fal.ai, OpenAI, …) is
 * wrapped in an adapter keyed by provider slug. Credentials are decrypted
 * server-side from the admin-managed store and passed per call — adapters
 * never read env vars and keys never reach the browser.
 */
export interface ImageProviderAdapter {
  slug: string;
  /** Which knobs the studio UI should expose for this provider. */
  capabilities: {
    resolutions: Resolution[];
    maxQuantity: number;
    supportsReferenceImages: boolean;
    /** Framings this provider genuinely renders (not merely approximates).
     *  Absent = the four classic ratios. */
    ratios?: AspectRatio[];
  };
  generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult>;
}

/** Sanitized upstream facts for the admin: status + codes + a masked message.
 *  Never the raw body, never a key, never the prompt. */
export type UpstreamError = {
  status?: number;
  type?: string;
  code?: string;
  message?: string;
  requestId?: string | null;
  /** Provider-suggested wait before retrying (Retry-After / RetryInfo). */
  retryAfterMs?: number;
};

export class ProviderError extends Error {
  /**
   * @param safeMessage localized-error key shown to the customer
   * @param retriable   whether another attempt could plausibly succeed
   * @param providerCode the provider's own error code/type (e.g.
   *   "insufficient_quota"). Codes only — never the raw body, never a key —
   *   so operators can diagnose without anything sensitive being stored.
   * @param upstream    sanitized upstream diagnostics for admin telemetry
   */
  constructor(
    public safeMessage: string,
    public retriable = false,
    public providerCode?: string,
    public upstream?: UpstreamError,
  ) {
    super(safeMessage);
  }
}

/** Strip anything secret-shaped out of an upstream message before it is
 *  stored: API keys, bearer tokens, query keys. */
export function sanitizeUpstreamMessage(message: string | undefined | null, max = 300): string | undefined {
  if (!message) return undefined;
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/(key|token|authorization)=([A-Za-z0-9_-]{8,})/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***")
    .slice(0, max);
}
