/**
 * WHAT A CREDIT COSTS — one rate card, read from the database.
 *
 * THE RULE. There is no credit-price coefficient hardcoded anywhere in this
 * application. The rate card IS the `credit_packages` table: four rows an
 * admin can edit, each one a real (credits, price) point. A custom amount is
 * priced by INTERPOLATING between the two packs that bracket it, so the curve
 * a slider draws is the same curve the fixed packs sit on, and changing a pack
 * in the admin changes both at once. Invent a "0.19 zł per credit" constant
 * anywhere and the two stop agreeing the moment a price is edited.
 *
 * WHY THIS IS ITS OWN MODULE. The slider renders in the browser and the price
 * is charged on the server, and those two numbers must be produced by the SAME
 * function — otherwise a customer is quoted one amount and charged another,
 * which is the failure the whole Stripe integration is built to avoid. The
 * browser's figure is a PREVIEW; `validateCustomCredits` on the server is what
 * money is taken against, and it never reads a price from the request.
 *
 * WHAT THE BROWSER MAY SEND: `credits_requested`, an integer. Nothing else.
 * Not a price, not a currency, not a discount, not a pack's amount.
 */

export type LadderStep = { credits: number; cents: number };

/** A pack row as it comes out of `credit_packages`. */
export type PackRow = {
  credits: number;
  bonus_credits: number;
  price_cents: number;
  currency?: string | null;
};

/**
 * The rate card, ascending. A pack's position on the curve is what the customer
 * RECEIVES — credits plus bonus — because that is what they are buying; pricing
 * against the base amount alone would make a bonus pack look worse per credit
 * than it is.
 */
export function creditLadder(packs: PackRow[]): LadderStep[] {
  return packs
    .map((p) => ({ credits: p.credits + p.bonus_credits, cents: p.price_cents }))
    .filter((s) => Number.isFinite(s.credits) && Number.isFinite(s.cents) && s.credits > 0 && s.cents > 0)
    .sort((a, b) => a.credits - b.credits);
}

/** The slider's bounds and granularity. A custom amount outside this is refused. */
export function customCreditsRange(ladder: LadderStep[]): { min: number; max: number; step: number } | null {
  if (ladder.length < 2) return null;
  const min = ladder[0].credits;
  const max = ladder[ladder.length - 1].credits;
  if (max <= min) return null;
  return { min, max, step: Math.max(50, Math.round((max - min) / 100 / 50) * 50) };
}

/**
 * The price of an arbitrary number of credits, in minor units.
 *
 * Below the smallest pack it is the smallest pack's price, above the largest
 * it is the largest pack's price — the curve is not extrapolated, because an
 * extrapolated price is an invented one. In between it is a straight line
 * between the bracketing packs, rounded to whole units of currency so nobody
 * is quoted 47.31 zł.
 */
export function priceForCredits(credits: number, ladder: LadderStep[]): number {
  if (ladder.length === 0) return 0;
  if (credits <= ladder[0].credits) return ladder[0].cents;
  const last = ladder[ladder.length - 1];
  if (credits >= last.credits) return last.cents;
  for (let i = 1; i < ladder.length; i += 1) {
    const lo = ladder[i - 1];
    const hi = ladder[i];
    if (credits <= hi.credits) {
      const ratio = (credits - lo.credits) / (hi.credits - lo.credits);
      return Math.round((lo.cents + (hi.cents - lo.cents) * ratio) / 100) * 100;
    }
  }
  return last.cents;
}

export type CustomCreditsRefusal =
  | "not_a_number" | "not_an_integer" | "out_of_range" | "no_ladder" | "no_price";

export type CustomCreditsQuote =
  | { ok: true; credits: number; amountCents: number }
  | { ok: false; reason: CustomCreditsRefusal };

/**
 * THE SERVER'S ANSWER TO "how much is N credits", and the only one that may
 * reach Stripe.
 *
 * Every refusal here is a request that came from a browser and is therefore
 * assumed hostile until it has passed all of them:
 *
 *   · not a number at all — "500", {}, null, NaN, Infinity;
 *   · not an integer — 500.5 credits is not a thing, and a fraction is how a
 *     rounding trick gets in;
 *   · out of the ladder's range — including 0 and negatives, which would
 *     otherwise reach Stripe as a zero or negative line item;
 *   · above Number.MAX_SAFE_INTEGER territory — clamped by the range check,
 *     but stated explicitly because an overflow that silently wraps is the
 *     classic way to buy a million credits for nothing.
 *
 * What it never does is read an amount from the caller. The price is computed
 * here, from the packs, and returned alongside the credits so the caller passes
 * both to Stripe as one indivisible quote.
 */
export function validateCustomCredits(requested: unknown, ladder: LadderStep[]): CustomCreditsQuote {
  const range = customCreditsRange(ladder);
  if (!range) return { ok: false, reason: "no_ladder" };

  // A JSON body may hand us anything. Only a real, finite JS number counts —
  // a numeric STRING is refused rather than coerced, because accepting "1e9"
  // or " 500 " means accepting whatever else the parser is lenient about.
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return { ok: false, reason: "not_a_number" };
  }
  if (!Number.isSafeInteger(requested)) {
    return { ok: false, reason: "not_an_integer" };
  }
  if (requested < range.min || requested > range.max) {
    return { ok: false, reason: "out_of_range" };
  }

  const amountCents = priceForCredits(requested, ladder);
  // A zero or negative amount is not a cheap purchase, it is a broken rate
  // card. Refuse rather than create a Stripe line item for nothing.
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "no_price" };
  }
  return { ok: true, credits: requested, amountCents };
}
