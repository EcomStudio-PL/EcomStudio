import "server-only";
import { creditLadder, validateCustomCredits, type PackRow } from "@/lib/plans/credit-price";

/**
 * THE OFFER — what GrovBase is willing to sell, on what terms, until when.
 *
 * Three layers, kept apart on purpose:
 *
 *   PRESENTATION   names, order, icons, badges, colours, FAQ copy. Lives in
 *                  components/plan/pricing-page-config.ts and the dictionaries.
 *                  Changing it cannot change a price.
 *
 *   OFFER (this)   which periods are sold, which top-up amounts exist, the
 *                  premiere deadline, approved prices for amounts the catalogue
 *                  does not hold, and the cost inputs that validate them. Server
 *                  only: a browser never sees this object, it sees what the
 *                  server computed FROM it.
 *
 *   CATALOGUE      subscription_plans and credit_packages, synced to Stripe by
 *                  the admin panel. The amount actually charged always comes
 *                  from here or from an approved figure below, never from a
 *                  request.
 *
 * EVERY NEW FINANCIAL MECHANISM IN THIS FILE STARTS OFF. Annual billing, the
 * premiere price lock and approved prices for new top-up amounts are wired
 * through the checkout and refuse until a real value lands here — in a
 * reviewed commit, which is the audit trail. A value that is not approved is
 * `null`, never a placeholder that happens to look like a price.
 */

/** The custom amounts the slider offers. Nothing between them is sold. */
export const TOPUP_TIERS = [1000, 3000, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000] as const;

/** The five pack cards, in display order. A slot is a credit amount, not a row. */
export const PACK_SLOTS = [800, 500, 300, 200, 100] as const;

export type PaidPlanSlug = "starter" | "pro" | "agency";
export const PAID_PLAN_SLUGS: readonly PaidPlanSlug[] = ["starter", "pro", "agency"];
type PerPlan<T> = Record<PaidPlanSlug, T>;

export type PricingOffer = {
  premiere: {
    /** The banner and the price lock. OFF until regular prices are approved. */
    enabled: boolean;
    /** Written onto every subscription sold while the offer runs. */
    key: string;
    /** Server time decides. 31 Oct 2026 is after the DST change (25 Oct), so
     *  Europe/Warsaw is CET, UTC+1. */
    endsAt: string;
    /** The approved price AFTER the premiere, per plan. Without all three the
     *  offer cannot be honest about what it is a discount from, so it stays off. */
    regularMonthlyCents: PerPlan<number | null>;
  };
  annual: {
    /**
     * OFF, and not only because no annual Stripe Price exists. The webhook
     * grants `monthly_credits` once per PAID INVOICE — an annual invoice would
     * buy a year and grant a month. Selling annual needs a renewal/credit
     * schedule first; until then this refuses even a fully synced annual Price.
     */
    enabled: boolean;
  };
  topups: {
    /** Packs and custom amounts only with a live paid plan (server-enforced). */
    requireActivePlan: boolean;
    /**
     * Price slider tiers and pack slots that have no pack row with the
     * EXISTING custom-credit rule: the straight line between the live packs
     * (lib/plans/credit-price.ts). It is the rule /plan already sold any amount
     * from 100 to 3000 with — no extrapolation, so amounts above the largest
     * pack stay unpriced.
     */
    existingLadder: boolean;
    /** Approved price per amount, for every plan. credits → minor units. */
    approvedCents: Readonly<Record<number, number>> | null;
    /** Approved price per amount per plan. Wins over `approvedCents`. */
    perPlanCents: PerPlan<Readonly<Record<number, number>> | null> | null;
    /**
     * What one credit COSTS GrovBase and what a payment costs — the inputs an
     * approved price is validated against. All null: nothing approved can be
     * validated, so nothing approved is sold.
     */
    costs: {
      /** Provider cost of one credit, minor units (grosze), worst case. */
      providerCentsPerCredit: number | null;
      /** Payment fee: percent of the amount, plus a fixed part in minor units. */
      paymentFeePercent: number | null;
      paymentFeeFixedCents: number | null;
      /** Margin after provider and payment cost, percent of the price. */
      minMarginPercent: number | null;
    };
    /**
     * Policy: a top-up credit may not be cheaper than this share of the
     * buyer's own plan credit (1 = never cheaper than the plan). null = no rule.
     */
    minUnitVsPlan: number | null;
  };
};

export const PRICING_OFFER: PricingOffer = {
  premiere: {
    enabled: false,
    key: "premiere-2026-10",
    endsAt: "2026-10-31T23:59:59+01:00",
    regularMonthlyCents: { starter: null, pro: null, agency: null },
  },
  annual: { enabled: false },
  topups: {
    requireActivePlan: true,
    existingLadder: true,
    approvedCents: null,
    perPlanCents: null,
    costs: {
      providerCentsPerCredit: null,
      paymentFeePercent: null,
      paymentFeeFixedCents: null,
      minMarginPercent: null,
    },
    minUnitVsPlan: null,
  },
};

/* ── premiere ──────────────────────────────────────────────────────────────*/

export type PremiereState =
  | { status: "off" }
  | { status: "active"; key: string; endsAt: string; endsAtMs: number }
  | { status: "ended"; key: string; endsAt: string; endsAtMs: number };

/**
 * Whether the premiere offer runs at `now` — SERVER time, always. A browser
 * clock is never asked: a visitor who sets their date back does not reopen an
 * offer, and one whose clock runs fast does not close it early for anyone else.
 */
export function premiereState(now: number, offer: PricingOffer = PRICING_OFFER): PremiereState {
  const p = offer.premiere;
  if (!p.enabled) return { status: "off" };
  const endsAtMs = Date.parse(p.endsAt);
  const regular = PAID_PLAN_SLUGS.map((s) => p.regularMonthlyCents[s]);
  // Unconfigured is OFF, not "active with a blank": the promise names a price
  // the customer keeps, and the regular price is what makes it a promise.
  if (!Number.isFinite(endsAtMs) || regular.some((c) => typeof c !== "number" || c <= 0)) {
    return { status: "off" };
  }
  return now < endsAtMs
    ? { status: "active", key: p.key, endsAt: p.endsAt, endsAtMs }
    : { status: "ended", key: p.key, endsAt: p.endsAt, endsAtMs };
}

/**
 * After the deadline a plan still priced BELOW its approved regular price is
 * not sold: the catalogue still carries the premiere figure and somebody has
 * to move it (the admin price sync creates the new Stripe Price and leaves the
 * premiere subscribers on theirs). Refusing is the only way an expired offer
 * cannot be granted by a page somebody left open.
 */
export function premiereExpiredFor(
  slug: string, priceCents: number, now: number, offer: PricingOffer = PRICING_OFFER,
): boolean {
  const state = premiereState(now, offer);
  if (state.status !== "ended") return false;
  const regular = offer.premiere.regularMonthlyCents[slug as PaidPlanSlug];
  return typeof regular === "number" && priceCents < regular;
}

/** The mark a subscription sold during the premiere carries — and only then. */
export function premiereMetadata(now: number, offer: PricingOffer = PRICING_OFFER): Record<string, string> {
  const state = premiereState(now, offer);
  return state.status === "active" ? { grovbase_price_lock: state.key } : {};
}

/** True when a Stripe subscription was sold under a premiere price lock. */
export const isPriceLocked = (metadata: Record<string, string> | null | undefined) =>
  typeof metadata?.grovbase_price_lock === "string" && metadata.grovbase_price_lock.length > 0;

/* ── annual ────────────────────────────────────────────────────────────────*/

export const annualOnSale = (offer: PricingOffer = PRICING_OFFER) => offer.annual.enabled;

/* ── top-ups ───────────────────────────────────────────────────────────────*/

export type TopupSource = "approved_plan" | "approved" | "ladder";
export type TopupRefusal = "not_offered" | "unpriced";
export type TopupPrice =
  | { ok: true; credits: number; amountCents: number; source: TopupSource }
  | { ok: false; reason: TopupRefusal };

/** Margin of `amountCents` for `credits` after provider and payment cost. */
export function topupMarginPercent(
  credits: number, amountCents: number, costs: PricingOffer["topups"]["costs"],
): number | null {
  const { providerCentsPerCredit: unit, paymentFeePercent: pct, paymentFeeFixedCents: fixed } = costs;
  if (unit === null || pct === null || fixed === null || amountCents <= 0) return null;
  const net = amountCents - (amountCents * pct) / 100 - fixed;
  return ((net - credits * unit) / amountCents) * 100;
}

/**
 * Whether an APPROVED price may be sold: its margin after provider and payment
 * cost is at least the minimum, and (if the policy is set) a credit is not
 * cheaper than the buyer's own plan credit. Any missing input refuses.
 */
export function approvedPriceValid(
  credits: number, amountCents: number, planCentsPerCredit: number | null,
  offer: PricingOffer = PRICING_OFFER,
): boolean {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return false;
  const { costs, minUnitVsPlan } = offer.topups;
  const margin = topupMarginPercent(credits, amountCents, costs);
  if (margin === null || costs.minMarginPercent === null || margin < costs.minMarginPercent) return false;
  if (minUnitVsPlan !== null) {
    if (planCentsPerCredit === null) return false;
    if (amountCents / credits < planCentsPerCredit * minUnitVsPlan) return false;
  }
  return true;
}

/** The amounts a custom top-up may name: the tiers, plus the pack slots no
 *  pack row covers (a slot WITH a row is sold as that pack). */
export function offeredCustomAmounts(packs: Pick<PackRow, "credits">[]): number[] {
  const rowed = new Set(packs.map((p) => p.credits));
  return [...TOPUP_TIERS, ...PACK_SLOTS.filter((s) => !rowed.has(s))];
}

/**
 * THE PRICE OF A CUSTOM TOP-UP — one function for the page and the till.
 *
 * The /plany page renders its tier and pack prices by calling this, and
 * `priceOrder` charges by calling this, with the same rows. So the figure on
 * the card, the server quote and the Stripe amount are one computation.
 *
 *   1. the amount must be offered (a tier, or a pack slot without a row);
 *   2. an approved per-plan price, then an approved price, if valid;
 *   3. otherwise the existing ladder rule, inside its range only;
 *   4. otherwise unpriced — shown as "soon", never sold.
 */
export function priceTopup(
  requested: unknown,
  input: {
    packs: PackRow[];
    planSlug: string | null;
    planCentsPerCredit: number | null;
    offer?: PricingOffer;
  },
): TopupPrice {
  const offer = input.offer ?? PRICING_OFFER;
  if (typeof requested !== "number" || !Number.isSafeInteger(requested) || requested <= 0) {
    return { ok: false, reason: "not_offered" };
  }
  if (!offeredCustomAmounts(input.packs).includes(requested)) return { ok: false, reason: "not_offered" };

  const perPlan = offer.topups.perPlanCents && input.planSlug
    ? offer.topups.perPlanCents[input.planSlug as PaidPlanSlug]?.[requested]
    : undefined;
  if (typeof perPlan === "number") {
    return approvedPriceValid(requested, perPlan, input.planCentsPerCredit, offer)
      ? { ok: true, credits: requested, amountCents: perPlan, source: "approved_plan" }
      : { ok: false, reason: "unpriced" };
  }
  const approved = offer.topups.approvedCents?.[requested];
  if (typeof approved === "number") {
    return approvedPriceValid(requested, approved, input.planCentsPerCredit, offer)
      ? { ok: true, credits: requested, amountCents: approved, source: "approved" }
      : { ok: false, reason: "unpriced" };
  }
  if (!offer.topups.existingLadder) return { ok: false, reason: "unpriced" };
  const q = validateCustomCredits(requested, creditLadder(input.packs));
  return q.ok
    ? { ok: true, credits: q.credits, amountCents: q.amountCents, source: "ladder" }
    : { ok: false, reason: "unpriced" };
}
