import type { Client } from "./workspace";

/**
 * GROVNEWS MONETISATION — the admin's reads. Every table here is readable by
 * an admin only (RLS in 0123); a customer running these gets empty lists. No
 * secret and no raw Stripe object is selected: ids, amounts, statuses, dates.
 * The discount code's text is not selectable at all — only whether it was
 * issued and used.
 */

export type AdminBilling = {
  salesEnabled: boolean;
  priceCents: number | null;
  currency: string;
  productId: string | null;
  priceId: string | null;
  stripePriceCents: number | null;
  syncStatus: string;
  syncError: string | null;
  syncedAt: string | null;
  priceChangedAt: string | null;
  history: { priceId: string; amount: number; createdAt: string; archivedAt: string | null }[];
};

export async function adminBilling(supabase: Client): Promise<AdminBilling | null> {
  const [{ data: b }, { data: prices }] = await Promise.all([
    supabase.from("grovnews_billing").select("*").maybeSingle(),
    supabase.from("grovnews_prices").select("stripe_price_id, unit_amount, created_at, archived_at")
      .order("created_at", { ascending: false }).limit(20),
  ]);
  if (!b) return null;
  return {
    salesEnabled: b.sales_enabled, priceCents: b.price_cents, currency: b.currency,
    productId: b.stripe_product_id, priceId: b.stripe_price_id, stripePriceCents: b.stripe_price_cents,
    syncStatus: b.sync_status, syncError: b.sync_error, syncedAt: b.synced_at, priceChangedAt: b.price_changed_at,
    history: (prices ?? []).map((p) => ({
      priceId: p.stripe_price_id, amount: p.unit_amount, createdAt: p.created_at, archivedAt: p.archived_at,
    })),
  };
}

export type AdminCampaign = {
  id: string; name: string; status: string;
  windowStart: string; windowEnd: string;
  accessMode: string; accessDays: number | null; accessUntil: string | null;
  discountEnabled: boolean; discountType: string | null; discountValue: number | null;
  discountDuration: string | null; discountMonths: number | null;
  eligiblePlanIds: string[]; codeValidDays: number | null; couponId: string | null;
  activatedAt: string | null; endedAt: string | null; createdAt: string;
  claims: number; codesIssued: number; codesUsed: number;
};

export async function adminCampaigns(supabase: Client): Promise<AdminCampaign[]> {
  const [{ data: rows }, { data: claims }, { data: codes }] = await Promise.all([
    supabase.from("grovnews_launch_campaigns").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("grovnews_launch_claims").select("campaign_id").limit(100000),
    supabase.from("grovnews_launch_codes").select("campaign_id, redeemed_at").limit(100000),
  ]);
  const count = <T extends { campaign_id: string }>(list: T[] | null, id: string, pred: (r: T) => boolean = () => true) =>
    (list ?? []).filter((r) => r.campaign_id === id && pred(r)).length;
  return (rows ?? []).map((c) => ({
    id: c.id, name: c.name, status: c.status, windowStart: c.window_start, windowEnd: c.window_end,
    accessMode: c.access_mode, accessDays: c.access_days, accessUntil: c.access_until,
    discountEnabled: c.discount_enabled, discountType: c.discount_type, discountValue: c.discount_value,
    discountDuration: c.discount_duration, discountMonths: c.discount_months,
    eligiblePlanIds: c.eligible_plan_ids ?? [], codeValidDays: c.code_valid_days, couponId: c.stripe_coupon_id,
    activatedAt: c.activated_at, endedAt: c.ended_at, createdAt: c.created_at,
    claims: count(claims, c.id),
    codesIssued: count(codes, c.id),
    codesUsed: count(codes, c.id, (r) => r.redeemed_at !== null),
  }));
}

export type AdminPlanOption = { id: string; name: string; priceCents: number; mapped: boolean };

/** The monthly plans a launch discount may apply to: paid, active, mapped. */
export async function adminPlanOptions(supabase: Client): Promise<AdminPlanOption[]> {
  const { data } = await supabase.from("subscription_plans")
    .select("id, name, price_cents, active, stripe_product_id, stripe_price_id_monthly")
    .gt("price_cents", 0).order("sort_order");
  return (data ?? []).filter((p) => p.active).map((p) => ({
    id: p.id, name: p.name, priceCents: p.price_cents,
    mapped: Boolean(p.stripe_product_id && p.stripe_price_id_monthly),
  }));
}

export type AdminMonetizationStats = {
  activePaid: number;
  cancellingPaid: number;
  pastDue: number;
  /** Sum of the monthly price of subscriptions that are active and will renew. */
  mrrCents: number;
  launchGrants: number;
  expiringSoon: number;
  codesIssued: number;
  codesUsed: number;
  /** Launch claimants who later bought GrovNews — null when there is no claim to divide by. */
  launchToPaid: number | null;
};

/** Real numbers only: every figure is a count or a sum over existing rows. */
export async function adminMonetizationStats(supabase: Client, now: Date = new Date()): Promise<AdminMonetizationStats> {
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: subs }, { data: claims }, { data: codes }, expiring] = await Promise.all([
    supabase.from("grovnews_subscriptions").select("user_id, status, cancel_at_period_end, unit_amount_cents, paid_through").limit(100000),
    supabase.from("grovnews_launch_claims").select("user_id, access_granted").limit(100000),
    supabase.from("grovnews_launch_codes").select("redeemed_at").limit(100000),
    supabase.from("grovnews_entitlements").select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE").gt("expires_at", nowIso).lte("expires_at", soonIso),
  ]);
  const list = subs ?? [];
  const live = list.filter((s) => s.status === "active" || s.status === "trialing");
  const renewing = live.filter((s) => !s.cancel_at_period_end);
  const payers = new Set(list.filter((s) => s.paid_through !== null).map((s) => s.user_id));
  const claimants = new Set((claims ?? []).map((c) => c.user_id));
  return {
    activePaid: live.length,
    cancellingPaid: live.length - renewing.length,
    pastDue: list.filter((s) => s.status === "past_due").length,
    mrrCents: renewing.reduce((sum, s) => sum + (s.unit_amount_cents ?? 0), 0),
    launchGrants: (claims ?? []).filter((c) => c.access_granted).length,
    expiringSoon: expiring.count ?? 0,
    codesIssued: (codes ?? []).length,
    codesUsed: (codes ?? []).filter((c) => c.redeemed_at !== null).length,
    launchToPaid: claimants.size > 0 ? [...claimants].filter((u) => payers.has(u)).length : null,
  };
}

export type AdminPaidRow = {
  userId: string | null; email: string; status: string;
  priceCents: number | null; currency: string;
  currentPeriodEnd: string | null; paidThrough: string | null; cancelAtPeriodEnd: boolean;
  campaign: string | null; codeIssued: boolean; codeUsed: boolean;
};

/** Paid subscribers, with what launch benefit each also holds. */
export async function adminPaidSubscribers(supabase: Client): Promise<AdminPaidRow[]> {
  const [{ data: subs }, { data: claims }, { data: codes }, { data: campaigns }] = await Promise.all([
    supabase.from("grovnews_subscriptions")
      .select("user_id, status, unit_amount_cents, currency, current_period_end, paid_through, cancel_at_period_end, created_at, profile:profiles(email)")
      .not("status", "in", "(incomplete,incomplete_expired)")
      .order("created_at", { ascending: false }).limit(1000),
    supabase.from("grovnews_launch_claims").select("user_id, campaign_id").limit(100000),
    supabase.from("grovnews_launch_codes").select("user_id, redeemed_at").limit(100000),
    supabase.from("grovnews_launch_campaigns").select("id, name").limit(200),
  ]);
  const names = new Map((campaigns ?? []).map((c) => [c.id, c.name]));
  const claimOf = new Map((claims ?? []).map((c) => [c.user_id, names.get(c.campaign_id) ?? null]));
  const codeOf = new Map((codes ?? []).map((c) => [c.user_id, c.redeemed_at !== null]));
  return ((subs ?? []) as unknown as {
    user_id: string | null; status: string; unit_amount_cents: number | null; currency: string;
    current_period_end: string | null; paid_through: string | null; cancel_at_period_end: boolean;
    profile: { email: string } | null;
  }[]).map((s) => ({
    userId: s.user_id, email: s.profile?.email ?? "—", status: s.status,
    priceCents: s.unit_amount_cents, currency: s.currency,
    currentPeriodEnd: s.current_period_end, paidThrough: s.paid_through, cancelAtPeriodEnd: s.cancel_at_period_end,
    campaign: s.user_id ? claimOf.get(s.user_id) ?? null : null,
    codeIssued: s.user_id ? codeOf.has(s.user_id) : false,
    codeUsed: s.user_id ? codeOf.get(s.user_id) === true : false,
  }));
}

/** Launch claimants (for the subscribers screen): campaign, access, code status. */
export type AdminLaunchRow = {
  userId: string; email: string; campaign: string | null; claimedAt: string;
  accessGranted: boolean; accessUntil: string | null; codeIssued: boolean; codeUsed: boolean;
};

export async function adminLaunchClaims(supabase: Client): Promise<AdminLaunchRow[]> {
  const [{ data: claims }, { data: codes }, { data: campaigns }] = await Promise.all([
    supabase.from("grovnews_launch_claims")
      .select("user_id, campaign_id, claimed_at, access_granted, access_expires_at, profile:profiles(email)")
      .order("claimed_at", { ascending: false }).limit(1000),
    supabase.from("grovnews_launch_codes").select("user_id, campaign_id, redeemed_at").limit(100000),
    supabase.from("grovnews_launch_campaigns").select("id, name").limit(200),
  ]);
  const names = new Map((campaigns ?? []).map((c) => [c.id, c.name]));
  const codeOf = new Map((codes ?? []).map((c) => [`${c.campaign_id}:${c.user_id}`, c.redeemed_at !== null]));
  return ((claims ?? []) as unknown as {
    user_id: string; campaign_id: string; claimed_at: string; access_granted: boolean;
    access_expires_at: string | null; profile: { email: string } | null;
  }[]).map((c) => ({
    userId: c.user_id, email: c.profile?.email ?? "—", campaign: names.get(c.campaign_id) ?? null,
    claimedAt: c.claimed_at, accessGranted: c.access_granted, accessUntil: c.access_expires_at,
    codeIssued: codeOf.has(`${c.campaign_id}:${c.user_id}`),
    codeUsed: codeOf.get(`${c.campaign_id}:${c.user_id}`) === true,
  }));
}
