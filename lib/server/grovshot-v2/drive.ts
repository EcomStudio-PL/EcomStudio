import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import { createClient as createSupabase } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { fetchWithSkewRetry } from "@/lib/supabase/skew-retry";
import { dispatchToken } from "@/lib/server/server-token";
import { secretMatches } from "@/lib/server/cron-auth";
import { HARD_END_MS, INVOCATION_BUDGET_MS, advanceGrovshotRun, type AdvanceResult } from "@/lib/server/grovshot-v2/run";

/**
 * GROVBASE SHOT V2 — WHO DRIVES AN ORDER. Nobody has to keep a page open.
 *
 * The request that starts an order also drives it, after its response
 * (`after()`, within the route's 300 s). When that invocation's time is up
 * and work remains, it hands the order to the NEXT invocation itself: one
 * request to this deployment's own drive route, carrying the customer's
 * session token (the ledger acts only in the customer's session) and a
 * server-only signature over the run id, so nothing but this server can
 * start a hop. The invocation that hands over has just released the run
 * (a short lease the database will not let go below 10 s); the hop waits
 * that lease out and claims, a few times, instead of giving up on the first
 * refusal. An invocation that could begin nothing (`stalled`: the database or
 * a key unreadable for the moment) hands over LATER, each time later, and
 * only a few times in a row — the count, signed with the run id, travels
 * with the hop and starts again once work is done. The chain ends when the
 * order is finished, when another driver keeps it, after those stalls, or
 * when the session token is about to expire — after which any page the
 * customer opens resumes it (GET /api/generations/active).
 *
 * The run's lease is the one guarantee: one driver at a time; a paid unit is
 * never executed twice; a unit whose invocation died is recovered from what
 * it left, never re-sent.
 */

const CHAIN_HEADER = "x-grovshot-chain";
/** Stalled invocations in a row before this hop (signed with the run id). */
const STALL_HEADER = "x-grovshot-stalls";
/** A hop is only made while the token outlives a whole invocation. */
const TOKEN_MIN_LEFT_S = 320;
/** How long a stalled invocation waits before handing over, by how many
 *  stalled in a row before it; after the last, the order waits for a page. */
export const STALL_WAITS_MS = [30_000, 60_000, 90_000, 120_000] as const;

export function chainSignature(runId: string, stalls = 0): string {
  return createHmac("sha256", dispatchToken() ?? "")
    .update(stalls > 0 ? `grovshot-v2-chain:${runId}:${stalls}` : `grovshot-v2-chain:${runId}`).digest("hex");
}

/** The stall count a hop presents (0 when absent), or null when malformed. */
export function parseStalls(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  if (!/^\d$/.test(raw)) return null;
  const n = Number(raw);
  return n <= STALL_WAITS_MS.length ? n : null;
}

export function chainSignatureOk(runId: string, presented: string | null, stalls = 0): boolean {
  if (!dispatchToken()) return false;
  return secretMatches(presented ?? "", chainSignature(runId, stalls));
}

/** Seconds left on a Supabase access token (0 when unreadable). */
export function tokenSecondsLeft(token: string, nowMs = Date.now()): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? Math.floor(payload.exp - nowMs / 1000) : 0;
  } catch {
    return 0;
  }
}

/** A database client acting as the holder of `token` (RLS and auth.uid()
 *  as that user) — the anon key, never a service key. */
export function bearerClient(token: string): Client {
  return createSupabase<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchWithSkewRetry() },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as Client;
}

export type Chain = { origin: string; token: string; stalls?: number } | null;

async function hop(runId: string, chain: NonNullable<Chain>, stalls: number): Promise<void> {
  if (tokenSecondsLeft(chain.token) < TOKEN_MIN_LEFT_S || !dispatchToken()) return;
  try {
    await fetch(`${chain.origin}/api/grovshot/runs/${runId}/drive`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${chain.token}`, [CHAIN_HEADER]: chainSignature(runId, stalls),
        ...(stalls > 0 ? { [STALL_HEADER]: String(stalls) } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    // The order waits for the customer's next page instead.
  }
}

/** How long a hop waits for the lease the previous invocation released
 *  (10 s after a yield, 60 s after "busy"), and how often it asks. */
export const HOP_CLAIM_WAIT_MS = 12_000;
export const HOP_CLAIM_TRIES = 6;

/** Advance the run; when the lease is still held (`locked`) and `awaitLease`
 *  is set, wait it out and claim again a few times. Exported for tests. */
export async function advanceWhenFree(
  advance: () => Promise<AdvanceResult>, opts: { awaitLease: boolean; wait: (ms: number) => Promise<void> },
): Promise<AdvanceResult> {
  let r = await advance();
  for (let i = 1; opts.awaitLease && r === "locked" && i < HOP_CLAIM_TRIES; i++) {
    await opts.wait(HOP_CLAIM_WAIT_MS);
    r = await advance();
  }
  return r;
}

/** After an invocation: hand over now (work was done), later (it stalled —
 *  `stalls` before it), or not at all. Exported for tests. */
export async function handOver(
  r: AdvanceResult, stalls: number, go: (stalls: number) => Promise<void>, wait: (ms: number) => Promise<void>, maxWaitMs: number,
): Promise<void> {
  if (r === "yield" || r === "busy") return go(0);
  if (r !== "stalled" || stalls >= STALL_WAITS_MS.length) return;
  await wait(Math.max(0, Math.min(STALL_WAITS_MS[stalls], maxWaitMs)));
  return go(stalls + 1);
}

export function driveGrovshotAfterResponse(
  supabase: Client, userId: string, workspaceId: string, runId: string, requestStartedAt: number, chain: Chain,
  opts: { awaitLease?: boolean } = {},
): void {
  after(async () => {
    try {
      const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
      const r = await advanceWhenFree(() => advanceGrovshotRun(supabase, userId, workspaceId, runId, {
        deadlineAt: requestStartedAt + INVOCATION_BUDGET_MS, hardEndAt: requestStartedAt + HARD_END_MS,
      }), { awaitLease: opts.awaitLease === true, wait });
      // Work remains: the next invocation takes over without waiting for a
      // page — at once after work, later after a stall (within this route's
      // own time, the hop's request included).
      if (chain) {
        await handOver(r, chain.stalls ?? 0, (stalls) => hop(runId, chain, stalls), wait,
          requestStartedAt + HARD_END_MS - 15_000 - Date.now());
      }
    } catch {
      console.error("[grovshot-v2] drive aborted", runId.slice(0, 8));
    }
  });
}

export { CHAIN_HEADER, STALL_HEADER };
