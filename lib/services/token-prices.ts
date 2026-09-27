import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { OPENAI_VISION_MODELS, VISION_FALLBACKS, VISION_MODEL } from "@/lib/ai/engine/vision";
import { EMBEDDING_MODEL } from "@/lib/server/knowledge";

type Client = SupabaseClient<Database>;

/**
 * The token price list (ai_token_prices, admin-only) together with every
 * token-billed model the platform can call — the ones in the code's own model
 * lists plus any the trace saw without a price — so the operator sees what is
 * missing instead of discovering "unknown" costs later. Prices are entered by
 * the operator from the provider's price page; nothing is pre-filled.
 */

export type TokenPriceRow = {
  providerSlug: string;
  model: string;
  /** USD per 1M tokens, or null when no price is set. */
  inputUsdPerM: number | null;
  outputUsdPerM: number | null;
  /** Cached-input price; null = not configured (billed as ordinary input). */
  cachedInputUsdPerM: number | null;
  updatedAt: string | null;
  /** Calls in the last 90 days whose cost stayed unknown for lack of a price. */
  unpricedCalls: number;
};

const KNOWN: [string, string][] = [
  ...[VISION_MODEL, ...VISION_FALLBACKS].map((m) => ["google", m] as [string, string]),
  ...OPENAI_VISION_MODELS.map((m) => ["openai", m] as [string, string]),
  ["openai", EMBEDDING_MODEL],
];

export async function readTokenPriceRows(db: Client): Promise<TokenPriceRow[]> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: prices }, { data: unpriced }] = await Promise.all([
    db.from("ai_token_prices").select("provider_slug, model, input_usd_micros_per_mtok, output_usd_micros_per_mtok, cached_input_usd_micros_per_mtok, updated_at"),
    db.from("ai_provider_calls").select("provider_slug, model")
      .eq("cost_basis", "unknown").is("unit_kind", null).gte("created_at", since).limit(5000),
  ]);
  const rows = new Map<string, TokenPriceRow>();
  const key = (p: string, m: string) => `${p}\u0000${m}`;
  const ensure = (p: string, m: string) => {
    const k = key(p, m);
    if (!rows.has(k)) rows.set(k, { providerSlug: p, model: m, inputUsdPerM: null, outputUsdPerM: null, cachedInputUsdPerM: null, updatedAt: null, unpricedCalls: 0 });
    return rows.get(k)!;
  };
  for (const [p, m] of KNOWN) ensure(p, m);
  for (const c of unpriced ?? []) if (c.model) ensure(c.provider_slug, c.model).unpricedCalls++;
  for (const r of prices ?? []) {
    const row = ensure(r.provider_slug, r.model);
    row.inputUsdPerM = r.input_usd_micros_per_mtok / 1_000_000;
    row.outputUsdPerM = r.output_usd_micros_per_mtok / 1_000_000;
    row.cachedInputUsdPerM = r.cached_input_usd_micros_per_mtok == null ? null : r.cached_input_usd_micros_per_mtok / 1_000_000;
    row.updatedAt = r.updated_at;
  }
  return [...rows.values()].sort((a, b) => a.providerSlug.localeCompare(b.providerSlug) || a.model.localeCompare(b.model));
}

/**
 * Per-unit prices (ai_unit_prices, admin-only) plus every image model the
 * platform can call, so the operator sees which ones still have NO price —
 * those keep the model's flat per-image cost (when set) or stay unknown.
 */
export type UnitPriceRow = {
  providerSlug: string; model: string; unitKind: string; resolution: string; quality: string;
  usdPerUnit: number; updatedAt: string | null;
};
export type UnitPriceModel = { providerSlug: string; model: string; name: string; flatUsdPerImage: number | null; priced: boolean };

export async function readUnitPriceRows(db: Client): Promise<{ rows: UnitPriceRow[]; models: UnitPriceModel[] }> {
  const [{ data: prices }, { data: models }] = await Promise.all([
    db.from("ai_unit_prices").select("provider_slug, model, unit_kind, resolution, quality, usd_micros_per_unit, updated_at"),
    db.from("ai_models").select("name, display_name, model_identifier, internal_cost_usd_micros, ai_providers!inner(slug)").eq("active", true),
  ]);
  const rows: UnitPriceRow[] = (prices ?? []).map((r) => ({
    providerSlug: r.provider_slug, model: r.model, unitKind: r.unit_kind, resolution: r.resolution, quality: r.quality,
    usdPerUnit: Number(r.usd_micros_per_unit) / 1_000_000, updatedAt: r.updated_at,
  })).sort((a, b) => a.providerSlug.localeCompare(b.providerSlug) || a.model.localeCompare(b.model)
    || a.resolution.localeCompare(b.resolution) || a.quality.localeCompare(b.quality));
  const list: UnitPriceModel[] = (models ?? []).map((m) => {
    const slug = (m as unknown as { ai_providers: { slug: string } }).ai_providers.slug;
    return {
      providerSlug: slug, model: m.model_identifier, name: m.display_name || m.name,
      flatUsdPerImage: m.internal_cost_usd_micros ? m.internal_cost_usd_micros / 1_000_000 : null,
      priced: rows.some((r) => r.providerSlug === slug && m.model_identifier.startsWith(r.model)),
    };
  }).sort((a, b) => a.providerSlug.localeCompare(b.providerSlug) || a.model.localeCompare(b.model));
  return { rows, models: list };
}
