/**
 * CENNIK — PRESENTATION CONFIG. One typed file for everything the pricing page
 * decides about LOOKS and WORDS, and nothing it decides about MONEY.
 *
 * WHAT LIVES HERE: which plan is drawn how (icon, accent, the one-line "for
 * whom"), the order of the feature rows, the service-level copy the business
 * offers per plan (support, commercial use), the billing period the page
 * prefers, and the coin-stack scale.
 *
 * WHAT NEVER LIVES HERE: a price, a credit amount, a seat count, a discount,
 * a pack, a Stripe id. Those are `subscription_plans` / `credit_packages` rows
 * — edited in /admin/plans and /admin/credits, synced to Stripe, and charged by
 * lib/server/checkout.ts. Copying any of them into this file would create a
 * second source of truth that the checkout does not read, which is exactly how
 * a page ends up quoting one price and charging another.
 *
 * Plans are keyed by their STABLE INTERNAL SLUG. `agency` stays `agency` in
 * the database, in Stripe and in the webhook; "Business" is only the label a
 * customer reads (`nameKey`). A slug this file does not know falls back to
 * `FALLBACK_PLAN` and its own database name, so a plan added in the admin still
 * renders — it simply has no bespoke styling yet.
 */
import { Crown, Gem, Rocket, ShieldCheck, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BillingPeriod } from "./pricing-model";

/** The accent family a plan card is drawn in. Each maps to design tokens. */
export type PlanTone = "starter" | "pro" | "business" | "neutral";

export type PlanPresentation = {
  /** i18n key for the display name. Absent → the database `name`. */
  nameKey?: string;
  /** i18n key for the one-line audience under the name. */
  taglineKey: string;
  /** i18n key for the closing "who is this for" box. */
  noteKey: string;
  icon: LucideIcon;
  /** The small icon in the closing box. */
  noteIcon: LucideIcon;
  tone: PlanTone;
};

export const PLAN_PRESENTATION: Readonly<Record<string, PlanPresentation>> = {
  starter: {
    taglineKey: "plans.tagline.starter",
    noteKey: "plans.paidNote",
    icon: Zap,
    noteIcon: Rocket,
    tone: "starter",
  },
  pro: {
    taglineKey: "plans.tagline.pro",
    noteKey: "plans.topNote",
    icon: Sparkles,
    // The brief: PRO's closing box carries a warm accent — the crown.
    noteIcon: Crown,
    tone: "pro",
  },
  agency: {
    // DISPLAY ONLY. The plan is `agency` everywhere money moves.
    nameKey: "plans.tier.business",
    taglineKey: "plans.tagline.business",
    noteKey: "plans.maxNote",
    icon: Gem,
    noteIcon: ShieldCheck,
    tone: "business",
  },
};

export const FALLBACK_PLAN: PlanPresentation = {
  taglineKey: "plans.tagline.default",
  noteKey: "plans.paidNote",
  icon: Sparkles,
  noteIcon: Rocket,
  tone: "neutral",
};

export const planPresentation = (slug: string): PlanPresentation =>
  PLAN_PRESENTATION[slug] ?? FALLBACK_PLAN;

/**
 * SERVICE LEVELS — what the business promises per plan, as words, because the
 * database has no column for them. Support and commercial use are offer terms,
 * not software capabilities; they are listed here so they can be changed in
 * one place, and they are never used to compute a price or a limit.
 *
 *   support: i18n key of the support level shown in the comparison table.
 *   commercialUse: whether generated content may be used commercially.
 */
export type ServiceLevel = { supportKey: string; commercialUse: boolean };

export const SERVICE_LEVELS: Readonly<Record<string, ServiceLevel>> = {
  starter: { supportKey: "plans.support.standard", commercialUse: true },
  pro: { supportKey: "plans.support.standard", commercialUse: true },
  agency: { supportKey: "plans.support.dedicated", commercialUse: true },
};

export const serviceLevel = (slug: string): ServiceLevel | null => SERVICE_LEVELS[slug] ?? null;

/**
 * CAPABILITIES THAT ARE SOLD BUT NOT YET RUNNING. The plan rows carry them
 * ({workspace_members, priority_queue, operator_mode}) and the admin edits
 * them, but no code consumes them yet: there is no member invitation, no
 * plan-aware queue and no operator mode. Until there is, the page shows the
 * plan's value with a "Wkrótce" mark instead of a ✓ — the same honesty the
 * video row already has. Remove a key from this list the day its feature
 * ships; the ✓ comes back from the data on its own.
 */
export const COMING_SOON_CAPABILITIES: readonly string[] = ["workspace_members", "priority_queue", "operator_mode"];

export const isComingSoon = (capability: string) => COMING_SOON_CAPABILITIES.includes(capability);

/** Page-level presentation switches. */
export const PRICING_PAGE = {
  /**
   * The period the page OPENS on. The brief prefers "annual"; it is applied
   * only when every paid plan has a real stored annual price AND a Stripe
   * annual Price (pricing-model.ts `annualOnOffer`) — otherwise the page opens
   * on monthly, because an annual default with no annual price would quote a
   * figure nobody set. Set to "monthly" to stop defaulting to annual even once
   * annual prices exist.
   */
  defaultBillingPeriod: "annual" as BillingPeriod,
  /**
   * The plan PRO's "N× więcej kredytów niż …" line is measured against. The
   * multiple itself is division of the two stored credit amounts.
   */
  benefitReferenceSlug: "starter",
  /** Tallest coin stack, for the largest pack. */
  coinStackMax: 5,
} as const;
