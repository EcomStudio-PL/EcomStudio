import "server-only";
import { after } from "next/server";
import type { Client } from "@/lib/services/workspace";
import { driveWorkflowRun } from "@/lib/server/engine/workflow";

/**
 * How much of ONE invocation a workflow run may use. The routes that drive a
 * run declare `maxDuration = 300`; the rest is left for closing the run
 * (results, refund, ledger) after the last provider call returns. This is the
 * INFRASTRUCTURE budget — a run that needs longer simply continues in the next
 * invocation (the browser's next status poll), it is never cut short.
 */
export const INVOCATION_BUDGET_MS = 270_000;

/**
 * Drive a run AFTER the response has been sent: the customer's request returns
 * at once with the run id (no HTTP request hangs on an AI job), and the work
 * continues in the same invocation, in the customer's own session — which the
 * ledger requires to close the run.
 */
export function driveAfterResponse(supabase: Client, runId: string, requestStartedAt: number): void {
  after(async () => {
    try {
      await driveWorkflowRun(supabase, runId, { deadlineAt: requestStartedAt + INVOCATION_BUDGET_MS });
    } catch {
      // The lease expires on its own and the next poll resumes the run; the
      // reconciler refunds anything abandoned. Nothing to report to anyone.
      console.error("[workflow] drive aborted", runId);
    }
  });
}
