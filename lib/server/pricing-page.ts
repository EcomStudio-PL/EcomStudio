import "server-only";
import type { Client } from "@/lib/services/workspace";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { parsePlanCapabilities } from "@/lib/plans/capabilities";
import { annualSavingPct } from "@/lib/plans/pricing";
import { paymentsEnabled } from "@/lib/stripe/config";
import { sellable } from "@/lib/server/stripe-pricing";
import { requireActivePaidPlan, topupPlanContext, type TopupGate } from "@/lib/server/billing";
import {
  PACK_SLOTS, PRICING_OFFER, TOPUP_TIERS, annualOnSale, premiereExpiredFor, premiereState, priceTopup,
  type PricingOffer,
} from "@/lib/server/pricing-offer";
import { creditsCheckoutHref, packCheckoutHref } from "@/components/plan/pricing-model";
import { PRICING_PAGE } from "@/components/plan/pricing-config";
import type {
  PricingPackView, PricingPageData, PricingPlanView, PricingTierView, PricingViewer,
} from "@/components/plan/pricing-types";

/** The statuses that make a second subscription a double charge — the same
 *  set `beginSubscription` refuses on. */
const LIVE_STATUSES = ["active", "trialing", "past_due"];

const PLAN_COLUMNS = "id, slug, name, description, price_cents, annual_price_cents, currency, monthly_credits, bonus_credits, featured, features, stripe_price_id_monthly, stripe_price_id_annual, stripe_price_monthly_cents, stripe_price_annual_cents, stripe_sync_status";
const PACK_COLUMNS = "id, credits, bonus_credits, price_cents, currency, stripe_price_id, stripe_price_cents, stripe_sync_status";

export type PlanRow = {
  id: string; slug: string; name: string; description: string | null;
  price_cents: number; annual_price_cents: number | null; currency: string;
  monthly_credits: number; bonus_credits: number; featured: boolean; features: unknown;
  stripe_price_id_monthly: string | null; stripe_price_id_annual: string | null;
  stripe_price_monthly_cents: number | null; stripe_price_annual_cents: number | null;
  stripe_sync_status: string | null;
};
export type PackRowFull = {
  id: string; credits: number; bonus_credits: number; price_cents: number; currency: string;
  stripe_price_id: string | null; stripe_price_cents: number | null; stripe_sync_status: string | null;
};

/** What the page knows about the person looking — nothing for a visitor. */
export type ViewerFacts = {
  signedIn: boolean;
  /** The workspace's live subscription (active / trialing / past_due), if any. */
  live: { plan_id: string; status: string } | null;
  /** requireActivePaidPlan's answer; null for a visitor. */
  gate: TopupGate | null;
  /** The buyer's plan for per-plan top-up prices (topupPlanContext). */
  plan: { slug: string | null; centsPerCredit: number | null };
  /** The reference model's per-size credit price; null when unreadable. */
  cost: { display_name: string | null; pricing: unknown } | null;
};

/**
 * EVERYTHING THE PRICING PAGE SHOWS, read once, priced by the till's own rules.
 *
 * One loader for /plany (public) and /plan (in the app), so the two can never
 * quote different numbers. What a visitor costs: the active plans and packs
 * (both public under RLS). What a customer adds: their workspace's live
 * subscription, the top-up decision and one model price — and nothing about
 * them reaches the page beyond what the cards need to say.
 */
export async function loadPricingPage(supabase: Client): Promise<PricingPageData> {
  const now = Date.now();
  const { data: { user } } = await supabase.auth.getUser();
  const workspace = user ? await getCurrentWorkspace(supabase, user.id) : null;

  const [{ data: planRows }, { data: packRows }, liveSub, gate, costRow] = await Promise.all([
    supabase.from("subscription_plans").select(PLAN_COLUMNS).eq("active", true).order("sort_order"),
    supabase.from("credit_packages").select(PACK_COLUMNS).eq("active", true).order("sort_order"),
    workspace
      ? supabase.from("subscriptions").select("plan_id, status")
        .eq("workspace_id", workspace.id).in("status", LIVE_STATUSES).limit(1)
      : Promise.resolve({ data: null }),
    workspace ? requireActivePaidPlan(supabase, workspace, now) : Promise.resolve(null),
    // ai_models is readable only with a session; a visitor's card simply
    // omits the "≈ N images" lines rather than guessing them.
    user
      ? supabase.from("ai_models").select("display_name, pricing")
        .eq("model_identifier", PRICING_PAGE.costReferenceModel).eq("active", true).limit(1)
      : Promise.resolve({ data: null }),
  ]);
  const plan = gate?.ok ? await topupPlanContext(supabase, gate.planId) : { slug: null, centsPerCredit: null };

  return buildPricingPage({
    plans: (planRows ?? []) as PlanRow[],
    packs: (packRows ?? []) as PackRowFull[],
    viewer: {
      signedIn: Boolean(user),
      live: ((liveSub.data ?? [])[0] as ViewerFacts["live"]) ?? null,
      gate,
      plan,
      cost: ((costRow.data ?? [])[0] as ViewerFacts["cost"]) ?? null,
    },
    now,
    payments: paymentsEnabled(),
  });
}

/**
 * "31.10.2026, 23:59" — the deadline as written in the offer, which is
 * Warsaw time by contract (its offset says so). Read off the string rather
 * than formatted by an ICU build, so the server and the browser can never
 * render it differently.
 */
function warsawLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}` : iso;
}

/**
 * The page, from rows. Pure: no reads, no clock of its own — so a test can
 * feed it the production catalogue and compare every figure with what
 * `quoteCheckout` charges for the same order.
 */
export function buildPricingPage(input: {
  plans: PlanRow[];
  packs: PackRowFull[];
  viewer: ViewerFacts;
  now: number;
  payments: boolean;
  offer?: PricingOffer;
}): PricingPageData {
  const { now, payments, viewer: facts } = input;
  const offer = input.offer ?? PRICING_OFFER;

  const plans: PricingPlanView[] = input.plans.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.price_cents,
    annualPriceCents: p.annual_price_cents ?? 0,
    currency: p.currency,
    monthlyCredits: p.monthly_credits,
    bonusCredits: p.bonus_credits,
    featured: p.featured,
    capabilities: parsePlanCapabilities(p.features),
    // Exactly the conditions priceOrder checks, decided here so a button is
    // never offered that the checkout would refuse.
    payable: {
      monthly: payments && p.price_cents > 0 && Boolean(p.stripe_price_id_monthly)
        && sellable(p, "monthly") && !premiereExpiredFor(p.slug, p.price_cents, now, offer),
      annual: payments && annualOnSale(offer) && p.price_cents > 0 && (p.annual_price_cents ?? 0) > 0
        && Boolean(p.stripe_price_id_annual) && sellable(p, "annual"),
    },
  }));
  const paid = plans.filter((p) => p.priceCents > 0);
  const freeRow = plans.find((p) => p.priceCents <= 0) ?? null;

  /* ── who is looking ─────────────────────────────────────────────────── */

  const viewer: PricingViewer = {
    signedIn: facts.signedIn,
    currentSlug: facts.live ? plans.find((p) => p.id === facts.live?.plan_id)?.slug ?? null : null,
    hasLiveSubscription: Boolean(facts.live),
    topups: !facts.signedIn || !facts.gate ? "anonymous"
      : facts.gate.ok ? "allowed"
      : facts.gate.reason === "plan_check_failed" ? "check_failed"
      : "no_plan",
  };

  /* ── top-ups, priced by the till's own function ─────────────────────── */

  const rows = input.packs;
  const currency = (rows[0]?.currency ?? paid[0]?.currency ?? "PLN").toUpperCase();
  // The same precondition priceOrder applies to every custom amount: the rate
  // card must be made of packs that proved they match Stripe.
  const ladderSellable = rows.length > 0 && rows.every((r) => sellable(r));
  const custom = (credits: number) => (ladderSellable
    ? priceTopup(credits, {
      packs: rows, planSlug: facts.plan.slug, planCentsPerCredit: facts.plan.centsPerCredit, offer,
    })
    : null);

  const bySize = [...PACK_SLOTS].sort((a, b) => a - b);
  const packs: PricingPackView[] = PACK_SLOTS.map((slot) => {
    const row = rows.find((r) => r.credits === slot);
    const level = bySize.indexOf(slot) + 1;
    if (row) {
      const ok = sellable(row) && Boolean(row.stripe_price_id);
      return {
        slot, bonusCredits: row.bonus_credits, level, best: false, savePct: null,
        amountCents: ok ? row.price_cents : null,
        href: ok && payments ? packCheckoutHref(row.id) : null,
        perCreditCents: ok ? row.price_cents / (slot + row.bonus_credits) : null,
      };
    }
    const q = custom(slot);
    const amount = q?.ok ? q.amountCents : null;
    return {
      slot, bonusCredits: 0, level, best: false, savePct: null,
      amountCents: amount,
      href: amount !== null && payments ? creditsCheckoutHref(slot) : null,
      perCreditCents: amount !== null ? amount / slot : null,
    };
  });

  // SAVINGS ARE A COMPARISON OF TWO REAL PRICES: this card's price per credit
  // against the smallest pack's. No "regular price" exists to strike through,
  // so none is shown — only this, labelled as what it is.
  const reference = packs.find((p) => p.slot === Math.min(...PACK_SLOTS))?.perCreditCents ?? null;
  const pct = (unit: number | null) => (reference && unit !== null && unit < reference
    ? Math.round((1 - unit / reference) * 100) : null);
  for (const p of packs) p.savePct = pct(p.perCreditCents);
  const priced = packs.filter((p) => p.perCreditCents !== null);
  if (priced.length > 1) {
    const min = Math.min(...priced.map((p) => p.perCreditCents as number));
    const best = priced.filter((p) => p.perCreditCents === min);
    if (best.length === 1) best[0].best = true;
  }

  const tiers: PricingTierView[] = TOPUP_TIERS.map((credits) => {
    const q = custom(credits);
    const amount = q?.ok ? q.amountCents : null;
    const unit = amount !== null ? amount / credits : null;
    return {
      credits,
      amountCents: amount,
      perCreditCents: unit,
      savePct: pct(unit),
      href: amount !== null && payments ? creditsCheckoutHref(credits) : null,
    };
  });

  /* ── offer state, decided on server time ────────────────────────────── */

  const premiere = premiereState(now, offer);
  const annualReady = paid.length > 0 && paid.every((p) => p.payable.annual);
  const pricing = facts.cost?.pricing && typeof facts.cost.pricing === "object"
    ? facts.cost.pricing as Record<string, unknown> : null;
  const credit = (k: string) => (typeof pricing?.[k] === "number" && (pricing[k] as number) > 0 ? pricing[k] as number : null);

  return {
    viewer,
    paymentsEnabled: payments,
    plans: paid,
    free: freeRow ? { name: freeRow.name } : null,
    annual: {
      onSale: annualReady,
      savingPct: annualReady
        ? annualSavingPct(paid.map((p) => ({ priceCents: p.priceCents, annualPriceCents: p.annualPriceCents })))
        : 0,
    },
    premiere: premiere.status === "active"
      ? { endsAt: premiere.endsAt, endsAtMs: premiere.endsAtMs, serverNow: now, endsAtLabel: warsawLabel(premiere.endsAt) }
      : null,
    packs,
    tiers,
    currency,
    imageCost: facts.cost && (credit("2K") !== null || credit("4K") !== null)
      ? { model: facts.cost.display_name ?? PRICING_PAGE.costReferenceModel, k2: credit("2K"), k4: credit("4K") }
      : null,
  };
}
