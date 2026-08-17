import type { Tables } from "@/lib/database.types";

export type AiModelRecord = Tables<"ai_models">;
export type AiProviderRecord = Tables<"ai_providers">;

export type AspectRatio = "1:1" | "4:5" | "16:9" | "9:16";
export type Resolution = "1K" | "2K" | "4K";

/** Per-resolution credit price from the admin-editable model config
 *  (ai_models.pricing). Falls back to the model's base credit_cost. */
export function priceForResolution(model: Pick<AiModelRecord, "pricing" | "credit_cost">, resolution: string): number {
  const pricing = (model.pricing ?? {}) as Record<string, number>;
  const p = pricing[resolution];
  return typeof p === "number" && p >= 0 ? p : model.credit_cost;
}

export type ProviderCredential = { apiKey: string; baseUrl?: string | null };

export type ReferenceImage = { base64: string; mime: string };

export interface GenerationRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  resolution?: Resolution;
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
