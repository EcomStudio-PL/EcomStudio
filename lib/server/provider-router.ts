import "server-only";
import type { Client } from "@/lib/services/workspace";
import { ProviderError } from "@/lib/ai/types";

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
    await supabase.rpc("set_provider_health", {
      p_slug: slug, p_state: "quota_exhausted", p_cooldown_seconds: 1800, p_note: note || "quota",
    });
  } else if (error.safeMessage === "provider_auth_failed") {
    await supabase.rpc("set_provider_health", {
      p_slug: slug, p_state: "auth_error", p_cooldown_seconds: 1800, p_note: note || "auth",
    });
  } else if (error.safeMessage === "provider_rate_limited") {
    const cooldown = Math.min(Math.max(Math.round((error.upstream?.retryAfterMs ?? 60_000) / 1000), 30), 600);
    await supabase.rpc("set_provider_health", {
      p_slug: slug, p_state: "rate_limited", p_cooldown_seconds: cooldown, p_note: note || "429",
    });
  }
}

export async function recordProviderSuccess(supabase: Client, slug: string): Promise<void> {
  await supabase.rpc("set_provider_health", { p_slug: slug, p_state: "healthy", p_cooldown_seconds: 0 });
}
