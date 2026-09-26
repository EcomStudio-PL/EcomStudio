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
): Cost {
  if (inputTokens == null && outputTokens == null) return UNKNOWN_COST;
  const price = findTokenPrice(prices, providerSlug, model);
  if (!price) return UNKNOWN_COST;
  const micros = ((inputTokens ?? 0) * price.inputPerMTok + (outputTokens ?? 0) * price.outputPerMTok) / 1_000_000;
  return { basis: "estimated", usdMicros: Math.round(micros) };
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
