import type { Client } from "./workspace";

/**
 * CENNIK V2 — the administrator's finance view (migration 0176), typed.
 * Read-only, admin-only (the functions refuse anyone else). Money is in minor
 * units of the payment currency (USD); API costs in USD micros. A figure the
 * database could not know is null / counted as unknown — never 0.
 */

export type FinancePeriod = { key: string; from: string; to: string };

export function financePeriod(search: { p?: string; from?: string; to?: string }, now = new Date()): FinancePeriod {
  const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(now.getTime() + 60_000);
  const key = search.p ?? "30d";
  if (key === "custom" && search.from && search.to && /^\d{4}-\d{2}-\d{2}$/.test(search.from) && /^\d{4}-\d{2}-\d{2}$/.test(search.to)) {
    const to = new Date(`${search.to}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 1);
    return { key, from: `${search.from}T00:00:00Z`, to: to.toISOString() };
  }
  if (key === "today") return { key, from: day(now).toISOString(), to: end.toISOString() };
  if (key === "7d") return { key, from: new Date(now.getTime() - 7 * 86400_000).toISOString(), to: end.toISOString() };
  if (key === "month") return { key, from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to: end.toISOString() };
  if (key === "all") return { key, from: "2026-01-01T00:00:00Z", to: end.toISOString() };
  return { key: "30d", from: new Date(now.getTime() - 30 * 86400_000).toISOString(), to: end.toISOString() };
}

export type FinanceOverview = {
  vat_rate_estimate: number;
  payments: {
    count: number; other_currency: number; gross: number; net: number; vat_estimated: boolean | null;
    subscription_monthly: number; subscription_annual: number; topups: number;
    fees: number; fees_unknown: number; refunded: number; internal: number; currency: string;
  };
  usage: {
    runs: number; runs_internal: number; credits_used: number; paid_credits: number; free_credits: number;
    revenue_gross: number; revenue_net: number; fee_attributed: number;
    api_cost_paying_usd_micros: number; api_cost_internal_usd_micros: number; api_cost_unknown_calls: number;
  };
  tools: { tool: string; runs: number; succeeded: number; failed: number; outputs: number; credits: number; internal_runs: number }[];
  deferred: { pending_tranches: number; pending_tranche_credits: number; pending_tranche_net: number; unused_paid_credits: number; unused_paid_net: number };
  credits: { granted_subscription: number; granted_topup: number; granted_bonus: number; used: number; refunded: number; expired: number; expired_paid_net: number };
};

export type FinanceCall = {
  provider: string | null; model: string | null; status: string | null; input_tokens: number | null; output_tokens: number | null;
  thought_tokens: number | null; resolution: string | null; cost_usd_micros: number | null; cost_basis: string | null;
};

export type FinanceEvent = {
  id: string; at: string; workspace_id: string; internal: boolean; user_email: string | null; tool: string; service: string;
  job_id: string | null; status: string; model: string | null; resolution: string | null; inputs: string | null; outputs: number;
  credits: number; refunded_credits: number; refunds: number; calls: FinanceCall[]; calls_count: number;
  input_tokens: number | null; output_tokens: number | null; api_cost_usd_micros: number | null; api_cost_unknown_calls: number;
  revenue_gross: number; revenue_net: number; fee: number; currency: string; paid_credits: number; free_credits: number;
  vat_estimated: boolean; fee_known: boolean;
};

export async function financeOverview(supabase: Client, period: FinancePeriod, workspaceId?: string | null): Promise<FinanceOverview | null> {
  const { data, error } = await supabase.rpc("admin_finance_overview", {
    p_from: period.from, p_to: period.to, p_workspace_id: workspaceId ?? null,
  });
  if (error) return null;
  return data as unknown as FinanceOverview;
}

export async function financeEvents(supabase: Client, period: FinancePeriod, workspaceId?: string | null, limit = 100): Promise<FinanceEvent[]> {
  const { data, error } = await supabase.rpc("admin_finance_events", {
    p_from: period.from, p_to: period.to, p_workspace_id: workspaceId ?? null, p_limit: limit,
  });
  if (error) return [];
  return (data as unknown as FinanceEvent[]) ?? [];
}

/** USD micros → minor units (cents). */
export const microsToCents = (micros: number) => micros / 10_000;

/**
 * Contribution margin of paying customers: revenue recognised from the
 * credits they used (net of VAT, at the price each credit was bought for)
 * minus the API cost of their runs and the Stripe fee attributed to those
 * credits. Before PIT/ZUS and fixed costs — never a tax calculation.
 */
export function contributionCents(u: FinanceOverview["usage"]): number {
  return u.revenue_net - microsToCents(u.api_cost_paying_usd_micros) - u.fee_attributed;
}
