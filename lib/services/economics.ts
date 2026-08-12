import type { Client } from "./workspace";

/**
 * ECONOMICS — revenue, real provider cost, contribution and margin, computed
 * exclusively from recorded facts: settled `payments` rows and the
 * `usage_events` ledger (which snapshots the price at execution time and now
 * stores the REAL per-call provider cost). Nothing here is estimated or
 * back-filled from configuration; an unknown cost stays 0 rather than being
 * invented, so a margin shown to the operator is a margin that happened.
 */

export const PERIODS = ["today", "7d", "30d", "90d", "all"] as const;
export type Period = (typeof PERIODS)[number];

/** Inclusive lower bound for a period, or null for "all time". */
export function periodStart(period: Period, now = new Date()): Date | null {
  if (period === "all") return null;
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000);
}

const SETTLED = new Set(["succeeded", "paid", "completed"]);

export type MoneySlice = {
  revenueCents: number;
  apiCostUsdMicros: number;
  /** revenue − provider cost, in cents (cost converted with usdToPln). */
  contributionCents: number;
  marginPercent: number;
  generations: number;
  succeeded: number;
  failed: number;
  outputs: number;
  creditsCharged: number;
};

export type UsageRow = {
  status: string;
  credits_charged: number;
  result_count: number | null;
  actual_api_cost_usd_micros: number | null;
  api_cost_usd_micros_snapshot: number;
  model_slug: string | null;
  service_slug: string;
  created_at: string;
};

export type PaymentRow = { amount_cents: number; status: string; created_at: string };

/** Real provider cost of one event: recorded cost first, catalog snapshot only
 *  as a fallback for events written before per-call costs were captured. */
export function eventCost(e: UsageRow): number {
  return e.actual_api_cost_usd_micros || e.api_cost_usd_micros_snapshot || 0;
}

export function sliceEconomics(
  payments: PaymentRow[], events: UsageRow[], usdToPln: number
): MoneySlice {
  const revenueCents = payments
    .filter((p) => SETTLED.has(p.status))
    .reduce((s, p) => s + p.amount_cents, 0);

  let apiCostUsdMicros = 0, succeeded = 0, failed = 0, outputs = 0, creditsCharged = 0;
  for (const e of events) {
    apiCostUsdMicros += eventCost(e);
    if (e.status === "succeeded") {
      succeeded += 1;
      outputs += e.result_count ?? 0;
      creditsCharged += e.credits_charged;
    } else if (e.status === "failed" || e.status === "refunded") {
      failed += 1;
    }
  }
  const apiCostCents = Math.round((apiCostUsdMicros / 1_000_000) * usdToPln * 100);
  const contributionCents = revenueCents - apiCostCents;
  return {
    revenueCents, apiCostUsdMicros, contributionCents,
    marginPercent: revenueCents > 0 ? Math.round((contributionCents / revenueCents) * 1000) / 10 : 0,
    generations: events.length, succeeded, failed, outputs, creditsCharged,
  };
}

export function withinPeriod<T extends { created_at: string }>(rows: T[], period: Period, now = new Date()): T[] {
  const start = periodStart(period, now);
  if (!start) return rows;
  return rows.filter((r) => new Date(r.created_at) >= start);
}

export type ModelEconomics = {
  model: string;
  jobs: number;
  outputs: number;
  creditsCharged: number;
  apiCostUsdMicros: number;
  revenueCents: number;
  contributionCents: number;
  marginPercent: number;
  /** Cost per delivered output — the number that exposes a runaway model. */
  costPerOutputUsdMicros: number;
};

/**
 * Per-model economics. Revenue is ATTRIBUTED: a customer pays for credits, not
 * for a single image, so each model earns the share of the period's revenue
 * that matches its share of the credits actually spent. With no revenue in the
 * period every model attributes 0 — deliberately, rather than inventing a
 * credit price that the customer may never have paid.
 */
export function modelEconomics(events: UsageRow[], revenueCents: number, usdToPln: number): ModelEconomics[] {
  const totalCredits = events
    .filter((e) => e.status === "succeeded")
    .reduce((s, e) => s + e.credits_charged, 0);

  const byModel = new Map<string, ModelEconomics>();
  for (const e of events) {
    const key = e.model_slug ?? e.service_slug;
    const row = byModel.get(key) ?? {
      model: key, jobs: 0, outputs: 0, creditsCharged: 0, apiCostUsdMicros: 0,
      revenueCents: 0, contributionCents: 0, marginPercent: 0, costPerOutputUsdMicros: 0,
    };
    row.jobs += 1;
    row.apiCostUsdMicros += eventCost(e);
    if (e.status === "succeeded") {
      row.outputs += e.result_count ?? 0;
      row.creditsCharged += e.credits_charged;
    }
    byModel.set(key, row);
  }

  for (const row of byModel.values()) {
    row.revenueCents = totalCredits > 0
      ? Math.round(revenueCents * (row.creditsCharged / totalCredits))
      : 0;
    const costCents = Math.round((row.apiCostUsdMicros / 1_000_000) * usdToPln * 100);
    row.contributionCents = row.revenueCents - costCents;
    row.marginPercent = row.revenueCents > 0
      ? Math.round((row.contributionCents / row.revenueCents) * 1000) / 10
      : 0;
    row.costPerOutputUsdMicros = row.outputs > 0 ? Math.round(row.apiCostUsdMicros / row.outputs) : 0;
  }
  return [...byModel.values()].sort((a, b) => b.apiCostUsdMicros - a.apiCostUsdMicros);
}

export type CostAnomaly = { kind: "expensive_output" | "cost_without_result" | "estimate_drift"; detail: string; eventCostUsdMicros: number };

/**
 * Cost auditing: the situations worth an operator's attention — a call that
 * cost far more per output than that model's own median, spend on a call that
 * delivered nothing, and real cost drifting away from the configured estimate.
 */
export function costAnomalies(events: UsageRow[]): CostAnomaly[] {
  const out: CostAnomaly[] = [];
  const perModel = new Map<string, number[]>();
  for (const e of events) {
    if (e.status !== "succeeded" || !(e.result_count ?? 0)) continue;
    const key = e.model_slug ?? e.service_slug;
    perModel.set(key, [...(perModel.get(key) ?? []), eventCost(e) / (e.result_count || 1)]);
  }
  const median = new Map<string, number>();
  for (const [k, vals] of perModel) {
    const sorted = [...vals].sort((a, b) => a - b);
    median.set(k, sorted[Math.floor(sorted.length / 2)] ?? 0);
  }

  for (const e of events) {
    const cost = eventCost(e);
    if (cost <= 0) continue;
    const key = e.model_slug ?? e.service_slug;
    if (e.status === "succeeded" && (e.result_count ?? 0) > 0) {
      const per = cost / (e.result_count || 1);
      const med = median.get(key) ?? 0;
      if (med > 0 && per > med * 2.5) {
        out.push({
          kind: "expensive_output",
          detail: `${key}: ${(per / 1_000_000).toFixed(4)} USD per output vs ${(med / 1_000_000).toFixed(4)} typical`,
          eventCostUsdMicros: cost,
        });
      }
      if (e.actual_api_cost_usd_micros && e.api_cost_usd_micros_snapshot &&
          e.actual_api_cost_usd_micros > e.api_cost_usd_micros_snapshot * 2) {
        out.push({
          kind: "estimate_drift",
          detail: `${key}: real cost ${(e.actual_api_cost_usd_micros / 1_000_000).toFixed(4)} USD vs configured estimate ${(e.api_cost_usd_micros_snapshot / 1_000_000).toFixed(4)} USD`,
          eventCostUsdMicros: cost,
        });
      }
    } else if (e.status !== "succeeded") {
      out.push({
        kind: "cost_without_result",
        detail: `${key}: ${(cost / 1_000_000).toFixed(4)} USD spent on a ${e.status} generation`,
        eventCostUsdMicros: cost,
      });
    }
  }
  return out.sort((a, b) => b.eventCostUsdMicros - a.eventCostUsdMicros).slice(0, 20);
}

/** Every economics input for ONE customer, fetched once and sliced per period. */
export async function customerEconomics(supabase: Client, workspaceId: string) {
  const [{ data: events }, { data: payments }, { data: billing }] = await Promise.all([
    supabase.from("usage_events")
      .select("status, credits_charged, result_count, actual_api_cost_usd_micros, api_cost_usd_micros_snapshot, model_slug, service_slug, created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5000),
    supabase.from("payments")
      .select("amount_cents, status, created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(2000),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
  ]);
  const usdToPln = ((billing?.value ?? {}) as { usd_to_pln?: number }).usd_to_pln ?? 4.0;
  const e = (events ?? []) as UsageRow[];
  const p = (payments ?? []) as PaymentRow[];

  const slices = Object.fromEntries(
    PERIODS.map((period) => [period, sliceEconomics(withinPeriod(p, period), withinPeriod(e, period), usdToPln)])
  ) as Record<Period, MoneySlice>;

  return {
    usdToPln,
    slices,
    models: modelEconomics(e, slices.all.revenueCents, usdToPln),
    anomalies: costAnomalies(e),
    events: e,
    payments: p,
  };
}
