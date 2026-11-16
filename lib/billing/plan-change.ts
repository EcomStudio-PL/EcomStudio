/**
 * SMART SUBSCRIPTION MANAGEMENT — what a plan change costs, decided by pure
 * arithmetic (no Stripe, no database), so every scenario is a unit test.
 *
 * THE RULES
 *
 *   monthly → monthly, higher tier   UPGRADE, now. A new period starts, the new
 *                                    plan's full pool is granted, the old
 *                                    period's pool is closed, and the price is
 *                                    reduced by the DEDUCTION below.
 *   monthly → monthly, lower tier    DOWNGRADE, now. Full new price, no
 *                                    deduction and no refund; the old credits
 *                                    stay until their original expiry and the
 *                                    full new pool is granted.
 *   monthly → annual (any tier)      now, with the deduction.
 *   annual → annual, higher tier     now, with the deduction: the current
 *                                    tranche AND the future tranches are
 *                                    settled once (never twice), superseded
 *                                    tranches are voided and the new annual
 *                                    schedule starts (tranche 1 now, never 12
 *                                    months at once).
 *   annual → annual, lower tier      at the END of the paid year.
 *   annual → monthly (any tier)      at the END of the paid year.
 *
 *   Tier = the plans' monthly list prices.
 *
 * THE DEDUCTION = min(time value, unused credit value), both from what the
 * customer actually paid for the current period (the basis), never from a
 * list price they did not pay:
 *
 *   time value   = basis × (time left in the period / period length)
 *   credit value = basis × (unused eligible credits / credits of the period)
 *
 * Only THIS subscription's current-period pool is eligible: its subscription
 * lot(s) of the current period (annual: the current tranche's lot) and, for an
 * annual plan, its pending tranches. Top-ups, bonus and legacy credits are never
 * counted and never touched.
 *
 * Money is integer cents, credits are integer hundredths: every division
 * floors, so the deduction can only ever be a cent smaller than exact, never
 * larger.
 *
 *   Example (the spec's): Starter $24.90 → PRO $49.90, half the month gone,
 *   20 of 55 credits used: time 1245, credits floor(2490 × 35/55) = 1584,
 *   deduction 1245, to pay 3745 ($37.45).
 */

export type BillingPeriod = "monthly" | "annual";

export type PlanFacts = {
  id: string;
  slug: string;
  name: string;
  /** Monthly list price (minor units) — the tier. */
  priceCents: number;
  annualPriceCents: number;
  currency: string;
  /** monthly_credits + bonus_credits */
  credits: number;
};

export type PoolLot = { id: string; amount: number; remaining: number; expiresAt: string };
export type PoolTranche = { id: string; credits: number; startsAt: string };

export type CurrentSubscription = {
  plan: PlanFacts;
  period: BillingPeriod;
  periodStart: string;
  periodEnd: string;
  /** What the current period is worth: what was paid for it (tax excluded),
   *  plus a deduction carried into it by an earlier change, never above its
   *  list price. */
  basisCents: number;
  /** The credits the current period buys in total (monthly: the period's
   *  lot; annual: the sum of all twelve tranches of that payment). */
  periodCredits: number;
  lots: PoolLot[];
  pendingTranches: PoolTranche[];
};

export type ChangeKind = "upgrade" | "downgrade" | "to_annual" | "to_monthly";
export type Timing = "immediate" | "period_end";

export type QuoteRefusal =
  | "same_plan"
  | "unknown_target"
  | "currency_mismatch"
  | "period_ended"
  | "too_close_to_renewal"
  | "no_period_credits"
  | "deduction_exceeds_price";

export type ChangeQuote = {
  kind: ChangeKind;
  timing: Timing;
  from: { planId: string; slug: string; name: string; period: BillingPeriod };
  to: { planId: string; slug: string; name: string; period: BillingPeriod };
  currency: string;
  /** The new plan's list price for its period (minor units). */
  listPriceCents: number;
  basisCents: number;
  timeLeftShare: number;
  timeValueCents: number;
  /** Unused eligible credits (hundredths exact, as a number with 2 decimals). */
  unusedCredits: number;
  creditValueCents: number;
  /** Which of the two decided the deduction. */
  deductionBasis: "time" | "credits" | "none";
  deductionCents: number;
  /** Charged when the change happens: now (immediate) or at period end. */
  amountDueCents: number;
  /** Credits of the new plan granted on payment (annual: the first tranche). */
  newCreditsNow: number;
  /** Annual target: credits per month for the remaining eleven tranches. */
  newCreditsPerMonth: number;
  /** What happens to the current pool. */
  oldPool: "closed" | "kept_until_expiry" | "continues_until_period_end";
  /** The current pool's unused credits closed by the change (0 when kept). */
  closedCredits: number;
  /** When the change takes effect (ISO). */
  effectiveAt: string;
  /** The lots and tranches the quote was computed from — the hold must find
   *  them exactly so, or the quote is stale. */
  pool: { lots: { id: string; remaining: number }[]; tranches: { id: string; credits: number }[] };
};

export type QuoteResult = { ok: true; quote: ChangeQuote } | { ok: false; reason: QuoteRefusal };

/** Stripe's smallest chargeable USD amount. A change whose deduction would
 *  leave less than this to pay is not automated (an admin looks at it). */
export const MIN_CHARGE_CENTS = 50;
/** An immediate change this close to the renewal waits for the renewal: the
 *  pending update would expire at the period end, and the renewal would pay
 *  the old price for a period about to be replaced. */
export const RENEWAL_GUARD_MS = 24 * 3600 * 1000;

const hundredths = (n: number) => Math.round(n * 100);
const fromHundredths = (h: number) => h / 100;

export function priceFor(plan: PlanFacts, period: BillingPeriod): number {
  return period === "annual" ? plan.annualPriceCents : plan.priceCents;
}

/** Which change this is, and when it happens. Pure classification. */
export function classifyChange(
  from: { plan: PlanFacts; period: BillingPeriod },
  to: { plan: PlanFacts; period: BillingPeriod },
): { kind: ChangeKind; timing: Timing; deduction: boolean } | null {
  if (from.plan.id === to.plan.id && from.period === to.period) return null;
  const higher = to.plan.priceCents > from.plan.priceCents;
  if (from.period === "monthly") {
    if (to.period === "annual") return { kind: "to_annual", timing: "immediate", deduction: true };
    return higher
      ? { kind: "upgrade", timing: "immediate", deduction: true }
      : { kind: "downgrade", timing: "immediate", deduction: false };
  }
  if (to.period === "monthly") return { kind: "to_monthly", timing: "period_end", deduction: false };
  return higher
    ? { kind: "upgrade", timing: "immediate", deduction: true }
    : { kind: "downgrade", timing: "period_end", deduction: false };
}

/**
 * The quote. `at` is the moment it is computed for — a confirmation recomputes
 * with the SAME `at` (the quote's own time) and the pool as it stands then:
 * equal figures mean the quote still holds, any difference means it is stale.
 */
export function quoteChange(current: CurrentSubscription, target: { plan: PlanFacts; period: BillingPeriod }, at: Date): QuoteResult {
  const cls = classifyChange(current, target);
  if (!cls) return { ok: false, reason: "same_plan" };
  const listPrice = priceFor(target.plan, target.period);
  if (!(listPrice > 0)) return { ok: false, reason: "unknown_target" };
  if (target.plan.currency.toUpperCase() !== current.plan.currency.toUpperCase()) return { ok: false, reason: "currency_mismatch" };

  const now = at.getTime();
  const start = Date.parse(current.periodStart);
  const end = Date.parse(current.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now) return { ok: false, reason: "period_ended" };
  if (cls.timing === "immediate" && end - now < RENEWAL_GUARD_MS) return { ok: false, reason: "too_close_to_renewal" };

  const pool = {
    lots: current.lots.map((l) => ({ id: l.id, remaining: l.remaining })),
    tranches: current.pendingTranches.map((t) => ({ id: t.id, credits: t.credits })),
  };
  const unusedH = current.lots.reduce((s, l) => s + hundredths(l.remaining), 0)
    + current.pendingTranches.reduce((s, t) => s + hundredths(t.credits), 0);
  const periodH = hundredths(current.periodCredits);
  const share = Math.min(1, Math.max(0, (end - Math.max(now, start)) / (end - start)));

  const base = {
    kind: cls.kind,
    timing: cls.timing,
    from: { planId: current.plan.id, slug: current.plan.slug, name: current.plan.name, period: current.period },
    to: { planId: target.plan.id, slug: target.plan.slug, name: target.plan.name, period: target.period },
    currency: target.plan.currency.toUpperCase(),
    listPriceCents: listPrice,
    basisCents: current.basisCents,
    timeLeftShare: Math.round(share * 10000) / 10000,
    unusedCredits: fromHundredths(unusedH),
    newCreditsNow: target.plan.credits,
    newCreditsPerMonth: target.period === "annual" ? target.plan.credits : 0,
    pool,
  };

  if (!cls.deduction) {
    return {
      ok: true,
      quote: {
        ...base,
        timeValueCents: 0,
        creditValueCents: 0,
        deductionBasis: "none",
        deductionCents: 0,
        amountDueCents: listPrice,
        oldPool: cls.timing === "immediate" ? "kept_until_expiry" : "continues_until_period_end",
        closedCredits: 0,
        effectiveAt: cls.timing === "immediate" ? at.toISOString() : new Date(end).toISOString(),
      },
    };
  }

  if (periodH <= 0) return { ok: false, reason: "no_period_credits" };
  const basis = Math.max(0, Math.floor(current.basisCents));
  // Integer arithmetic: basis ≤ ~10^5 cents, hundredths ≤ ~10^6 — far below 2^53.
  const timeValue = Math.floor((basis * (end - Math.max(now, start))) / (end - start));
  const creditValue = Math.floor((basis * Math.min(unusedH, periodH)) / periodH);
  const deduction = Math.max(0, Math.min(timeValue, creditValue));
  const due = listPrice - deduction;
  if (due < MIN_CHARGE_CENTS) return { ok: false, reason: "deduction_exceeds_price" };

  return {
    ok: true,
    quote: {
      ...base,
      timeValueCents: timeValue,
      creditValueCents: creditValue,
      deductionBasis: deduction === 0 ? "none" : timeValue <= creditValue ? "time" : "credits",
      deductionCents: deduction,
      amountDueCents: due,
      oldPool: "closed",
      closedCredits: fromHundredths(unusedH),
      effectiveAt: at.toISOString(),
    },
  };
}

/** The figures a confirmation must find unchanged (the pool and the money). */
export function quoteFingerprint(q: ChangeQuote): string {
  return JSON.stringify([
    q.kind, q.timing, q.from.planId, q.from.period, q.to.planId, q.to.period, q.currency,
    q.listPriceCents, q.basisCents, q.timeValueCents, q.creditValueCents, q.deductionCents, q.amountDueCents,
    q.pool.lots.map((l) => [l.id, hundredths(l.remaining)]).sort(),
    q.pool.tranches.map((t) => [t.id, hundredths(t.credits)]).sort(),
  ]);
}

/** Value basis of a period: paid (tax excluded) + a carried deduction, capped at list. */
export function periodBasis(paidCents: number, taxCents: number | null, carriedDeductionCents: number, listCents: number): number {
  const paid = Math.max(0, Math.floor(paidCents) - Math.max(0, Math.floor(taxCents ?? 0)));
  return Math.max(0, Math.min(Math.floor(listCents), paid + Math.max(0, Math.floor(carriedDeductionCents))));
}
