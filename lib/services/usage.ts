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
    // SECURITY DEFINER RPC: members can only spend their own workspace wallet.
    const { data: txId, error: txError } = await supabase.rpc("charge_usage_credits", {
      p_wallet_id: input.walletId,
      p_amount: credits,
      p_description: service.name,
      p_reference_id: event.id,
      p_metadata: { service: service.slug, ...(input.metadata ?? {}) } as never,
    });
    if (txError) {
      await supabase.from("usage_events")
        .update({ status: "failed", error: "insufficient_credits", finished_at: new Date().toISOString() })
        .eq("id", event.id);
      return { ok: false, error: "insufficient_credits" };
    }
    await supabase.from("usage_events").update({ credit_tx_id: txId }).eq("id", event.id);
  }
  return { ok: true, eventId: event.id };
}

export async function completeUsage(supabase: Client, eventId: string, resultCount: number) {
  await supabase.from("usage_events")
    .update({ status: "succeeded", result_count: resultCount, finished_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "pending");
}

export async function failUsage(supabase: Client, input: {
  eventId: string; walletId: string; error: string;
}) {
  // Guarded transition pending -> failed, then a SECURITY DEFINER refund
  // that pays back the event's own charge exactly once (repeat calls no-op).
  await supabase.from("usage_events")
    .update({ status: "failed", error: input.error, finished_at: new Date().toISOString() })
    .eq("id", input.eventId)
    .eq("status", "pending");
  await supabase.rpc("refund_usage_event", { p_event_id: input.eventId });
}

/** Dynamic per-service usage summary — powers CRM + analytics without any
 *  hardcoded per-service fields. New catalog services appear automatically. */
export async function usageByService(supabase: Client, filter: { workspaceId?: string; userId?: string; since?: string }) {
  let q = supabase.from("usage_events")
    .select("service_slug, status, credits_charged, api_cost_usd_micros_snapshot, sale_value_cents_snapshot, created_at, model_slug");
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
      s.apiCostUsdMicros += e.api_cost_usd_micros_snapshot;
      s.saleCents += e.sale_value_cents_snapshot;
    }
    if (!s.lastAt || e.created_at > s.lastAt) s.lastAt = e.created_at;
    byService.set(e.service_slug, s);
  }
  return [...byService.values()].sort((a, b) => b.total - a.total);
}
