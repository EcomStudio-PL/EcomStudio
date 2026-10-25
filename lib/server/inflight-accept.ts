import "server-only";
import { after } from "next/server";
import type { GenerationAccepted } from "@/lib/server/generation";

/**
 * GENERACJE W TOKU V2 — ANSWER AT ACCEPTANCE, FINISH AFTER THE RESPONSE.
 *
 * A generation route used to hold the browser's request for the whole
 * generation (40 s, sometimes minutes): the panel was locked, a second click
 * had to wait, and the page could not tell "accepted" from "still loading".
 * Now the route answers the moment `runGeneration` reports the click
 * ACCEPTED — the job exists, the database took the plan's slot, the ledger
 * took the charge — and the very same call keeps going after the response,
 * in the same invocation, in the customer's own session.
 *
 * WHY THIS IS NOT FIRE-AND-FORGET. `after()` hands the promise to the
 * platform (Vercel's `waitUntil`): the function stays alive until the work
 * settles, inside the route's own `maxDuration` — the ceiling the synchronous
 * call already lived under. Nothing new can be cut short: `runGeneration`
 * still plans every attempt against that same ceiling and refunds what it
 * cannot deliver. A browser that closes, refreshes or navigates changes
 * nothing (Vercel does not cancel a Node function on disconnect, and this
 * work no longer depends on the request at all). An invocation that dies
 * anyway leaves exactly what it left before: a `processing` job and a
 * `pending` usage event, which the reconciler (0102) settles — delivered
 * images kept and priced, the rest refunded once.
 *
 * A call that ends BEFORE acceptance (bad input, no credits, the plan's
 * limit) answers with its own result, synchronously, exactly as before.
 */
export type AcceptedAnswer = {
  ok: true; accepted: true; jobId: string; credits: number; startedAt: string; expected: number;
};

export async function answerAtAcceptance<R>(
  label: string,
  run: (onAccepted: (accepted: GenerationAccepted) => void) => Promise<R>,
  finish?: (result: R) => Promise<void> | void,
): Promise<{ accepted: GenerationAccepted } | { result: R }> {
  type First = { accepted: GenerationAccepted } | { result: R } | { thrown: unknown };
  let settle: (value: First) => void = () => undefined;
  const first = new Promise<First>((resolve) => { settle = resolve; });
  let answered = false;
  const once = (value: First) => {
    if (answered) return;
    answered = true;
    settle(value);
  };
  const work = (async () => {
    try {
      const result = await run((accepted) => once({ accepted }));
      once({ result });
      if (finish) await finish(result);
    } catch (error) {
      // Before acceptance the route rethrows it (as before); after it, the
      // job and its charge are the reconciler's to close.
      const afterAcceptance = answered;
      once({ thrown: error });
      if (afterAcceptance) console.error(`[${label}] generation aborted after acceptance`);
    }
  })();
  after(() => work);
  const value = await first;
  if ("thrown" in value) throw value.thrown;
  return value;
}

/** The browser's answer for an accepted click. */
export function acceptedBody(a: GenerationAccepted): AcceptedAnswer {
  return { ok: true, accepted: true, jobId: a.jobId, credits: a.credits, startedAt: a.startedAt, expected: a.quantity };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A browser-supplied id (the click's batch, the request), or null. */
export function clientId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
