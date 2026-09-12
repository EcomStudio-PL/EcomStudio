import type { Client } from "./workspace";

/**
 * Universal usage ledger. EVERY paid action — current or future — goes
 * through here so CRM, analytics, credits and margins pick it up
 * automatically, with price SNAPSHOTS taken at execution time.
 *
 * Flow:
 *   1. startUsage()   — snapshot pricing from service_catalog, charge
 *                       credits (single ledger writer), create the event.
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

export async function getService(supabase: Client, slug: string) {
  const { data } = await supabase
    .from("service_catalog")
    .select("*")
    .eq("slug", slug)
    .eq("enabled", true)
    .maybeSingle();
  return data;
}

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
  // Before anything is written or charged: without the token the ledger RPCs
  // will refuse us anyway, and finding that out AFTER inserting the event would
  // leave a pending row that nothing can ever complete or refund.
  if (!input.serverToken) return { ok: false, error: "server_unconfigured" };
  const service = await getService(supabase, input.serviceSlug);
  if (!service) return { ok: false, error: "service_unavailable" };
  if (service.maintenance_mode) return { ok: false, error: "maintenance" };

  // Idempotency: an existing event with the same key means the charge
  // already happened — never charge twice.
  if (input.idempotencyKey) {
    const { data: existing } = await supabase
      .from("usage_events").select("id").eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing) return { ok: true, eventId: existing.id };
  }

  const credits = input.creditsCharged ?? service.credits_cost;
  const { data: event, error } = await supabase.from("usage_events").insert({
    user_id: input.userId,
    workspace_id: input.workspaceId,
    service_id: service.id,
    service_slug: service.slug,
    provider_slug: input.providerSlug ?? null,
    model_slug: input.modelSlug ?? null,
    credits_charged: credits,
    api_cost_usd_micros_snapshot: service.api_cost_usd_micros,
    sale_value_cents_snapshot: service.sale_value_cents,
    generation_job_id: input.generationJobId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    metadata: (input.metadata ?? {}) as never,
  }).select("id").single();
  if (error || !event) return { ok: false, error: "event_failed" };

  if (credits > 0) {
    // SECURITY DEFINER RPC, server-gated: it proves the caller is GrovBase,
    // then still checks that the wallet and the event belong to one workspace.
    const { data: txId, error: txError } = await supabase.rpc("usage_event_charge", {
      p_token: input.serverToken,
      p_wallet_id: input.walletId,
      p_amount: credits,
      p_description: service.name,
      p_reference_id: event.id,
      p_metadata: { service: service.slug, ...(input.metadata ?? {}) } as never,
    });
    if (txError) {
      await supabase.rpc("usage_event_fail", {
        p_token: input.serverToken, p_event_id: event.id,
        p_error: "insufficient_credits", p_api_cost_usd_micros: 0,
      });
      return { ok: false, error: "insufficient_credits" };
    }
    void txId; // linked onto the event inside the RPC
  }
  return { ok: true, eventId: event.id };
}

export async function completeUsage(
  supabase: Client, serverToken: string | null, eventId: string, resultCount: number, cost?: {
    /** REAL provider cost of this call, in USD micros. Recorded, never guessed. */
    apiCostUsdMicros?: number;
    providerRequestId?: string | null;
  },
) {
  if (!serverToken) return;
  // Server-gated as well, and not merely for symmetry: apiCostUsdMicros is what
  // every margin and profitability view is computed from. Left customer-
  // callable, a seller could write an arbitrary provider cost onto their own
  // event and make the economics report say whatever they liked.
  await supabase.rpc("usage_event_complete", {
    p_token: serverToken,
    p_event_id: eventId,
    p_result_count: resultCount,
    p_api_cost_usd_micros: Math.max(0, Math.round(cost?.apiCostUsdMicros ?? 0)),
    p_request_id: cost?.providerRequestId ?? null,
  });
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
