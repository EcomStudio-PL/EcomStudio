import type { Tables } from "@/lib/database.types";

export type AiModelRecord = Tables<"ai_models">;
export type AiProviderRecord = Tables<"ai_providers">;

export type AspectRatio = "1:1" | "4:5" | "16:9" | "9:16";
export type Resolution = "1K" | "2K";

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

export class ProviderError extends Error {
  constructor(public safeMessage: string, public retriable = false) {
    super(safeMessage);
  }
}
