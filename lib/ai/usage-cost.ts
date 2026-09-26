/**
 * PROVIDER COST — pure rules, no I/O, shared by the recorder and the tests.
 *
 * None of the providers GrovBase is connected to returns a price for a call.
 * What they return (sometimes) is usage: tokens for a text or vision request,
 * images for an image request. The money is therefore always usage × a price
 * list, and it is labelled for what it is:
 *
 *   actual     the provider itself stated the billed amount (none do today)
 *   estimated  usage × our price list (tokens × token price, images × the
 *              model's per-image cost)
 *   unknown    no price is known for this model — cost stays NULL; a zero
 *              would read as "free", which is a lie in the other direction
 */

export type CostBasis = "actual" | "estimated" | "unknown";
export type Cost = { basis: "actual" | "estimated"; usdMicros: number } | { basis: "unknown" };

export type TokenPrice = {
  providerSlug: string;
  model: string;
  /** USD micros per one million input tokens. */
  inputPerMTok: number;
  /** USD micros per one million output tokens. */
  outputPerMTok: number;
  /** USD micros per one million CACHED input tokens, where the provider bills
   *  them differently. Absent = cached tokens are priced as ordinary input. */
  cachedInputPerMTok?: number | null;
};

export const UNKNOWN_COST: Cost = { basis: "unknown" };

/**
 * The listed price for a model. Google retires and aliases ids
 * (`gemini-flash-latest`), so an exact id wins and otherwise the longest
 * listed prefix does ("gpt-4.1" prices "gpt-4.1-2025-04-14").
 */
export function findTokenPrice(prices: readonly TokenPrice[], providerSlug: string, model: string): TokenPrice | null {
  const own = prices.filter((p) => p.providerSlug === providerSlug);
  const exact = own.find((p) => p.model === model);
  if (exact) return exact;
  const prefixed = own
    .filter((p) => model.startsWith(p.model))
    .sort((a, b) => b.model.length - a.model.length);
  return prefixed[0] ?? null;
}

/** Tokens × list price. Unknown unless BOTH a price and the provider's own
 *  token counts are present. */
export function tokenCost(
  prices: readonly TokenPrice[], providerSlug: string, model: string,
  inputTokens: number | undefined | null, outputTokens: number | undefined | null,
  /** Of `inputTokens`, how many the provider served from its cache. */
  cachedInputTokens?: number | null,
): Cost {
  if (inputTokens == null && outputTokens == null) return UNKNOWN_COST;
  const price = findTokenPrice(prices, providerSlug, model);
  if (!price) return UNKNOWN_COST;
  const cached = Math.min(Math.max(0, cachedInputTokens ?? 0), Math.max(0, inputTokens ?? 0));
  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok;
  const micros = (((inputTokens ?? 0) - cached) * price.inputPerMTok + cached * cachedRate
    + (outputTokens ?? 0) * price.outputPerMTok) / 1_000_000;
  return { basis: "estimated", usdMicros: Math.round(micros) };
}

/* ── per-unit prices (images, seconds, requests, pages) ─────────────────── */

export type UnitKind = "image" | "second" | "request" | "page";

/** An admin price for one unit of a model's output. `*` matches anything. */
export type UnitPrice = {
  providerSlug: string;
  model: string;
  unitKind: UnitKind;
  resolution: string;
  quality: string;
  usdMicrosPerUnit: number;
};

/**
 * The most specific configured price: exact resolution + quality, then exact
 * resolution, then exact quality, then the model's flat price. Model ids match
 * exactly or by the longest listed prefix, as for tokens. No row → null.
 */
export function findUnitPrice(
  prices: readonly UnitPrice[], providerSlug: string, model: string, unitKind: UnitKind,
  resolution?: string | null, quality?: string | null,
): UnitPrice | null {
  const own = prices.filter((p) => p.providerSlug === providerSlug && p.unitKind === unitKind
    && (p.model === model || model.startsWith(p.model)));
  if (own.length === 0) return null;
  const longest = Math.max(...own.map((p) => (p.model === model ? 1000 : p.model.length)));
  const sameModel = own.filter((p) => (p.model === model ? 1000 : p.model.length) === longest);
  const res = resolution ?? "*";
  const q = quality ?? "*";
  return sameModel.find((p) => p.resolution === res && p.quality === q)
    ?? sameModel.find((p) => p.resolution === res && p.quality === "*")
    ?? sameModel.find((p) => p.resolution === "*" && p.quality === q)
    ?? sameModel.find((p) => p.resolution === "*" && p.quality === "*")
    ?? null;
}

/**
 * Units × the configured unit price; without one, images fall back to the
 * model's flat per-image cost (`imageCost`); anything else is UNKNOWN.
 */
export function unitCost(
  prices: readonly UnitPrice[], providerSlug: string, model: string, unitKind: UnitKind, units: number,
  opts: { resolution?: string | null; quality?: string | null; perImageFallbackUsdMicros?: number | null } = {},
): Cost {
  const price = findUnitPrice(prices, providerSlug, model, unitKind, opts.resolution, opts.quality);
  if (price) return { basis: "estimated", usdMicros: Math.round(price.usdMicrosPerUnit * Math.max(0, units)) };
  if (unitKind === "image") return imageCost(opts.perImageFallbackUsdMicros, units);
  return UNKNOWN_COST;
}

/** Sum a set of costs: the known part, and how many were unknown. */
export function sumKnownCosts(costs: readonly Cost[]): { usdMicros: number; unknown: number } {
  let usdMicros = 0; let unknown = 0;
  for (const c of costs) {
    if (c.basis === "unknown") unknown++;
    else usdMicros += c.usdMicros;
  }
  return { usdMicros, unknown };
}

/** Images × the model's configured per-image cost. A model with no cost set
 *  (0 or null) is unknown, not free. */
export function imageCost(perImageUsdMicros: number | null | undefined, images: number): Cost {
  if (!perImageUsdMicros || perImageUsdMicros <= 0) return images === 0 ? { basis: "estimated", usdMicros: 0 } : UNKNOWN_COST;
  return { basis: "estimated", usdMicros: Math.round(perImageUsdMicros * Math.max(0, images)) };
}

/** A price in USD from a provider catalogue (e.g. 0.02) as micros. */
export function usdToMicros(usd: number | null | undefined): number | null {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return null;
  return Math.round(usd * 1_000_000);
}
