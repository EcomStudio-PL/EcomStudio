import type { Tables } from "@/lib/database.types";

export type AiModelRecord = Tables<"ai_models">;
export type AiProviderRecord = Tables<"ai_providers">;

export type AspectRatio = "1:1" | "4:5" | "16:9" | "9:16";

export interface GenerationRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  referenceImageUrls: string[];
  productLock: {
    /** Instructions the provider MUST preserve: shape, proportions, colors, item count, buttons, ports, labels, accessories, materials, scale. */
    fidelityInstructions: string;
  };
}

export interface GenerationResult {
  images: { url: string; width?: number; height?: number }[];
  providerMetadata?: Record<string, unknown>;
}

/**
 * Provider adapter contract. Every AI vendor (OpenAI, Google, fal.ai, …)
 * is wrapped in an adapter implementing this interface, keyed by provider slug.
 * The app never talks to a vendor SDK directly.
 */
export interface ImageProviderAdapter {
  slug: string;
  /** True only when server-side credentials for this provider are configured. */
  isConfigured(): boolean;
  generate(model: AiModelRecord, req: GenerationRequest): Promise<GenerationResult>;
}
