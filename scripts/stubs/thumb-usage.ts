/** The ledger, in memory: one charge per key while pending, a refund once,
 *  closed events immutable (0100/0101 semantics). */
import { db, id } from "./thumb-db";

export async function startUsage(_s: unknown, input: {
  serverToken: string | null; userId: string; workspaceId: string; walletId: string; serviceSlug: string;
  providerSlug?: string; modelSlug?: string; generationJobId?: string; idempotencyKey?: string;
  metadata?: Record<string, unknown>; creditsCharged?: number;
}): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  const d = db();
  d.usageCalls.push({ kind: "start", args: { ...input } });
  if (!input.serverToken) return { ok: false, error: "server_unconfigured" };
  if (input.idempotencyKey && d.events.some((e) => e.idempotency_key === input.idempotencyKey && e.status === "pending")) {
    return { ok: false, error: "duplicate_request" };
  }
  const credits = input.creditsCharged ?? 0;
  if (d.wallet.balance < credits) return { ok: false, error: "insufficient_credits" };
  d.wallet.balance -= credits;
  const eventId = id("evt");
  d.events.push({
    id: eventId, status: "pending", credits_charged: credits, service_slug: input.serviceSlug,
    generation_job_id: input.generationJobId ?? null, idempotency_key: input.idempotencyKey ?? null,
    created_at: new Date(d.now).toISOString(), refunded: 0, api_cost: null,
  });
  return { ok: true, eventId };
}

export async function completeUsage(_s: unknown, serverToken: string | null, eventId: string, resultCount: number, cost?: Record<string, unknown>) {
  const d = db();
  d.usageCalls.push({ kind: "complete", args: { eventId, resultCount, ...(cost ?? {}) } });
  // The real completeUsage swallows its RPC errors: a failed close is silent.
  if (d.faults.has("usage:complete")) return;
  const e = d.events.find((x) => x.id === eventId);
  if (!serverToken || !e || e.status !== "pending") return;
  e.status = "succeeded";
  e.api_cost = cost?.apiCostUsdMicros ?? null;
  e.idempotency_key = null;
}

export async function failUsage(_s: unknown, input: { serverToken: string | null; eventId: string; walletId: string; error: string; apiCostUsdMicros?: number }) {
  const d = db();
  d.usageCalls.push({ kind: "fail", args: { ...input } });
  const e = d.events.find((x) => x.id === input.eventId);
  if (!input.serverToken || !e || e.status !== "pending") return;
  e.status = "refunded";
  e.refunded = e.credits_charged;
  e.idempotency_key = null;
  d.wallet.balance += Number(e.credits_charged);
}

export async function reconcileStaleUsage() { return null; }
