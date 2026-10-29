import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import { dispatchToken } from "@/lib/server/server-token";
import { secretMatches } from "@/lib/server/cron-auth";
import { serverClient, srvDue } from "@/lib/server/grovshot-v2/srv";
import { HARD_END_MS, INVOCATION_BUDGET_MS, advanceGrovshotRun, type AdvanceResult } from "@/lib/server/grovshot-v2/run";

/**
 * GROVBASE SHOT V2 — WHO DRIVES AN ORDER. Nobody has to keep a page open,
 * and nobody's session has to stay valid.
 *
 * The order is accepted in the customer's own session (the start route:
 * account, workspace, quote, credits). From then on every step runs in the
 * SERVER context (srv.ts, migration 0163): the server's own client, the
 * order's id and the lease of the invocation that holds it — never a
 * customer token, so closing Safari or a token expiring changes nothing.
 *
 * Three things start an invocation, all of them inside a request's own time
 * (`after()`, within the route's 300 s — nothing is left running unowned):
 *   · the request that accepted the order (and a page poll, while the order
 *     has no driver);
 *   · the HOP: when an invocation's time is up and work remains, it hands the
 *     order to the next one itself — a request to this deployment's own
 *     drive route signed with a server-only HMAC over the run id (and the
 *     stall count), so nothing but this server can start one;
 *   · the WORKER: a pg_cron tick every minute (0163) wakes /api/grovshot/worker
 *     while an order has no driver — a lost hop, a dead invocation, a stall
 *     that ran out of hops: the order is picked up again, oldest first.
 *
 * The run's lease is the one guarantee: one driver at a time; a paid unit is
 * never executed twice; a unit whose invocation died is recovered from what
 * it left, never re-sent. The order itself ends for good (run.ts: the
 * definitive end) — the hops and the worker never keep it alive for ever.
 */

const CHAIN_HEADER = "x-grovshot-chain";
/** Stalled invocations in a row before this hop (signed with the run id). */
const STALL_HEADER = "x-grovshot-stalls";
/** How long a stalled invocation waits before handing over, by how many
 *  stalled in a row before it; after the last, the worker picks it up. */
export const STALL_WAITS_MS = [30_000, 60_000, 90_000, 120_000] as const;
/** Orders one worker invocation drives side by side. */
export const WORKER_BATCH = 2;

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

/** Where the next invocation is asked for (this deployment's own origin). */
export type Chain = { origin: string; stalls?: number } | null;

async function hop(runId: string, chain: NonNullable<Chain>, stalls: number): Promise<void> {
  if (!dispatchToken()) return;
  try {
    await fetch(`${chain.origin}/api/grovshot/runs/${runId}/drive`, {
      method: "POST",
      headers: { [CHAIN_HEADER]: chainSignature(runId, stalls), ...(stalls > 0 ? { [STALL_HEADER]: String(stalls) } : {}) },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    // The worker's next tick picks the order up instead.
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

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** One invocation of one order in the server context, then the hand-over. */
async function driveOne(
  userId: string, workspaceId: string, runId: string, requestStartedAt: number, chain: Chain, awaitLease: boolean,
): Promise<void> {
  const supabase = serverClient();
  if (!supabase) { console.error("[grovshot-v2] no server token; order waits", runId.slice(0, 8)); return; }
  const r = await advanceWhenFree(() => advanceGrovshotRun(supabase, userId, workspaceId, runId, {
    deadlineAt: requestStartedAt + INVOCATION_BUDGET_MS, hardEndAt: requestStartedAt + HARD_END_MS,
  }), { awaitLease, wait });
  // Work remains: the next invocation takes over without waiting for the
  // worker — at once after work, later after a stall (within this route's
  // own time, the hop's request included).
  if (chain) {
    await handOver(r, chain.stalls ?? 0, (stalls) => hop(runId, chain, stalls), wait,
      requestStartedAt + HARD_END_MS - 15_000 - Date.now());
  }
}

/** Drive an order after this request's response. `userId`/`workspaceId` are
 *  the order's owner as verified when it was accepted (the run refuses any
 *  other); no session of theirs is used. */
export function driveGrovshotAfterResponse(
  userId: string, workspaceId: string, runId: string, requestStartedAt: number, chain: Chain,
  opts: { awaitLease?: boolean } = {},
): void {
  after(async () => {
    try {
      await driveOne(userId, workspaceId, runId, requestStartedAt, chain, opts.awaitLease === true);
    } catch {
      console.error("[grovshot-v2] drive aborted", runId.slice(0, 8));
    }
  });
}

/** The order's owner, read in the server context (the hop and the worker
 *  know only the run id). Null when it is not an open GrovShot order. */
export async function openOrderOwner(runId: string): Promise<{ userId: string; workspaceId: string } | null> {
  const supabase = serverClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("ai_engine_run_read", { p_token: dispatchToken() ?? "", p_run_id: runId });
  const row = !error && Array.isArray(data) ? data[0] : null;
  if (!row || (row.run_kind !== "grovshot" && row.run_kind !== "grovshot_test")) return null;
  if (row.status !== "queued" && row.status !== "running") return null;
  return row.user_id && row.workspace_id ? { userId: row.user_id, workspaceId: row.workspace_id } : null;
}

/** THE WORKER: the orders nobody drives, a few side by side, after the
 *  response. Returns how many were picked up. */
export async function driveDueOrders(requestStartedAt: number, origin: string): Promise<number> {
  const supabase = serverClient();
  if (!supabase) return 0;
  const due = await srvDue(supabase, WORKER_BATCH);
  if (due.length === 0) return 0;
  after(async () => {
    await Promise.all(due.map((o) => driveOne(o.userId, o.workspaceId, o.id, requestStartedAt, { origin }, false)
      .catch(() => console.error("[grovshot-v2] worker drive aborted", o.id.slice(0, 8)))));
  });
  return due.length;
}

export { CHAIN_HEADER, STALL_HEADER };
