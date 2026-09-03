import "server-only";
import type { Client } from "@/lib/services/workspace";
import { getAdapter } from "./registry";
import { ALL_ASPECT_RATIOS, modelQualities, priceFor, type AiModelRecord, type AspectRatio } from "./types";

export type UsableModel = AiModelRecord & {
  provider_slug: string;
  provider_name: string;
  capabilities_ui: {
    resolutions: string[];
    maxQuantity: number;
    supportsReferenceImages: boolean;
    ratios: string[];
    /** Of those, the ones the provider renders exactly (see
     *  ImageProviderAdapter.capabilities.exactRatios). */
    exactRatios: string[];
  };
};

/** What the CLIENT sees: display identity + capabilities + per-resolution
 *  pricing. Providers/endpoints are backend infrastructure and never leave
 *  the server. */
export type ClientModel = {
  id: string;
  displayName: string;
  badge: string | null;
  badgeTone: string | null;
  description: string | null;
  pricing: Record<string, number>;
  resolutions: string[];
  /** Framings this model offers — the UI shows nothing else. */
  ratios: string[];
  /** The subset rendered exactly; every other offered ratio is served at the
   *  engine's nearest shape, and the picker says so rather than implying a
   *  crop the customer will not get. */
  exactRatios: string[];
  maxQuantity: number;
  supportsReferenceImages: boolean;
  supportsNegativePrompt: boolean;
  maxReferenceImages: number;
  /** Credits added per image when the GrovBase engine writes the prompt. */
  engineSurcharge: number;
  /** Render qualities the customer may pick; empty = the model has no such
   *  knob and the UI shows no field for it. */
  qualities: string[];
  /** quality → size → credits, only for qualities that change the price. */
  qualityPricing: Record<string, Record<string, number>>;
};

/** Ratios a model may offer: platform list ∩ adapter capability ∩ the
 *  admin-managed column. Falls back to 1:1 so a misconfigured model still
 *  renders something rather than nothing. */
function effectiveRatios(m: AiModelRecord, adapterRatios?: AspectRatio[]): string[] {
  const adapterSet = new Set<string>(adapterRatios ?? ["1:1", "4:5", "16:9", "9:16"]);
  const modelSet = new Set<string>(m.supported_aspect_ratios ?? []);
  const out = ALL_ASPECT_RATIOS.filter((r) => adapterSet.has(r) && (modelSet.size === 0 || modelSet.has(r)));
  return out.length > 0 ? out : ["1:1"];
}

/**
 * Model router: a model is usable only when it is active, its provider is
 * active, an adapter is registered for the provider AND an active encrypted
 * credential exists in the admin credential store.
 */
export async function getUsableModels(supabase: Client): Promise<UsableModel[]> {
  // Credentials are admin-only under RLS, so membership of "has a key" comes
  // from a definer RPC that returns provider ids and nothing else — a customer
  // must be able to see which models are usable without seeing any secret.
  const [{ data: models }, { data: creds }] = await Promise.all([
    supabase
      .from("ai_models")
      .select("*, ai_providers!inner(id, slug, name, active)")
      .eq("active", true)
      .eq("type", "image")
      .eq("ai_providers.active", true)
      .order("sort_order", { ascending: true }),
    supabase.rpc("providers_with_credentials"),
  ]);
  const withKey = new Set((creds ?? []) as string[]);
  return (models ?? [])
    .filter((m) => {
      const p = (m as unknown as { ai_providers: { id: string; slug: string } }).ai_providers;
      return withKey.has(p.id) && !!getAdapter(p.slug);
    })
    .map((m) => {
      const p = (m as unknown as { ai_providers: { slug: string; name: string } }).ai_providers;
      const adapter = getAdapter(p.slug)!;
      const capOutputs = (m as { max_outputs?: number | null }).max_outputs;
      return {
        ...(m as AiModelRecord),
        provider_slug: p.slug,
        provider_name: p.name,
        capabilities_ui: {
          resolutions: m.supported_resolutions ?? ["1K"],
          // The admin cap can only narrow what the adapter can do.
          maxQuantity: Math.max(1, Math.min(adapter.capabilities.maxQuantity,
            typeof capOutputs === "number" && capOutputs > 0 ? capOutputs : adapter.capabilities.maxQuantity)),
          supportsReferenceImages: adapter.capabilities.supportsReferenceImages && m.supports_reference_images,
          ratios: effectiveRatios(m, adapter.capabilities.ratios),
          // No declaration means the adapter renders everything it offers.
          exactRatios: (adapter.capabilities.exactRatios ?? adapter.capabilities.ratios ?? ALL_ASPECT_RATIOS) as string[],
        },
      };
    });
}

/** The managed generator ("Gotowy generator") offers only models the admin
 *  switched on for it — and only ones that can carry reference images, since
 *  the Product Lock depends on them. */
export function managedModels(models: UsableModel[]): UsableModel[] {
  return models.filter((m) =>
    (m as { visible_managed?: boolean }).visible_managed !== false
    && m.capabilities_ui.supportsReferenceImages);
}

/** The custom-prompt generator ("Własny prompt") list. */
export function customModels(models: UsableModel[]): UsableModel[] {
  return models.filter((m) => (m as { visible_custom?: boolean }).visible_custom !== false);
}

/** Strip a usable model down to its provider-free client shape. */
export function toClientModel(m: UsableModel): ClientModel {
  const pricing: Record<string, number> = {};
  for (const res of m.capabilities_ui.resolutions) {
    const p = (m.pricing as Record<string, number> | null)?.[res];
    pricing[res] = typeof p === "number" && p >= 0 ? p : m.credit_cost;
  }
  const qualities = modelQualities(m);
  const qualityPricing: Record<string, Record<string, number>> = {};
  for (const q of qualities) {
    const row: Record<string, number> = {};
    for (const res of m.capabilities_ui.resolutions) row[res] = priceFor(m, res, q);
    qualityPricing[q] = row;
  }
  return {
    id: m.id,
    displayName: m.display_name || m.name,
    badge: m.badge,
    badgeTone: (m as { badge_tone?: string | null }).badge_tone ?? null,
    description: m.description,
    pricing,
    resolutions: m.capabilities_ui.resolutions,
    ratios: m.capabilities_ui.ratios,
    exactRatios: m.capabilities_ui.ratios.filter((r) => m.capabilities_ui.exactRatios.includes(r)),
    maxQuantity: m.capabilities_ui.maxQuantity,
    supportsReferenceImages: m.capabilities_ui.supportsReferenceImages,
    supportsNegativePrompt: m.supports_negative_prompt,
    maxReferenceImages: m.max_reference_images,
    engineSurcharge: Math.max(0, (m as { ecom_surcharge_credits?: number }).ecom_surcharge_credits ?? 0),
    qualities,
    qualityPricing,
  };
}
