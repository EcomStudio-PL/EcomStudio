/**
 * DOŁADOWANIE KREDYTÓW — ONE RATE CARD, PROGRESSIVE, IN CENTS.
 *
 * Approved 13.11.2026 (GrovBase_CENNIK_I_RENTOWNOSC_DO_AKCEPTACJI_2026-11-13):
 *
 *     credits in the purchase      USD per credit
 *     1st – 49th                   $0.56
 *     50th – 99th                  $0.52
 *     100th – 249th                $0.48
 *     250th and on                 $0.44
 *
 * PROGRESSIVE, NOT RETROACTIVE. Every credit is priced by the band it falls
 * in, like a tax bracket: 100 credits = 49 × 0.56 + 50 × 0.52 + 1 × 0.48 =
 * $54.92. A retroactive discount would make 50 credits cheaper than 49 — this
 * cannot, so the price only ever grows with the amount.
 *
 * The purchase limits are a technical decision (the approved document set no
 * minimum): 20 credits minimum so a card fee does not eat a micro-payment,
 * 5000 maximum, in steps of one credit.
 *
 * Pure and shared: the slider previews with this function in the browser and
 * the server charges with this same function; only the server's answer reaches
 * Stripe, and the server stores it as an order before any payment exists.
 */

export const TOPUP_CURRENCY = "USD";
/** Written on every order: which rate card priced it. */
export const TOPUP_PRICING_VERSION = "topup-2026-11-13";

export const TOPUP_LIMITS = { min: 20, max: 5000, step: 1 } as const;

/** Bands: `upTo` is the last credit (inclusive) priced at `cents`; null = no end. */
export const TOPUP_BANDS: readonly { upTo: number | null; cents: number }[] = [
  { upTo: 49, cents: 56 },
  { upTo: 99, cents: 52 },
  { upTo: 249, cents: 48 },
  { upTo: null, cents: 44 },
];

/** Price of `credits` in cents, exact integer arithmetic. No range check. */
export function topupCents(credits: number): number {
  let total = 0;
  let from = 1;
  for (const band of TOPUP_BANDS) {
    if (from > credits) break;
    const to = band.upTo === null ? credits : Math.min(band.upTo, credits);
    total += (to - from + 1) * band.cents;
    from = to + 1;
  }
  return total;
}

export type TopupQuote =
  | { ok: true; credits: number; amountCents: number; currency: string; version: string }
  | { ok: false; reason: "not_a_number" | "not_an_integer" | "out_of_range" };

/**
 * THE SERVER'S ANSWER to "how much is N credits". A browser value is hostile
 * until it passed every check: a real finite number (never a numeric string),
 * a whole number, inside the limits.
 */
export function quoteTopup(requested: unknown): TopupQuote {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return { ok: false, reason: "not_a_number" };
  if (!Number.isSafeInteger(requested)) return { ok: false, reason: "not_an_integer" };
  if (requested < TOPUP_LIMITS.min || requested > TOPUP_LIMITS.max) return { ok: false, reason: "out_of_range" };
  return {
    ok: true, credits: requested, amountCents: topupCents(requested),
    currency: TOPUP_CURRENCY, version: TOPUP_PRICING_VERSION,
  };
}

/** The band a credit count ends in (the marginal price), for the slider's label. */
export function topupMarginalCents(credits: number): number {
  for (const band of TOPUP_BANDS) if (band.upTo === null || credits <= band.upTo) return band.cents;
  return TOPUP_BANDS[TOPUP_BANDS.length - 1].cents;
}
