import "server-only";
import type { Client } from "@/lib/services/workspace";
import { ProviderError } from "@/lib/ai/types";
import { dispatchToken } from "@/lib/server/integrations";

/**
 * PROVIDER ROUTER SUPPORT — rate limiting, retry pacing and health memory.
 *
 * The generation path calls one provider at a time; this module decides how
 * fast, how often and whether at all:
 *  - a per-provider limiter caps concurrent upstream calls and enforces a
 *    minimum gap between them (per serverless instance — the client-side
 *    batch cap of 2 keeps the global pressure bounded),
 *  - retries use exponential backoff with jitter and honour the provider's
 *    own Retry-After when it sends one,
 *  - quota/auth failures are remembered in provider_health so the next
 *    generation skips a dead provider instead of paying for the same error.
 */

/* ── rate limiter ──────────────────────────────────────────────────────── */

type Lane = { active: number; lastStart: number; waiters: (() => void)[] };
const LIMITS: Record<string, { concurrent: number; minGapMs: number }> = {
  openai: { concurrent: 2, minGapMs: 400 },
  google: { concurrent: 2, minGapMs: 800 },
  fal: { concurrent: 2, minGapMs: 400 },
};
const DEFAULT_LIMIT = { concurrent: 2, minGapMs: 500 };
const lanes = new Map<string, Lane>();

function lane(slug: string): Lane {
  let l = lanes.get(slug);
  if (!l) { l = { active: 0, lastStart: 0, waiters: [] }; lanes.set(slug, l); }
  return l;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` inside the provider's lane: bounded concurrency + paced starts. */
export async function withProviderLimit<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const limit = LIMITS[slug] ?? DEFAULT_LIMIT;
  const l = lane(slug);
  while (l.active >= limit.concurrent) {
    await new Promise<void>((resolve) => l.waiters.push(resolve));
  }
  l.active++;
  const gap = l.lastStart + limit.minGapMs - Date.now();
  if (gap > 0) await sleep(gap);
  l.lastStart = Date.now();
  try {
    return await fn();
  } finally {
    l.active--;
    l.waiters.shift()?.();
  }
}

/* ── retry pacing ──────────────────────────────────────────────────────── */

export const MAX_ATTEMPTS_PER_PROVIDER = 3;

/**
 * The default ceiling for ONE provider call: the OpenAI image adapter's own
 * AbortSignal.timeout plus a little for the round trip around it.
 *
 * IT IS A DEFAULT, NOT A UNIVERSAL TRUTH, and the comment here used to claim
 * otherwise — "the slowest single provider call this codebase can make". It
 * is not: the Google adapter issues `quantity` requests in sequence, so its
 * worst case scales with the quantity and can exceed this several times over.
 * An adapter that does not fit this shape declares `worstCaseMs()` and the
 * runner asks it instead.
 */
export const PROVIDER_CALL_BUDGET_MS = 185_000;

/** What the provider loop may spend inside a 300 s route, leaving ~60 s for
 *  storage, derivatives, bookkeeping — and, the point of the budget, the
 *  refund. Three attempts × a 180 s timeout is 540 s, and no route that
 *  reaches the loop survives past 300 s, so without a deadline the function
 *  is killed mid-attempt and the charge it already took is left with nobody
 *  to close it. */
export const GENERATION_BUDGET_MS = 240_000;

/** Does a WHOLE provider call still fit before the deadline? Starting an
 *  attempt that cannot finish is how the budget gets overrun. Exported so the
 *  rule can be tested without standing up a generation. */
export function fitsInBudget(now: number, deadlineAt: number, callMs = PROVIDER_CALL_BUDGET_MS): boolean {
  return now + callMs <= deadlineAt;
}

/** Exponential backoff with jitter; the provider's own Retry-After wins. */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000) + Math.random() * 500;
  const base = 1500 * Math.pow(2, attempt - 1); // 1.5s, 3s, 6s…
  return Math.min(base, 15_000) + Math.random() * 750;
}

export { sleep };

/* ── provider health ───────────────────────────────────────────────────── */

export type ProviderHealthRow = {
  provider_slug: string;
  state: "healthy" | "rate_limited" | "quota_exhausted" | "auth_error" | "degraded" | "down";
  cooldown_until: string | null;
  note: string | null;
  updated_at: string;
};

export async function getProviderHealth(supabase: Client): Promise<Map<string, ProviderHealthRow>> {
  const { data } = await supabase.from("provider_health").select("*");
  return new Map(((data ?? []) as ProviderHealthRow[]).map((r) => [r.provider_slug, r]));
}

/** Inside its cooldown a provider is skipped — but only while an alternative
 *  exists; the router never refuses to try the last provider standing. */
export function providerBlocked(health: Map<string, ProviderHealthRow>, slug: string): boolean {
  const row = health.get(slug);
  if (!row || row.state === "healthy") return false;
  if (!row.cooldown_until) return row.state === "auth_error" || row.state === "quota_exhausted";
  return new Date(row.cooldown_until).getTime() > Date.now();
}

/** Remember what a failure taught us about the provider. */
export async function recordProviderFailure(supabase: Client, slug: string, error: ProviderError): Promise<void> {
  const note = [error.providerCode, error.upstream?.status].filter(Boolean).join(" http=");
  if (error.safeMessage === "provider_quota") {
    await supabase.rpc("provider_health_set", {
      p_token: dispatchToken(),
      p_slug: slug, p_state: "quota_exhausted", p_cooldown_seconds: 1800, p_note: note || "quota",
    });
  } else if (error.safeMessage === "provider_auth_failed") {
    await supabase.rpc("provider_health_set", {
      p_token: dispatchToken(),
      p_slug: slug, p_state: "auth_error", p_cooldown_seconds: 1800, p_note: note || "auth",
    });
  } else if (error.safeMessage === "provider_rate_limited") {
    const cooldown = Math.min(Math.max(Math.round((error.upstream?.retryAfterMs ?? 60_000) / 1000), 30), 600);
    await supabase.rpc("provider_health_set", {
      p_token: dispatchToken(),
      p_slug: slug, p_state: "rate_limited", p_cooldown_seconds: cooldown, p_note: note || "429",
    });
  }
}

export async function recordProviderSuccess(supabase: Client, slug: string): Promise<void> {
  await supabase.rpc("provider_health_set", { p_token: dispatchToken(), p_slug: slug, p_state: "healthy", p_cooldown_seconds: 0 });
}
