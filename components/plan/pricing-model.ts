/**
 * THE CENNIK'S ARITHMETIC — pure, server-safe, and tested without a browser.
 *
 * Every number the pricing page shows is produced here from database rows, by
 * the SAME functions the checkout charges with:
 *
 *   · a plan's monthly figure is `price_cents`; its annual figure is the
 *     stored `annual_price_cents` through lib/plans/pricing.ts — never a
 *     coefficient typed into the markup;
 *   · a pack's figure is its `price_cents`;
 *   · a custom amount is `priceForCredits()` from lib/plans/credit-price.ts —
 *     the function `validateCustomCredits()` prices the Stripe line item with.
 *
 * Nothing here decides a price. It formats, compares and links. The links are
 * INTENTS (a plan id, a pack id, a number of credits) and are byte-for-byte the
 * ones the page has always sent to /checkout — scripts/plan-page-tests.ts holds
 * them to that.
 */
import { annualMonthlyCents } from "@/lib/plans/pricing";
import {
  creditLadder, customCreditsRange, priceForCredits,
  type LadderStep,
} from "@/lib/plans/credit-price";

export type BillingPeriod = "monthly" | "annual";

/* ── checkout intents (unchanged contract) ─────────────────────────────────*/

/** A plan purchase — the plan row's id and the billing period. */
export const planCheckoutHref = (planId: string, period: BillingPeriod) =>
  `/checkout?kind=subscription&plan=${planId}&period=${period}`;

/** A credit pack purchase — the pack row's id. */
export const packCheckoutHref = (packId: string) => `/checkout?kind=package&pack=${packId}`;

/** A custom top-up — a whole number of credits; the server prices it. */
export const creditsCheckoutHref = (credits: number) => `/checkout?kind=credits&n=${credits}`;

/* ── formatting: Polish, always ────────────────────────────────────────────*/

/**
 * The cennik sells in PLN to a Polish market, so its figures are written the
 * Polish way in every UI language: "1 200", "0,19 zł", "299 zł".
 *
 * `useGrouping: "always"` matters: pl-PL's own default leaves four-digit
 * numbers ungrouped ("1200"), and the brief — like every Polish price list —
 * writes "1 200".
 */
export const PRICE_LOCALE = "pl-PL";

const groupingAlways = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;

export function formatCount(value: number): string {
  return new Intl.NumberFormat(PRICE_LOCALE, { ...groupingAlways, maximumFractionDigits: 0 }).format(value);
}

/**
 * THE PRICE SHOWN MUST BE THE PRICE CHARGED, TO THE GROSZ. Whole amounts drop
 * the ",00" tail; an amount with grosze shows them. `fraction: 2` forces two
 * decimals — the per-credit figures ("0,19 zł").
 */
export function formatMoney(cents: number, currency: string, fraction?: 2): string {
  const digits = fraction ?? (cents % 100 === 0 ? 0 : 2);
  return new Intl.NumberFormat(PRICE_LOCALE, {
    ...groupingAlways,
    style: "currency", currency,
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(cents / 100);
}

/** A per-credit figure in minor units, written with two decimals. */
export const formatPerCredit = (centsPerCredit: number, currency: string) =>
  formatMoney(Math.round(centsPerCredit * 100) / 100, currency, 2);

/* ── plans ─────────────────────────────────────────────────────────────────*/

export type PlanMoney = {
  priceCents: number;
  annualPriceCents: number;
  monthlyCredits: number;
  bonusCredits: number;
};

/** Paid = has a monthly price. The free tier is the ABSENCE of a subscription. */
export const isPaidPlan = (p: { priceCents: number }) => p.priceCents > 0;

/** What one month costs on the chosen period — from stored figures only. */
export function planMonthlyCents(p: PlanMoney, period: BillingPeriod): number {
  return period === "annual" ? annualMonthlyCents(p) : p.priceCents;
}

/** Credits a month on this plan, bonus included — what the customer receives. */
export const planCredits = (p: PlanMoney) => p.monthlyCredits + p.bonusCredits;

/** Minor units per credit on this plan and period, or null when undefined. */
export function planPerCreditCents(p: PlanMoney, period: BillingPeriod): number | null {
  const credits = planCredits(p);
  const cents = planMonthlyCents(p, period);
  return credits > 0 && cents > 0 ? cents / credits : null;
}

/**
 * What a year on the annual price saves against twelve monthly payments —
 * from the two STORED prices. Null when the plan has no annual price, so the
 * caller renders nothing rather than "Oszczędzasz 0 zł".
 */
export function annualSavingCents(p: PlanMoney): number | null {
  if (p.annualPriceCents <= 0) return null;
  const saving = p.priceCents * 12 - p.annualPriceCents;
  return saving > 0 ? saving : null;
}

/**
 * "4× więcej kredytów niż Starter" — division of two stored credit amounts.
 * Null unless the multiple is meaningful (at least 1,5×), so a near-equal pair
 * is never dressed up as a benefit. Rounded to one decimal, trailing ",0"
 * dropped by the formatter.
 */
export function creditMultiple(plan: PlanMoney, reference: PlanMoney | undefined): number | null {
  if (!reference) return null;
  const base = planCredits(reference);
  if (base <= 0) return null;
  const ratio = planCredits(plan) / base;
  return ratio >= 1.5 ? Math.round(ratio * 10) / 10 : null;
}

export function formatMultiple(value: number): string {
  return new Intl.NumberFormat(PRICE_LOCALE, { maximumFractionDigits: 1 }).format(value);
}

/**
 * Which period the page opens on. The brief asks for "annual" by default; that
 * default applies ONLY when every paid plan has a real annual price — anything
 * else would open the page on prices nobody set.
 */
export function initialBillingPeriod(preferred: BillingPeriod, annualAvailable: boolean): BillingPeriod {
  return preferred === "annual" && annualAvailable ? "annual" : "monthly";
}

/* ── seats, in Polish plural ───────────────────────────────────────────────*/

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * "2 osób" is wrong: 1 → osoba, 2-4 → osoby, 5+ → osób, minus 12-14.
 * `-1` is the stored "no limit".
 */
export function seatLabel(seats: number, t: T): string {
  if (seats < 0) return t("plans.unlimited");
  if (seats === 1) return t("plans.seatsOne");
  const last = seats % 10;
  const teen = seats % 100 >= 12 && seats % 100 <= 14;
  return last >= 2 && last <= 4 && !teen
    ? t("plans.seatsFew", { n: formatCount(seats) })
    : t("plans.seats", { n: formatCount(seats) });
}

/* ── credit packs and the custom amount ────────────────────────────────────*/

export type PackMoney = {
  credits: number;
  bonusCredits: number;
  priceCents: number;
};

/** The rate card the checkout charges against — the real pack ladder. */
export function packLadder(packs: PackMoney[]): LadderStep[] {
  return creditLadder(packs.map((p) => ({
    credits: p.credits, bonus_credits: p.bonusCredits, price_cents: p.priceCents,
  })));
}

/**
 * The REFERENCE RATE every "−N%" and every struck-through figure on the page
 * is measured against: what one credit costs in the SMALLEST pack. GrovBase
 * stores no former price, so this is not "was / now" — it is "the same credits
 * bought at the entry rate", a price the customer can actually pay today, and
 * the page says so under the list.
 */
export function referenceRate(ladder: LadderStep[]): number {
  const smallest = ladder[0];
  return smallest ? smallest.cents / smallest.credits : 0;
}

export type Quote = {
  credits: number;
  cents: number;
  /** Minor units per credit. */
  perCredit: number;
  /** Whole-percent saving against the reference rate; 0 when none. */
  offPct: number;
  /** The same credits at the reference rate, when that is dearer; else null. */
  referenceCents: number | null;
};

/** A quote for `credits` at `cents` — the shared shape for packs and custom. */
export function quoteFor(credits: number, cents: number, rate: number): Quote {
  const perCredit = credits > 0 ? cents / credits : 0;
  const offPct = rate > 0 && perCredit > 0 ? Math.max(0, Math.round((1 - perCredit / rate) * 100)) : 0;
  const reference = rate > 0 ? Math.round(credits * rate) : 0;
  return { credits, cents, perCredit, offPct, referenceCents: reference > cents ? reference : null };
}

/** A fixed pack, quoted on what it delivers (credits + bonus) at its price. */
export function packQuote(p: PackMoney, rate: number): Quote {
  return quoteFor(p.credits + p.bonusCredits, p.priceCents, rate);
}

/**
 * A custom amount, priced by `priceForCredits` — the function the server's
 * `validateCustomCredits` charges with. This is the parity the whole page
 * rests on: whatever this returns is what Stripe is asked for.
 */
export function customQuote(credits: number, ladder: LadderStep[]): Quote {
  return quoteFor(credits, priceForCredits(credits, ladder), referenceRate(ladder));
}

/** The slider's range — the server's range, so nothing outside it is offered. */
export const customRange = customCreditsRange;

/**
 * A typed amount, made into one the server accepts: a whole number inside the
 * range. Anything that is not a number falls back to `fallback`.
 */
export function clampCredits(value: number, range: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * THE NEXT REAL STEP UP. The rate card's points are the packs, so the next
 * point above the chosen amount is a price the checkout really charges — and
 * the hint "Dodaj jeszcze N kredytów, aby uzyskać −X%" is computed from it,
 * not from a tier table typed into a component. Null at the top of the card.
 */
export function nextStepHint(credits: number, ladder: LadderStep[]): { add: number; offPct: number; at: number } | null {
  const rate = referenceRate(ladder);
  const current = customQuote(credits, ladder).offPct;
  for (const step of ladder) {
    if (step.credits <= credits) continue;
    const off = quoteFor(step.credits, priceForCredits(step.credits, ladder), rate).offPct;
    if (off > current) return { add: step.credits - credits, offPct: off, at: step.credits };
  }
  return null;
}

/** Where each rate-card point sits on the slider track, 0–100, with its saving. */
export function sliderMarks(ladder: LadderStep[]): { at: number; pct: number; offPct: number }[] {
  const range = customCreditsRange(ladder);
  if (!range) return [];
  const rate = referenceRate(ladder);
  return ladder.map((s) => ({
    at: s.credits,
    pct: ((s.credits - range.min) / (range.max - range.min)) * 100,
    offPct: quoteFor(s.credits, priceForCredits(s.credits, ladder), rate).offPct,
  }));
}

/**
 * The coin stack's height for each pack: 1 coin for the smallest, `max` for the
 * largest, spread evenly in between — "the bigger the pack, the taller the
 * stack", whatever number of packs the admin keeps.
 */
export function coinLevel(rankAscending: number, count: number, max = 5): number {
  if (count <= 1) return 1;
  return 1 + Math.round((rankAscending * (max - 1)) / (count - 1));
}
