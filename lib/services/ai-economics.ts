import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { billingFrom, type BillingConfig } from "@/lib/images/pricing";

type Client = SupabaseClient<Database>;

/**
 * WHAT THE API COST US, AGAINST WHAT WE CHARGED.
 *
 * Every figure here comes from `usage_events`, which is written by the one
 * ledger path (`startUsage` / `completeUsage` / `failUsage`) and carries both
 * numbers per request: the credits the customer was charged, and the provider
 * cost recorded when the call returned.
 *
 * THE COST IS NEVER INVENTED. Three cases, kept apart on purpose:
 *
 *   measured  — the provider told us, and `actual_api_cost_usd_micros` holds it.
 *   estimated — no per-call figure came back, so the catalogue's configured
 *               price at execution time is used, and the row says "estimated".
 *   unknown   — a paid operation with neither. It is counted as zero cost and
 *               reported separately, because a confident 0.00 zł on a call that
 *               certainly cost something is the one number worth nothing.
 */

export const COST_BASIS = ["measured", "estimated", "unknown"] as const;
export type CostBasis = (typeof COST_BASIS)[number];

export type UsageEventRow = {
  id: string;
  created_at: string;
  status: string;
  service_slug: string;
  provider_slug: string | null;
  model_slug: string | null;
  user_id: string | null;
  credits_charged: number;
  actual_api_cost_usd_micros: number | null;
  api_cost_usd_micros_snapshot: number;
};

/** How this row's cost was arrived at, and the figure in USD micros. */
export function costOf(e: UsageEventRow): { basis: CostBasis; usdMicros: number } {
  if (e.actual_api_cost_usd_micros && e.actual_api_cost_usd_micros > 0) {
    return { basis: "measured", usdMicros: e.actual_api_cost_usd_micros };
  }
  if (e.api_cost_usd_micros_snapshot > 0) {
    return { basis: "estimated", usdMicros: e.api_cost_usd_micros_snapshot };
  }
  // Free local tools legitimately cost nothing; a paid one with no figure is
  // the case the caller has to be able to see.
  return { basis: e.credits_charged > 0 ? "unknown" : "measured", usdMicros: 0 };
}

export type Totals = {
  requests: number;
  succeeded: number;
  failed: number;
  /** Credits charged, refunds excluded. */
  credits: number;
  costUsdMicros: number;
  /** How many rows contributed each kind of cost figure. */
  measured: number;
  estimated: number;
  unknown: number;
  revenuePln: number;
  costPln: number;
  profitPln: number;
  /** null when there is no revenue to take a margin of. */
  marginPercent: number | null;
};

export function summarise(events: UsageEventRow[], billing: BillingConfig): Totals {
  const t: Totals = {
    requests: events.length, succeeded: 0, failed: 0, credits: 0, costUsdMicros: 0,
    measured: 0, estimated: 0, unknown: 0,
    revenuePln: 0, costPln: 0, profitPln: 0, marginPercent: null,
  };
  for (const e of events) {
    if (e.status === "succeeded") t.succeeded += 1;
    if (e.status === "failed" || e.status === "refunded") t.failed += 1;
    const { basis, usdMicros } = costOf(e);
    t[basis] += 1;
    // A refunded request charged the customer nothing in the end — but it may
    // still have cost us at the provider, so the cost is counted and the
    // credits are not. Assuming "failed = free" is how a margin goes quietly
    // negative without anybody seeing it.
    if (e.status !== "refunded") t.credits += e.credits_charged;
    t.costUsdMicros += usdMicros;
  }
  t.revenuePln = t.credits * billing.plnPerCredit;
  t.costPln = (t.costUsdMicros / 1_000_000) * billing.usdToPln;
  t.profitPln = t.revenuePln - t.costPln;
  t.marginPercent = t.revenuePln > 0 ? (t.profitPln / t.revenuePln) * 100 : null;
  return t;
}

/** Group by any key on the event, summarised the same way as the whole. */
export function groupBy(
  events: UsageEventRow[],
  key: (e: UsageEventRow) => string | null,
  billing: BillingConfig,
): { key: string; totals: Totals }[] {
  const buckets = new Map<string, UsageEventRow[]>();
  for (const e of events) {
    const k = key(e) ?? "—";
    const list = buckets.get(k) ?? [];
    list.push(e);
    buckets.set(k, list);
  }
  return [...buckets.entries()]
    .map(([k, rows]) => ({ key: k, totals: summarise(rows, billing) }))
    .sort((a, b) => b.totals.costUsdMicros - a.totals.costUsdMicros);
}

export const PERIODS = { today: 0, week: 7, month: 30, quarter: 90 } as const;
export type PeriodKey = keyof typeof PERIODS;

/** Start of a period. `today` means midnight, not "24 hours ago". */
export function periodStart(period: PeriodKey, now = new Date()): Date {
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getTime() - PERIODS[period] * 86_400_000);
}

/** First day of the current calendar month — what a provider's budget runs on. */
export function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export type EconomicsInput = {
  since?: string;
  providerSlug?: string;
  modelSlug?: string;
  serviceSlug?: string;
  status?: string;
  limit?: number;
};

/** One read of the ledger, filtered in SQL, with the billing assumptions. */
export async function readUsage(supabase: Client, input: EconomicsInput = {}): Promise<{
  events: UsageEventRow[]; billing: BillingConfig; truncated: boolean;
}> {
  const cap = Math.min(input.limit ?? 20000, 20000);
  let q = supabase
    .from("usage_events")
    .select("id, created_at, status, service_slug, provider_slug, model_slug, user_id, credits_charged, actual_api_cost_usd_micros, api_cost_usd_micros_snapshot")
    .order("created_at", { ascending: false })
    .limit(cap);
  if (input.since) q = q.gte("created_at", input.since);
  if (input.providerSlug) q = q.eq("provider_slug", input.providerSlug);
  if (input.modelSlug) q = q.eq("model_slug", input.modelSlug);
  if (input.serviceSlug) q = q.eq("service_slug", input.serviceSlug);
  if (input.status) q = q.eq("status", input.status);

  const [{ data }, { data: billingRow }] = await Promise.all([
    q,
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
  ]);
  const events = (data ?? []) as UsageEventRow[];
  return {
    events,
    billing: billingFrom(billingRow?.value),
    // The page says so when it is showing a slice rather than everything.
    truncated: events.length >= cap,
  };
}

/* ── budgets and alerts ───────────────────────────────────────────────────*/

export type BudgetRow = {
  providerId: string;
  monthlyBudgetUsdMicros: number | null;
  warnPercent: number;
  criticalPercent: number;
  maxRequestUsdMicros: number | null;
  failureRatePercent: number | null;
  alertsEnabled: boolean;
  lastAlertLevel: string | null;
  lastAlertAt: string | null;
};

export type BudgetStatus = {
  providerId: string;
  providerSlug: string;
  providerName: string;
  budget: BudgetRow | null;
  spentUsdMicros: number;
  /** null when no budget is set — no budget means no percentage to report. */
  percent: number | null;
  level: "ok" | "warn" | "critical";
  requests: number;
  failureRate: number | null;
};

/**
 * Month-to-date spend per provider against its budget.
 *
 * A provider with no budget gets a level of "ok" and a null percent: we do not
 * know their balance and do not pretend to. What we do know exactly is what we
 * have spent, and that is what this reports.
 */
export async function readBudgetStatus(supabase: Client): Promise<BudgetStatus[]> {
  const since = monthStart().toISOString();
  const [{ data: providers }, { data: budgets }, { events }] = await Promise.all([
    supabase.from("ai_providers").select("id, slug, name").order("name"),
    supabase.from("ai_provider_budgets").select("*"),
    readUsage(supabase, { since }),
  ]);

  const budgetByProvider = new Map((budgets ?? []).map((b) => [b.provider_id, b]));
  const bySlug = new Map<string, UsageEventRow[]>();
  for (const e of events) {
    if (!e.provider_slug) continue;
    const list = bySlug.get(e.provider_slug) ?? [];
    list.push(e);
    bySlug.set(e.provider_slug, list);
  }

  return (providers ?? []).map((p): BudgetStatus => {
    const rows = bySlug.get(p.slug) ?? [];
    const spent = rows.reduce((s, e) => s + costOf(e).usdMicros, 0);
    const b = budgetByProvider.get(p.id);
    const budget: BudgetRow | null = b ? {
      providerId: b.provider_id,
      monthlyBudgetUsdMicros: b.monthly_budget_usd_micros,
      warnPercent: b.warn_percent,
      criticalPercent: b.critical_percent,
      maxRequestUsdMicros: b.max_request_usd_micros,
      failureRatePercent: b.failure_rate_percent,
      alertsEnabled: b.alerts_enabled,
      lastAlertLevel: b.last_alert_level,
      lastAlertAt: b.last_alert_at,
    } : null;

    const percent = budget?.monthlyBudgetUsdMicros
      ? (spent / budget.monthlyBudgetUsdMicros) * 100
      : null;
    const level: BudgetStatus["level"] = percent === null ? "ok"
      : percent >= (budget?.criticalPercent ?? 90) ? "critical"
      : percent >= (budget?.warnPercent ?? 75) ? "warn"
      : "ok";
    const failed = rows.filter((e) => e.status === "failed" || e.status === "refunded").length;

    return {
      providerId: p.id,
      providerSlug: p.slug,
      providerName: p.name,
      budget,
      spentUsdMicros: spent,
      percent,
      level,
      requests: rows.length,
      failureRate: rows.length > 0 ? (failed / rows.length) * 100 : null,
    };
  });
}
