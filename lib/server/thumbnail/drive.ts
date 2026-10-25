import "server-only";
import { after } from "next/server";
import type { Client } from "@/lib/services/workspace";
import { INVOCATION_BUDGET_MS, advanceThumbnailRun } from "@/lib/server/thumbnail/run";

/**
 * GENERACJE W TOKU V2 — Miniaturka no longer waits for the panel to drive it.
 *
 * The run used to move only while its own screen kept POSTing: leave the
 * page and it sat still until you came back. Now the request that STARTS it
 * also drives it, after the response (`after()` — the platform keeps the
 * invocation alive for the work, within the route's maxDuration), and every
 * status read of a run that nobody is driving picks it up again the same
 * way. The run's lease is the one guarantee that matters and it is
 * unchanged: one driver at a time, a paid step never executed twice, a step
 * whose invocation died recovered from what it left — never re-sent.
 *
 * Still in the CUSTOMER's session (the ledger requires it): the session of
 * the request that triggered the drive.
 */
export function driveThumbnailAfterResponse(
  supabase: Client, userId: string, workspaceId: string, runId: string, requestStartedAt: number,
): void {
  after(async () => {
    try {
      await advanceThumbnailRun(supabase, userId, workspaceId, runId, { deadlineAt: requestStartedAt + INVOCATION_BUDGET_MS });
    } catch {
      // The lease expires on its own and the next status read resumes it.
      console.error("[thumbnail] drive aborted", runId);
    }
  });
}
