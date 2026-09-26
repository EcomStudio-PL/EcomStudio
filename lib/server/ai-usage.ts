import "server-only";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import type { VisionAttempt, VisionBackend } from "@/lib/ai/engine/vision";
import { tokenCost, type Cost, type TokenPrice } from "@/lib/ai/usage-cost";
import { dispatchToken } from "@/lib/server/server-token";

/**
 * THE PROVIDER-SIDE TRACE of every paid AI/API call (ai_provider_calls, 0127).
 *
 * usage_events stays what it is — the customer's ledger: what they were
 * charged, refunded, for which service. This is the other half: which provider
 * and model actually answered, how many requests it took, what the provider
 * reported it used, and what that cost us. It also covers the calls no
 * customer pays for directly (GrovNews, the product analysis, embeddings),
 * which the ledger cannot hold.
 *
 * TELEMETRY NEVER BREAKS A CALL. Every function here swallows its own errors:
 * a generation that succeeded must not fail because its trace row could not be
 * written. Nothing here ever carries a prompt, a key or a provider message —
 * codes and counts only.
 */

export type Consumer =
  | "generation" | "image_tool" | "prompt_engine" | "workflow" | "embeddings"
  | "grovnews" | "provider_test";

export type ProviderCall = {
  actorKind: "customer" | "system" | "admin";
  consumer: Consumer;
  userId?: string | null;
  workspaceId?: string | null;
  toolKey?: string | null;
  usageEventId?: string | null;
  jobId?: string | null;
  runRef?: string | null;
  providerSlug: string;
  model?: string | null;
  status: "succeeded" | "failed";
  errorCode?: string | null;
  requestCount?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number | null;
  unitKind?: "image" | "second" | "request" | "page" | null;
  cost: Cost;
  durationMs?: number | null;
};

/** The row the recorder function accepts (snake_case, validated again in SQL). */
export function toRow(c: ProviderCall): { [key: string]: Json } {
  return {
    actor_kind: c.actorKind,
    consumer: c.consumer,
    user_id: c.userId ?? null,
    workspace_id: c.workspaceId ?? null,
    tool_key: c.toolKey ?? null,
    usage_event_id: c.usageEventId ?? null,
    job_id: c.jobId ?? null,
    run_ref: c.runRef ?? null,
    provider_slug: c.providerSlug,
    model: c.model ?? null,
    status: c.status,
    error_code: c.status === "failed" ? (c.errorCode ?? "provider_error") : null,
    request_count: c.requestCount ?? 1,
    input_tokens: c.inputTokens ?? null,
    output_tokens: c.outputTokens ?? null,
    units: c.units ?? null,
    unit_kind: c.units == null ? null : (c.unitKind ?? null),
    cost_basis: c.cost.basis,
    cost_usd_micros: c.cost.basis === "unknown" ? null : c.cost.usdMicros,
    duration_ms: c.durationMs == null ? null : Math.max(0, Math.round(c.durationMs)),
  };
}

/** Write a batch. Never throws; returns how many rows the database kept. */
export async function recordProviderCalls(db: Client, calls: readonly ProviderCall[]): Promise<number> {
  if (calls.length === 0) return 0;
  const token = dispatchToken();
  if (!token) return 0;
  let kept = 0;
  try {
    for (let i = 0; i < calls.length; i += 50) {
      const { data, error } = await db.rpc("ai_provider_call_record", {
        p_token: token, p_calls: calls.slice(i, i + 50).map(toRow),
      });
      if (error) { console.error("aiUsage.record", error.code ?? "rpc_error"); continue; }
      kept += typeof data === "number" ? data : 0;
    }
  } catch {
    // Telemetry only.
  }
  return kept;
}

/** The admin-entered token price list, read once per caller. Empty on any
 *  failure — which makes costs "unknown", never zero. */
export async function readTokenPrices(db: Client): Promise<TokenPrice[]> {
  try {
    const { data, error } = await db.rpc("ai_token_prices_read", { p_token: dispatchToken() ?? "" });
    if (error || !data) return [];
    return (data as {
      provider_slug: string; model: string;
      input_usd_micros_per_mtok: number; output_usd_micros_per_mtok: number;
    }[]).map((r) => ({
      providerSlug: r.provider_slug, model: r.model,
      inputPerMTok: Number(r.input_usd_micros_per_mtok), outputPerMTok: Number(r.output_usd_micros_per_mtok),
    }));
  } catch {
    return [];
  }
}

/**
 * A meter for text/vision calls: attach it to the backends, let the call run,
 * then `flush()` the collected attempts into the trace. The context (who, which
 * tool, which run) is fixed when the meter is made.
 */
export type TextMeter = {
  /** The same backends, each reporting its requests to this meter. */
  wrap(backends: VisionBackend[]): VisionBackend[];
  /** Attempts seen so far (read-only copy). */
  attempts(): VisionAttempt[];
  /** Record everything collected since the last flush. Never throws. */
  flush(): Promise<number>;
};

export function textMeter(db: Client, ctx: Omit<ProviderCall,
  "providerSlug" | "model" | "status" | "errorCode" | "inputTokens" | "outputTokens" | "cost" | "durationMs" | "units" | "unitKind" | "requestCount"
>): TextMeter {
  const seen: VisionAttempt[] = [];
  let pending: VisionAttempt[] = [];
  let prices: TokenPrice[] | null = null;
  return {
    wrap(backends) {
      return backends.map((b) => ({
        ...b,
        meter: (a: VisionAttempt) => {
          seen.push(a); pending.push(a);
          b.meter?.(a);
        },
      }));
    },
    attempts: () => [...seen],
    async flush() {
      if (pending.length === 0) return 0;
      const batch = pending; pending = [];
      prices ??= await readTokenPrices(db);
      const list = prices;
      return recordProviderCalls(db, batch.map((a) => ({
        ...ctx,
        providerSlug: a.provider,
        model: a.model,
        status: a.ok ? "succeeded" : "failed",
        errorCode: a.ok ? null : (a.error ?? "analysis_error"),
        inputTokens: a.inputTokens ?? null,
        outputTokens: a.outputTokens ?? null,
        cost: tokenCost(list, a.provider, a.model, a.inputTokens, a.outputTokens),
        durationMs: a.durationMs,
      })));
    },
  };
}
