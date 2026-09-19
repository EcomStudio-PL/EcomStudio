import type { Json } from "@/lib/database.types";
import type { Client } from "./workspace";

/**
 * Universal usage ledger. EVERY paid action — current or future — goes
 * through here so CRM, analytics, credits and margins pick it up
 * automatically, with price SNAPSHOTS taken at execution time.
 *
 * Flow:
 *   1. startUsage()   — one server-gated RPC that snapshots the catalog price,
 *                       creates the event and takes the credits in a single
 *                       transaction. There is no other way into this table.
 *   2. completeUsage()— mark succeeded with result count.
 *   3. failUsage()    — mark failed and refund the charged credits ONCE
 *                       (idempotent: a second call cannot double-refund).
 *
 * WHY EVERY ENTRY POINT NOW DEMANDS A `serverToken`.
 *
 * These three used to call RPCs that any signed-in customer could call too, and
 * "is the caller a member of this workspace" was the only question those RPCs
 * asked. The caller IS the member — that check can never distinguish GrovBase's
 * server from the customer's browser, and for a refund that distinction is the
 * whole point. usage_events is readable by its own workspace, so a customer
 * could read the id of the generation running at that moment, call
 * fail_usage_event on it, and get the credits back while the images still
 * arrived. Unlimited free generation, for any account.
 *
 * The token is `dispatchToken()` — the proof-of-server this codebase already
 * uses for the notification dispatcher and the integration reads. It is derived
 * from the master key, so only the server can produce it. It is passed in as an
 * ARGUMENT rather than imported here on purpose: this module stays free of
 * `server-only` so it remains reusable behind a future API route, and the type
 * system makes every caller prove what it is instead of trusting where it sits.
 *
 * A null token is a hard stop, not a warning. Charging a customer while the
 * server cannot prove it is the server is worse than not charging them.
 */

export async function startUsage(supabase: Client, input: {
  /** Proof-of-server (dispatchToken()). Null means the master key is absent. */
  serverToken: string | null;
  userId: string;
  workspaceId: string;
  walletId: string;
  serviceSlug: string;
  providerSlug?: string;
  modelSlug?: string;
  generationJobId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  /** Override the catalog price (e.g. model credit_cost × quantity). */
  creditsCharged?: number;
}): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  // Without the token the ledger RPC refuses us anyway, and asking first keeps
  // the failure free of side effects.
  if (!input.serverToken) return { ok: false, error: "server_unconfigured" };

  // ONE CALL DOES ALL OF IT: price lookup, the event row and the debit, inside
  // a single database transaction (migration 0100).
  //
  // What used to be here — read the catalog, check for an existing event with
  // this idempotency key, insert, then charge — had two holes that no ordering
  // of those four steps could close. `usage_events` accepted customer INSERTs,
  // and the key is derived from values the customer picks, so a seller could
  // write the row for the run they were about to make and be handed it free.
  // And between the insert and the charge the event existed unpaid, which is
  // the state a refund could be claimed against.
  //
  // Both are gone by construction: the table no longer has a customer-writable
  // path, and the row cannot outlive a charge that failed. The unique index on
  // idempotency_key is now the arbiter of duplicates, so a double submit is one
  // charge and one run rather than two runs and one charge.
  const { data, error } = await supabase.rpc("usage_event_start", {
    p_token: input.serverToken,
    p_user_id: input.userId,
    p_workspace_id: input.workspaceId,
    // A free run has no wallet to name, and the RPC does not ask for one.
    p_wallet_id: input.walletId || null,
    p_service_slug: input.serviceSlug,
    p_credits: input.creditsCharged ?? null,
    p_provider_slug: input.providerSlug ?? null,
    p_model_slug: input.modelSlug ?? null,
    p_generation_job_id: input.generationJobId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_metadata: (input.metadata ?? {}) as Json,
  });
  if (error) return { ok: false, error: "event_failed" };

  const row = data?.[0];
  if (!row) return { ok: false, error: "event_failed" };
  // `status` carries the business outcome — service_unavailable, maintenance,
  // insufficient_credits, duplicate_request — in the same vocabulary the
  // callers already translate. Anything unexpected is a failure to start.
  if (row.status !== "ok" || !row.event_id) {
    return { ok: false, error: row.status || "event_failed" };
  }
  return { ok: true, eventId: row.event_id };
}

export async function completeUsage(
  supabase: Client, serverToken: string | null, eventId: string, resultCount: number, cost?: {
    /** REAL provider cost of this call, in USD micros. Recorded, never guessed. */
    apiCostUsdMicros?: number;
    providerRequestId?: string | null;
  },
) {
  if (!serverToken) return;
  // TRIED TWICE, BECAUSE LOSING THIS CALL COSTS REAL MONEY.
  //
  // The image tools have no server-side evidence that they delivered: the
  // output goes back in the HTTP response and saving it is a separate call the
  // browser makes. So if this bookkeeping call is lost, the event stays
  // `pending` with nothing to show for it, and the reconciler (migration 0102)
  // will refund it half an hour later — a free run, for a customer who already
  // has their image. A second attempt is free to make: usage_event_complete
  // only touches rows that are still `pending`, so a retry after a lost
  // response is a no-op rather than a second write.
  //
  // Server-gated, and not merely for symmetry: apiCostUsdMicros is what every
  // margin and profitability view is computed from. Left customer-callable, a
  // seller could write an arbitrary provider cost onto their own event and make
  // the economics report say whatever they liked.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.rpc("usage_event_complete", {
      p_token: serverToken,
      p_event_id: eventId,
      p_result_count: resultCount,
      p_api_cost_usd_micros: Math.max(0, Math.round(cost?.apiCostUsdMicros ?? 0)),
      p_request_id: cost?.providerRequestId ?? null,
    });
    if (!error) return;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Closes usage events that were charged and then stranded — the invocation
 * died, or the answer to `usage_event_start` never arrived, so no request ever
 * learned the event id. Delivered work is closed as succeeded; work with
 * nothing to show for it is refunded, exactly once (migration 0102).
 *
 * Deliberately NOT a lookup by idempotency key from inside the request: the key
 * identifies an INPUT, not a request, so two submissions of the same photo
 * share one, and a lookup could hand request B the event request A owns.
 *
 * Returns counts, or null when the migration is not applied yet — which is what
 * lets the application deploy precede it.
 */
export async function reconcileStaleUsage(supabase: Client, serverToken: string | null) {
  if (!serverToken) return null;
  const { data, error } = await supabase.rpc("usage_events_reconcile", {
    p_token: serverToken, p_limit: 50,
  });
  return error ? null : ((data ?? null) as Json | null);
}

export async function failUsage(supabase: Client, input: {
  /** Proof-of-server (dispatchToken()). Without it nothing is refunded. */
  serverToken: string | null;
  eventId: string; walletId: string; error: string;
  /** Provider cost incurred despite the failure (usually 0). */
  apiCostUsdMicros?: number;
}) {
  if (!input.serverToken) return;
  // Atomically marks failed and refunds the event's own charge exactly once —
  // repeat calls no-op, and a succeeded or already-refunded event cannot refund.
  // The token is what stops a customer calling this on their own in-flight
  // generation to get the credits back while keeping the images.
  await supabase.rpc("usage_event_fail", {
    p_token: input.serverToken,
    p_event_id: input.eventId,
    p_error: input.error,
    p_api_cost_usd_micros: Math.max(0, Math.round(input.apiCostUsdMicros ?? 0)),
  });
}

/** Dynamic per-service usage summary — powers CRM + analytics without any
 *  hardcoded per-service fields. New catalog services appear automatically. */
export async function usageByService(supabase: Client, filter: { workspaceId?: string; userId?: string; since?: string }) {
  let q = supabase.from("usage_events")
    .select("service_slug, status, credits_charged, api_cost_usd_micros_snapshot, actual_api_cost_usd_micros, sale_value_cents_snapshot, created_at, model_slug");
  if (filter.workspaceId) q = q.eq("workspace_id", filter.workspaceId);
  if (filter.userId) q = q.eq("user_id", filter.userId);
  if (filter.since) q = q.gte("created_at", filter.since);
  const { data } = await q.limit(10000);
  const byService = new Map<string, {
    slug: string; total: number; succeeded: number; failed: number;
    credits: number; apiCostUsdMicros: number; saleCents: number; lastAt: string | null;
  }>();
  for (const e of data ?? []) {
    const s = byService.get(e.service_slug) ?? {
      slug: e.service_slug, total: 0, succeeded: 0, failed: 0, credits: 0, apiCostUsdMicros: 0, saleCents: 0, lastAt: null,
    };
    s.total += 1;
    if (e.status === "succeeded") s.succeeded += 1;
    if (e.status === "failed" || e.status === "refunded") s.failed += 1;
    if (e.status !== "refunded") {
      s.credits += e.credits_charged;
      // Real recorded cost wins; the catalog snapshot is only a fallback for
      // events written before per-call costs were captured.
      s.apiCostUsdMicros += e.actual_api_cost_usd_micros || e.api_cost_usd_micros_snapshot;
      s.saleCents += e.sale_value_cents_snapshot;
    }
    if (!s.lastAt || e.created_at > s.lastAt) s.lastAt = e.created_at;
    byService.set(e.service_slug, s);
  }
  return [...byService.values()].sort((a, b) => b.total - a.total);
}
