/**
 * ANNUAL BILLING — OFFERED ONLY WHEN A REAL ANNUAL PRICE EXISTS.
 *
 * WHAT WAS WRONG. The cennik showed a monthly/annual toggle with a "-17%"
 * badge, and the annual figure was computed in the component:
 *
 *     effective = Math.round(priceCents * 10 / 12)   // "ten months for twelve"
 *
 * `subscription_plans.annual_price_cents` is 0 on all four production plans.
 * So the page was quoting a yearly price that exists nowhere — not in the
 * database, not in Stripe, not in anyone's decision. The first person to
 * click "Rocznie" and then pay would have been charged something else.
 *
 * THE RULE THIS FILE ENFORCES. The annual price is a STORED NUMBER or it does
 * not exist. No coefficient, no "ten for twelve", no default. Until the prices
 * are decided, annual billing is simply not on offer: the toggle is not
 * rendered and no Stripe annual Price is created. The moment real values land
 * in `annual_price_cents`, the toggle appears and quotes them — nothing else
 * has to change, which is what "architecture ready" has to mean.
 *
 * WHY ALL PAID PLANS, NOT SOME. A toggle that switches the whole row cannot
 * be half-true. If Pro has an annual price and Starter does not, flipping to
 * "Rocznie" would show one real yearly figure beside three monthly ones under
 * a yearly heading. So the offer is made only when every paid plan can honour
 * it. The free plan is exempt: nothing is billed, annually or otherwise.
 */

export type PlanPricing = {
  priceCents: number;
  annualPriceCents: number;
};

/** A paid plan is one with a monthly price. Free plans bill nothing either way. */
const isPaid = (p: PlanPricing) => p.priceCents > 0;

/** True only when every paid plan carries a real, positive annual price. */
export function annualBillingAvailable(plans: PlanPricing[]): boolean {
  const paid = plans.filter(isPaid);
  return paid.length > 0 && paid.every((p) => p.annualPriceCents > 0);
}

/**
 * What an annual plan works out to per month — from the stored yearly total,
 * divided by twelve. A plan with no annual price falls back to its monthly
 * price rather than to a discount that was never agreed.
 */
export function annualMonthlyCents(p: PlanPricing): number {
  return p.annualPriceCents > 0 ? Math.round(p.annualPriceCents / 12) : p.priceCents;
}

/**
 * The saving a customer really gets, in whole percent, against twelve monthly
 * payments — and the SMALLEST such saving across the paid plans, because one
 * badge sits above all four columns and a badge that overstates any column is
 * a false price claim. Returns 0 when there is nothing truthful to show, and a
 * caller must then render no badge rather than "-0%".
 */
export function annualSavingPct(plans: PlanPricing[]): number {
  const paid = plans.filter((p) => isPaid(p) && p.annualPriceCents > 0);
  if (paid.length === 0) return 0;
  const pcts = paid.map((p) => {
    const twelveMonths = p.priceCents * 12;
    return Math.round((1 - p.annualPriceCents / twelveMonths) * 100);
  });
  return Math.max(0, Math.min(...pcts));
}
