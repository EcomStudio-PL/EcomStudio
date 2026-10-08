import type { PlanCapabilities } from "@/lib/plans/capabilities";

/**
 * WHAT THE PRICING PAGE IS GIVEN — computed on the server, displayed here.
 *
 * Every amount below was produced by the same functions the checkout charges
 * with (`priceTopup`, the catalogue rows, `sellable`). The browser formats
 * these numbers; it never derives a price from another price. A `null` amount
 * means "not on sale" and renders as such — never as a guess.
 */

export type PricingPlanView = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  annualPriceCents: number;
  currency: string;
  monthlyCredits: number;
  bonusCredits: number;
  featured: boolean;
  capabilities: PlanCapabilities;
  /** Whether the checkout would sell this plan for the period right now. */
  payable: { monthly: boolean; annual: boolean };
};

export type PricingPackView = {
  /** The card's credit amount (base, without a bonus). */
  slot: number;
  bonusCredits: number;
  /** null: no approved price — shown as "soon", never sold. */
  amountCents: number | null;
  /** The checkout intent for this card, or null when it cannot be bought. */
  href: string | null;
  /** Price per credit received (bonus included), minor units. */
  perCreditCents: number | null;
  /** Real saving per credit against the smallest pack, whole percent. */
  savePct: number | null;
  best: boolean;
  /** Coin stack height, 1–5, by size. */
  level: number;
};

export type PricingTierView = {
  credits: number;
  amountCents: number | null;
  perCreditCents: number | null;
  savePct: number | null;
  href: string | null;
};

/**
 * Who is looking, as far as the page may know. An anonymous visitor gets
 * `signedIn: false` and nothing else — no plan, no balance, no workspace.
 */
export type PricingViewer = {
  signedIn: boolean;
  /** Slug of the live subscription's plan, when it is readable. */
  currentSlug: string | null;
  /** A live subscription (active / trialing / past_due) blocks a second one. */
  hasLiveSubscription: boolean;
  /** The server's top-up decision for this workspace. */
  topups: "allowed" | "anonymous" | "no_plan" | "plan_inactive" | "check_failed";
};

export type PricingPageData = {
  viewer: PricingViewer;
  paymentsEnabled: boolean;
  plans: PricingPlanView[];
  /** The free tier, as the small note under the cards. */
  free: { name: string } | null;
  annual: { onSale: boolean; savingPct: number };
  /** Present only while the premiere runs; times are SERVER times. */
  premiere: { endsAt: string; endsAtMs: number; serverNow: number; endsAtLabel: string } | null;
  packs: PricingPackView[];
  tiers: PricingTierView[];
  currency: string;
  /**
   * The per-image price the plan cards' "≈ N images" figures are computed
   * from, read from ai_models — only for a signed-in viewer, because that
   * table is not readable anonymously. null: the figures are omitted.
   */
  imageCost: { model: string; k2: number | null; k4: number | null } | null;
};
