import "server-only";
import type { Client } from "@/lib/services/workspace";
import { getAdapter } from "./registry";
import type { AiModelRecord } from "./types";

export type UsableModel = AiModelRecord & {
  provider_slug: string;
  provider_name: string;
  capabilities_ui: { resolutions: string[]; maxQuantity: number; supportsReferenceImages: boolean };
};

/** What the CLIENT sees: display identity + capabilities + per-resolution
 *  pricing. Providers/endpoints are backend infrastructure and never leave
 *  the server. */
export type ClientModel = {
  id: string;
  displayName: string;
  badge: string | null;
  description: string | null;
  pricing: Record<string, number>;
  resolutions: string[];
  maxQuantity: number;
  supportsReferenceImages: boolean;
  supportsNegativePrompt: boolean;
  maxReferenceImages: number;
};

/**
 * Model router: a model is usable only when it is active, its provider is
 * active, an adapter is registered for the provider AND an active encrypted
 * credential exists in the admin credential store.
 */
export async function getUsableModels(supabase: Client): Promise<UsableModel[]> {
  const [{ data: models }, { data: creds }] = await Promise.all([
    supabase
      .from("ai_models")
      .select("*, ai_providers!inner(id, slug, name, active)")
      .eq("active", true)
      .eq("ai_providers.active", true)
      .order("sort_order", { ascending: true }),
    supabase.from("ai_provider_credentials").select("provider_id").eq("active", true),
  ]);
  const withKey = new Set((creds ?? []).map((c) => c.provider_id));
  return (models ?? [])
    .filter((m) => {
      const p = (m as unknown as { ai_providers: { id: string; slug: string } }).ai_providers;
      return withKey.has(p.id) && !!getAdapter(p.slug);
    })
    .map((m) => {
      const p = (m as unknown as { ai_providers: { slug: string; name: string } }).ai_providers;
      const adapter = getAdapter(p.slug)!;
      return {
        ...(m as AiModelRecord),
        provider_slug: p.slug,
        provider_name: p.name,
        capabilities_ui: {
          resolutions: m.supported_resolutions ?? ["1K"],
          maxQuantity: adapter.capabilities.maxQuantity,
          supportsReferenceImages: adapter.capabilities.supportsReferenceImages && m.supports_reference_images,
        },
      };
    });
}

/** Strip a usable model down to its provider-free client shape. */
export function toClientModel(m: UsableModel): ClientModel {
  const pricing: Record<string, number> = {};
  for (const res of m.capabilities_ui.resolutions) {
    const p = (m.pricing as Record<string, number> | null)?.[res];
    pricing[res] = typeof p === "number" && p >= 0 ? p : m.credit_cost;
  }
  return {
    id: m.id,
    displayName: m.display_name || m.name,
    badge: m.badge,
    description: m.description,
    pricing,
    resolutions: m.capabilities_ui.resolutions,
    maxQuantity: m.capabilities_ui.maxQuantity,
    supportsReferenceImages: m.capabilities_ui.supportsReferenceImages,
    supportsNegativePrompt: m.supports_negative_prompt,
    maxReferenceImages: m.max_reference_images,
  };
}
