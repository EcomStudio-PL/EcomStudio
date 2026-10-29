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
import { HARD_END_MS, INVOCATION_BUDGET_MS, advanceGrovshotRun } from "@/lib/server/grovshot-v2/run";

/**
 * GROVBASE SHOT V2 — WHO DRIVES AN ORDER. Nobody has to keep a page open.
 *
 * The request that starts an order also drives it, after its response
 * (`after()`, within the route's 300 s). When that invocation's time is up
 * and work remains, it hands the order to the NEXT invocation itself: one
 * request to this deployment's own drive route, carrying the customer's
 * session token (the ledger acts only in the customer's session) and a
 * server-only signature over the run id, so nothing but this server can
 * start a hop. The chain ends when the order is finished, when another
 * driver holds it, or when the session token is about to expire — after
 * which any page the customer opens resumes it (GET /api/generations/active),
 * exactly as before.
 *
 * The run's lease is the one guarantee: one driver at a time; a paid unit is
 * never executed twice; a unit whose invocation died is recovered from what
 * it left, never re-sent.
 */

const CHAIN_HEADER = "x-grovshot-chain";
/** A hop is only made while the token outlives a whole invocation. */
const TOKEN_MIN_LEFT_S = 320;

export function chainSignature(runId: string): string {
  return createHmac("sha256", dispatchToken() ?? "").update(`grovshot-v2-chain:${runId}`).digest("hex");
}

export function chainSignatureOk(runId: string, presented: string | null): boolean {
  if (!dispatchToken()) return false;
  return secretMatches(presented ?? "", chainSignature(runId));
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

export type Chain = { origin: string; token: string } | null;

async function hop(runId: string, chain: NonNullable<Chain>): Promise<void> {
  if (tokenSecondsLeft(chain.token) < TOKEN_MIN_LEFT_S || !dispatchToken()) return;
  try {
    await fetch(`${chain.origin}/api/grovshot/runs/${runId}/drive`, {
      method: "POST",
      headers: { authorization: `Bearer ${chain.token}`, [CHAIN_HEADER]: chainSignature(runId) },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    // The order waits for the customer's next page instead.
  }
}

export function driveGrovshotAfterResponse(
  supabase: Client, userId: string, workspaceId: string, runId: string, requestStartedAt: number, chain: Chain,
): void {
  after(async () => {
    try {
      const r = await advanceGrovshotRun(supabase, userId, workspaceId, runId, {
        deadlineAt: requestStartedAt + INVOCATION_BUDGET_MS, hardEndAt: requestStartedAt + HARD_END_MS,
      });
      if (r === "yield" && chain) await hop(runId, chain);
    } catch {
      console.error("[grovshot-v2] drive aborted", runId.slice(0, 8));
    }
  });
}

export { CHAIN_HEADER };
