/** Module stubs for scripts/smart-prompt-tests.ts — each alias points here.
 *  They read and write the in-memory world in ./smart-db. */
import { nextId, smart } from "./smart-db";

/* @/lib/server/server-token */
export function dispatchToken(): string | null { return smart().token; }

/* @/lib/server/prompt-engine */
export async function textCapableBackends() {
  smart().backendCalls.push({ kind: "chain" });
  return smart().chain.map((b) => ({ ...b }));
}

/* @/lib/server/provider-credentials — the vault, already opened. */
export async function readProviderKey(_s: unknown, providerId: string) {
  if (smart().unreadableKey) return null;
  return [...smart().named, ...smart().chain].find((b) => `prov-${b.provider}` === providerId)?.cred.apiKey ?? null;
}

/* @/lib/services/usage — the price is the catalogue's (usage_event_start). */
export async function startUsage(_s: unknown, input: {
  serverToken: string | null; userId: string; workspaceId: string; walletId: string; serviceSlug: string;
  providerSlug?: string; modelSlug?: string; idempotencyKey?: string; metadata?: Record<string, unknown>; creditsCharged?: number;
}): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  const s = smart();
  s.usageCalls.push({ kind: "start", args: { ...input } });
  if (!input.serverToken) return { ok: false, error: "server_unconfigured" };
  if (!s.service || !s.service.enabled) return { ok: false, error: "service_unavailable" };
  if (s.service.maintenance_mode) return { ok: false, error: "maintenance" };
  if (input.idempotencyKey && s.events.some((e) => e.idempotency_key === input.idempotencyKey)) {
    return { ok: false, error: "duplicate_request" };
  }
  const credits = input.creditsCharged ?? s.service.credits_cost;
  if (!s.wallet || s.wallet.balance < credits) return { ok: false, error: "insufficient_credits" };
  s.wallet.balance -= credits;
  const id = nextId("evt");
  s.events.push({
    id, status: "pending", credits_charged: credits, idempotency_key: input.idempotencyKey ?? null,
    metadata: { ...(input.metadata ?? {}) }, workspace_id: input.workspaceId, service_slug: input.serviceSlug,
    refunded: false, api_cost: null,
  });
  return { ok: true, eventId: id };
}

export async function completeUsage(_s: unknown, token: string | null, eventId: string, resultCount: number, cost?: Record<string, unknown>) {
  const s = smart();
  s.usageCalls.push({ kind: "complete", args: { eventId, resultCount, ...(cost ?? {}) } });
  const e = s.events.find((x) => x.id === eventId);
  if (!token || !e || e.status !== "pending") return;
  e.status = "succeeded";
  e.api_cost = typeof cost?.apiCostUsdMicros === "number" ? cost.apiCostUsdMicros : null;
  e.executor = cost?.executor;
  // 0101: the key is released on completion.
  e.idempotency_key = null;
}

export async function failUsage(_s: unknown, input: { serverToken: string | null; eventId: string; walletId: string; error: string; apiCostUsdMicros?: number }) {
  const s = smart();
  s.usageCalls.push({ kind: "fail", args: { ...input } });
  const e = s.events.find((x) => x.id === input.eventId);
  if (!input.serverToken || !e || e.status !== "pending" || e.refunded) return;
  e.status = "failed";
  e.refunded = true;
  e.error = input.error;
  if (s.wallet) s.wallet.balance += e.credits_charged;
}

/* @/lib/server/ai-usage */
type Attempt = { provider: string; model: string; ok: boolean; durationMs: number; error?: string; inputTokens?: number; outputTokens?: number };
export function textMeter(_db: unknown, ctx: Record<string, unknown>) {
  const seen: Attempt[] = [];
  let pending: Attempt[] = [];
  return {
    wrap<B extends { meter?: (a: Attempt) => void }>(backends: B[]): B[] {
      return backends.map((b) => ({ ...b, meter: (a: Attempt) => { seen.push(a); pending.push(a); } }));
    },
    attempts: () => [...seen],
    async flush() {
      const batch = pending; pending = [];
      smart().providerCalls.push(...batch.map((a) => ({ ...ctx, ...a })));
      return batch.length;
    },
  };
}
export async function readTokenPrices() { return smart().prices; }
