/**
 * AI COST ENGINE — one place that turns a provider's real USD cost into the
 * number of credits a seller is charged, and back into a margin figure the
 * admin can audit.
 *
 * The rule the business runs on: gross margin, not markup. A tool that costs
 * us 0.10 PLN must sell for at least 0.20 PLN — that is 50% margin (100%
 * markup), and the two are NOT the same number. On top of that sits a buffer
 * that absorbs USD/PLN drift and the requests a provider fails after we have
 * already paid for them.
 *
 *   price_pln ≥ cost_pln × (1 + buffer) / (1 − margin_floor)
 *
 * Pure arithmetic, no secrets, safe to import in the browser so the panel can
 * show the same price the server will charge.
 */

export type BillingConfig = {
  /** PLN a single credit is sold for. */
  plnPerCredit: number;
  usdToPln: number;
  /** Minimum gross margin, in percent, on any paid operation. */
  minMarginPercent: number;
  /** FX + failed-request cushion added on top of the provider cost. */
  bufferPercent: number;
};

export const DEFAULT_BILLING: BillingConfig = {
  plnPerCredit: 0.19,
  usdToPln: 4.0,
  minMarginPercent: 50,
  bufferPercent: 12,
};

/** Read the admin-editable billing settings, falling back to the defaults. */
export function billingFrom(value: unknown): BillingConfig {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number) =>
    typeof x === "number" && Number.isFinite(x) && x > 0 ? x : fallback;
  const per100 = num(v.price_per_100_credits, DEFAULT_BILLING.plnPerCredit * 100);
  return {
    plnPerCredit: per100 / 100,
    usdToPln: num(v.usd_to_pln, DEFAULT_BILLING.usdToPln),
    minMarginPercent: Math.min(95, num(v.min_margin_percent, DEFAULT_BILLING.minMarginPercent)),
    bufferPercent: num(v.buffer_percent, DEFAULT_BILLING.bufferPercent),
  };
}

export type PriceQuote = {
  /** Credits the seller pays. Zero for local tools. */
  credits: number;
  /** What the operation costs us, in USD and PLN. */
  costUsd: number;
  costPln: number;
  /** What the seller pays, in PLN, at the current credit price. */
  pricePln: number;
  /** Realised gross margin at this price, in percent. */
  marginPercent: number;
  /** True when the floor could not be met even at the charged price. */
  belowFloor: boolean;
};

/** Smallest whole credit count that satisfies the margin floor + buffer. */
export function creditsForCost(costUsd: number, billing: BillingConfig): number {
  if (costUsd <= 0) return 0;
  const costPln = costUsd * billing.usdToPln;
  const cushioned = costPln * (1 + billing.bufferPercent / 100);
  const required = cushioned / (1 - billing.minMarginPercent / 100);
  return Math.max(1, Math.ceil(required / billing.plnPerCredit));
}

export function grossMarginPercent(credits: number, costUsd: number, billing: BillingConfig): number {
  const revenue = credits * billing.plnPerCredit;
  if (revenue <= 0) return costUsd <= 0 ? 100 : -100;
  return ((revenue - costUsd * billing.usdToPln) / revenue) * 100;
}

/**
 * Final price for one operation. `floorCredits` is the admin-set price in
 * `service_catalog`: it can raise the price but never drop it below what the
 * margin rule demands, so a cheap provider makes the tool cheaper and an
 * expensive one makes it dearer — automatically, without a deploy.
 */
export function quote(costUsd: number, floorCredits: number, billing: BillingConfig): PriceQuote {
  const needed = creditsForCost(costUsd, billing);
  const credits = Math.max(needed, Math.max(0, Math.trunc(floorCredits)));
  const margin = grossMarginPercent(credits, costUsd, billing);
  return {
    credits,
    costUsd,
    costPln: costUsd * billing.usdToPln,
    pricePln: credits * billing.plnPerCredit,
    marginPercent: margin,
    belowFloor: costUsd > 0 && margin < billing.minMarginPercent,
  };
}

export const usdToMicros = (usd: number) => Math.max(0, Math.round(usd * 1_000_000));
export const microsToUsd = (micros: number) => micros / 1_000_000;
