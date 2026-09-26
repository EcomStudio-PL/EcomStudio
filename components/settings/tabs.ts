/**
 * ACCOUNT SETTINGS — the four tabs, and the one plan summary the
 * "Subskrypcje" tab renders.
 *
 * Pure: no React, no database. The server page decides the first tab from
 * `?tab=` through `parseSettingsTab`, and the client switcher uses the same
 * list, so a tab the page cannot render is never a tab the URL can ask for.
 */

import { planTone, type PlanTone } from "@/lib/plan-tone";

export const SETTINGS_TABS = ["profile", "account", "subscriptions", "preferences"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "profile";

/** `?tab=` as the page receives it. Anything off the whitelist is the default
 *  tab — never an error, never an empty page. */
export function parseSettingsTab(raw: unknown): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && (SETTINGS_TABS as readonly string[]).includes(value)
    ? (value as SettingsTab)
    : DEFAULT_SETTINGS_TAB;
}

/** The anchor of the GrovNews card; a link carrying it opens "Subskrypcje". */
export const GROVNEWS_ANCHOR = "grovnews";

/** The statuses under which a workspace is on a paid plan. Same three the
 *  checkout treats as "already subscribed" (lib/server/billing.ts). */
export const LIVE_PLAN_STATUSES = ["active", "trialing", "past_due"] as const;
export type LivePlanStatus = (typeof LIVE_PLAN_STATUSES)[number];

/** The subscriptions row as the settings page selects it. */
export type PlanRow = {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  provider_subscription_id: string | null;
  subscription_plans: { name: string; slug: string } | null;
};

export type PlanSummary = {
  name: string;
  tone: PlanTone;
  /** "free" when there is no live subscription row. */
  status: LivePlanStatus | "free";
  /** Next renewal — only when the row has a period end and will renew. */
  renewsAt: string | null;
  /** The plan will NOT renew: it stays active until this date. */
  endsAt: string | null;
  /** A Stripe subscription exists, so the Billing Portal has something to open. */
  manageable: boolean;
};

/**
 * What the "Plan GrovBase" card says. A workspace without a live
 * subscription is on the free tier — named by the free plan's own row when
 * there is one, "Free" otherwise (the same fallback the app layout uses).
 */
export function planSummary(row: PlanRow | null, freeName: string | null): PlanSummary {
  const live = row && (LIVE_PLAN_STATUSES as readonly string[]).includes(row.status) && row.subscription_plans
    ? row : null;
  if (!live || !live.subscription_plans) {
    const name = freeName?.trim() || "Free";
    return { name, tone: planTone("free"), status: "free", renewsAt: null, endsAt: null, manageable: false };
  }
  const plan = live.subscription_plans;
  const end = live.current_period_end;
  return {
    name: plan.name,
    tone: planTone(plan.slug) === "neutral" ? planTone(plan.name) : planTone(plan.slug),
    status: live.status as LivePlanStatus,
    renewsAt: end && !live.cancel_at_period_end && live.status !== "past_due" ? end : null,
    endsAt: end && live.cancel_at_period_end ? end : null,
    manageable: Boolean(live.stripe_customer_id || live.provider_subscription_id),
  };
}
