/**
 * CENNIK — PRESENTATION CONFIG. One typed file for everything the pricing page
 * decides about LOOKS and WORDS, and nothing it decides about MONEY.
 *
 * WHAT LIVES HERE: which plan is drawn how (theme, icon, badge, the one-line
 * "for whom"), the feature groups on the cards and their order, the comparison
 * table's rows, the FAQ, the service-level copy per plan, and page switches.
 *
 * WHAT NEVER LIVES HERE: a price, a credit amount, a seat count, a discount,
 * a pack, a promo date, a Stripe id. Plans and packs are `subscription_plans` /
 * `credit_packages` rows — edited in /admin, synced to Stripe, charged by
 * lib/server/checkout.ts. What is on OFFER (periods, top-up amounts, approved
 * prices, the premiere deadline) is lib/server/pricing-offer.ts, server-only.
 * Copying any of them into this file would create a second source of truth
 * that the checkout does not read — how a page ends up quoting one price and
 * charging another.
 *
 * Plans are keyed by their STABLE INTERNAL SLUG. `agency` stays `agency` in
 * the database, in Stripe and in the webhook; "Business" is only the label a
 * customer reads (`nameKey`). A slug this file does not know falls back to
 * `FALLBACK_PLAN` and its own database name, so a plan added in the admin still
 * renders — it simply has no bespoke styling yet.
 */
import { Gem, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BillingPeriod } from "./pricing-model";

/** The colour family a plan card is drawn in. Each maps to a card theme. */
export type PlanTone = "starter" | "pro" | "business" | "neutral";

export type PlanPresentation = {
  /** i18n key for the display name. Absent → the database `name`. */
  nameKey?: string;
  /** i18n key for the one-line audience under the name. */
  taglineKey: string;
  /** i18n key for the badge above the name. */
  badgeKey: string;
  icon: LucideIcon;
  tone: PlanTone;
  /** Highlight keys for the card's first group, in order (see FEATURES). */
  highlights: readonly FeatureKey[];
};

export const PLAN_PRESENTATION: Readonly<Record<string, PlanPresentation>> = {
  starter: {
    taglineKey: "pricing.plan.audience.starter",
    badgeKey: "pricing.plan.badge.starter",
    icon: Zap,
    tone: "starter",
    highlights: ["noExpiry", "topups", "allTools"],
  },
  pro: {
    taglineKey: "pricing.plan.audience.pro",
    badgeKey: "pricing.plan.badge.pro",
    icon: Sparkles,
    tone: "pro",
    highlights: ["noExpiry", "topups", "allTools", "priority"],
  },
  agency: {
    // DISPLAY ONLY. The plan is `agency` everywhere money moves.
    nameKey: "plans.tier.business",
    taglineKey: "pricing.plan.audience.business",
    badgeKey: "pricing.plan.badge.business",
    icon: Gem,
    tone: "business",
    highlights: ["noExpiry", "topups", "supportDedicated", "operator"],
  },
};

export const FALLBACK_PLAN: PlanPresentation = {
  taglineKey: "pricing.plan.audience.default",
  badgeKey: "pricing.plan.badge.default",
  icon: Sparkles,
  tone: "neutral",
  highlights: ["noExpiry", "topups"],
};

export const planPresentation = (slug: string): PlanPresentation =>
  PLAN_PRESENTATION[slug] ?? FALLBACK_PLAN;

/** The order the cards are drawn in on wide screens, and on phones (PRO first). */
export const CARD_ORDER: readonly string[] = ["starter", "pro", "agency"];
export const CARD_ORDER_PHONE: readonly string[] = ["pro", "starter", "agency"];

/**
 * SERVICE LEVELS — what the business promises per plan, as words, because the
 * database has no column for them. Support and commercial use are offer terms,
 * not software capabilities; they are listed here so they can be changed in
 * one place, and they are never used to compute a price or a limit.
 */
export type ServiceLevel = { supportKey: string; commercialUse: boolean; dedicatedSupport: boolean };

export const SERVICE_LEVELS: Readonly<Record<string, ServiceLevel>> = {
  starter: { supportKey: "plans.support.standard", commercialUse: true, dedicatedSupport: false },
  pro: { supportKey: "plans.support.standard", commercialUse: true, dedicatedSupport: false },
  agency: { supportKey: "plans.support.dedicated", commercialUse: true, dedicatedSupport: true },
};

export const serviceLevel = (slug: string): ServiceLevel | null => SERVICE_LEVELS[slug] ?? null;

/**
 * CAPABILITIES THAT ARE SOLD BUT NOT YET RUNNING. The plan rows carry them
 * ({workspace_members, priority_queue, operator_mode}) and the admin edits
 * them, but no code consumes them yet: there is no member invitation, no
 * plan-aware queue and no operator mode. Until there is, the page shows them
 * with a "Wkrótce" mark instead of a ✓. Remove a key from this list the day
 * its feature ships; the ✓ comes back from the data on its own.
 */
export const COMING_SOON_CAPABILITIES: readonly string[] = ["workspace_members", "priority_queue", "operator_mode"];

export const isComingSoon = (capability: string) => COMING_SOON_CAPABILITIES.includes(capability);

/* ── features: one truth table for the cards and the comparison ──────────*/

/**
 * How a feature stands on a plan:
 *   "yes"   available today, on this plan;
 *   "soon"  planned for this plan, not running yet — never drawn as a ✓;
 *   "no"    not part of this plan.
 * A `value` (seats, credits) is rendered beside the mark.
 */
export type Availability = "yes" | "soon" | "no";

export type FeatureKey =
  | "creditsMonthly" | "creditPrice" | "noExpiry" | "topups"
  | "allTools" | "customPrompts" | "video" | "quality" | "library"
  | "seats" | "priority" | "operator" | "supportEmail" | "supportDedicated" | "commercial";

/**
 * Whether a feature is on a plan. Everything a plan really differs by comes
 * from data (its capability bag, its credits, its service level); everything
 * every plan has is "yes" for all — there are no per-plan tool gates
 * (service_catalog.plan_slugs is empty), so none is invented here.
 */
export function featureOn(key: FeatureKey, slug: string, caps: Record<string, number | boolean>): Availability {
  const level = serviceLevel(slug);
  const flag = (c: string) => (caps[c] === true || (typeof caps[c] === "number" && (caps[c] as number) !== 0)
    ? (isComingSoon(c) ? "soon" : "yes") : "no");
  switch (key) {
    case "video": return "soon";
    case "seats": return flag("workspace_members");
    case "priority": return flag("priority_queue");
    case "operator": return flag("operator_mode");
    case "supportDedicated": return level?.dedicatedSupport ? "yes" : "no";
    case "commercial": return level?.commercialUse ? "yes" : "no";
    default: return "yes";
  }
}

/** The card's feature groups after the highlights, in order. */
export const CARD_GROUPS: readonly { key: string; titleKey: string; features: readonly FeatureKey[] }[] = [
  { key: "tools", titleKey: "pricing.group.tools", features: ["allTools", "customPrompts", "video"] },
  { key: "output", titleKey: "pricing.group.output", features: ["quality", "library"] },
  { key: "team", titleKey: "pricing.group.team", features: ["seats", "priority", "operator"] },
  { key: "support", titleKey: "pricing.group.support", features: ["supportEmail", "supportDedicated", "commercial"] },
];

/** The comparison table, grouped. The first `COMPARE_INITIAL_ROWS` show folded. */
export const COMPARE_GROUPS: readonly { key: string; titleKey: string; rows: readonly FeatureKey[] }[] = [
  { key: "credits", titleKey: "pricing.compare.group.credits", rows: ["creditsMonthly", "creditPrice", "noExpiry", "topups"] },
  { key: "imageTools", titleKey: "pricing.compare.group.imageTools", rows: ["allTools", "customPrompts"] },
  { key: "video", titleKey: "pricing.compare.group.video", rows: ["video"] },
  { key: "output", titleKey: "pricing.compare.group.output", rows: ["quality", "library"] },
  { key: "team", titleKey: "pricing.compare.group.team", rows: ["seats", "priority", "operator"] },
  { key: "support", titleKey: "pricing.compare.group.support", rows: ["supportEmail", "supportDedicated"] },
  { key: "license", titleKey: "pricing.compare.group.license", rows: ["commercial"] },
];
export const COMPARE_INITIAL_ROWS = 9;

/* ── FAQ ───────────────────────────────────────────────────────────────────*/

/**
 * The questions, in order. Answers are dictionary strings written from what
 * the product actually does (lib/server/stripe-webhook.ts, the Stripe account,
 * the ledger) — no legal or refund rule is invented there. `premiere` only
 * renders while the premiere offer runs.
 */
export const FAQ: readonly { key: string; when?: "premiere" }[] = [
  { key: "credits" },
  { key: "renewal" },
  { key: "methods" },
  { key: "topups" },
  { key: "refunds" },
  { key: "howMany" },
  { key: "change" },
  { key: "premiere", when: "premiere" },
];

/* ── page switches ─────────────────────────────────────────────────────────*/

export const PRICING_PAGE = {
  /**
   * The period the page OPENS on. The brief prefers "annual"; it is applied
   * only when annual billing is on sale for every paid plan — otherwise the
   * page opens on monthly, because an annual default with no annual price
   * would quote a figure nobody set.
   */
  defaultBillingPeriod: "annual" as BillingPeriod,
  /** Annual not on sale: show the segment disabled ("soon"), or hide it. */
  annualWhenUnavailable: "disabled" as "disabled" | "hidden",
  /** Tallest coin stack, for the largest pack. */
  coinStackMax: 5,
  /**
   * The model whose per-image price the plan cards' "≈ N images" lines use:
   * Nano Banana Pro, the model behind Retusz and the image tools. The figure
   * is that price divided into the plan's credits, and the card names it.
   */
  costReferenceModel: "gemini-3-pro-image",
  /** Anchors. `topups` is where "+ Kup kredyty" scrolls to. */
  anchors: { plans: "plany", compare: "porownanie", topups: "doladowania", faq: "faq" },
} as const;
