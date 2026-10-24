import "server-only";
import type { Client } from "@/lib/services/workspace";
import { SMART_PROMPT_SERVICE, type SmartPromptConfig } from "@/lib/smart-prompt";
import {
  SMART_PROMPT_DEFAULT_INSTRUCTION, readSmartPromptBlockers, type SmartPromptBlocker,
} from "@/lib/server/smart-prompt";

/**
 * INTELIGENTNY PROMPT — what the operator sees on Admin → AI → Generator:
 * whether it can run (and why not), its settings, and what it did in the last
 * 30 days. Usage is the customer ledger (usage_events) for runs and credits,
 * and the provider trace (ai_provider_calls) for requests, tokens and cost —
 * the same two tables every economics view reads. Both are admin-readable.
 */

export type SmartPromptUsage = {
  days: number;
  runs: number;
  succeeded: number;
  refunded: number;
  pending: number;
  /** Net credits: succeeded runs only (a refunded run gave them back). */
  credits: number;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Cost of the calls whose tokens could be priced. */
  apiCostUsdMicros: number;
  /** Calls without a price row for their model — cost unknown, never 0. */
  unpricedCalls: number;
  models: { provider: string; model: string; calls: number }[];
  lastAt: string | null;
};

export type SmartPromptAdmin = {
  blockers: SmartPromptBlocker[];
  credits: number | null;
  enabled: boolean;
  maintenance: boolean;
  config: SmartPromptConfig | null;
  defaultInstruction: string;
  usage: SmartPromptUsage;
};

const DAYS = 30;

export async function readSmartPromptAdmin(supabase: Client): Promise<SmartPromptAdmin> {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const [state, events, calls] = await Promise.all([
    readSmartPromptBlockers(supabase, { withProvider: true }),
    supabase.from("usage_events")
      .select("status, credits_charged, created_at")
      .eq("service_slug", SMART_PROMPT_SERVICE).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(5000),
    supabase.from("ai_provider_calls")
      .select("provider_slug, model, status, input_tokens, output_tokens, cost_usd_micros, cost_basis")
      .eq("tool_key", SMART_PROMPT_SERVICE).gte("created_at", since).limit(5000),
  ]);

  const usage: SmartPromptUsage = {
    days: DAYS, runs: 0, succeeded: 0, refunded: 0, pending: 0, credits: 0,
    calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, apiCostUsdMicros: 0, unpricedCalls: 0,
    models: [], lastAt: null,
  };
  for (const e of events.data ?? []) {
    usage.runs += 1;
    if (e.status === "succeeded") { usage.succeeded += 1; usage.credits += e.credits_charged; }
    else if (e.status === "pending") usage.pending += 1;
    else usage.refunded += 1;
    if (!usage.lastAt || e.created_at > usage.lastAt) usage.lastAt = e.created_at;
  }
  const byModel = new Map<string, { provider: string; model: string; calls: number }>();
  for (const c of calls.data ?? []) {
    usage.calls += 1;
    if (c.status !== "succeeded") usage.failedCalls += 1;
    usage.inputTokens += Number(c.input_tokens ?? 0);
    usage.outputTokens += Number(c.output_tokens ?? 0);
    if (c.cost_basis === "unknown" || c.cost_usd_micros == null) usage.unpricedCalls += 1;
    else usage.apiCostUsdMicros += Number(c.cost_usd_micros);
    const key = `${c.provider_slug}/${c.model ?? "?"}`;
    const row = byModel.get(key) ?? { provider: c.provider_slug, model: c.model ?? "?", calls: 0 };
    row.calls += 1;
    byModel.set(key, row);
  }
  usage.models = [...byModel.values()].sort((a, b) => b.calls - a.calls);

  return {
    blockers: state.blockers,
    credits: state.service?.credits ?? null,
    enabled: state.service?.enabled ?? false,
    maintenance: state.service?.maintenance ?? false,
    config: state.config,
    defaultInstruction: SMART_PROMPT_DEFAULT_INSTRUCTION,
    usage,
  };
}
