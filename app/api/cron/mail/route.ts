import { NextResponse } from "next/server";
import { syncNowAction } from "@/app/actions/mail";
import { runBudgetCheckAction } from "@/app/actions/ai-budgets";
import { expireAccountBlocks } from "@/lib/server/account-blocks";
import { createClient } from "@/lib/supabase/server";
import {
  popularityIsStale, readToolPopularity, refreshToolPopularity,
} from "@/lib/server/tool-popularity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** IMAP handshake, a page of headers and a handful of Telegram round trips.
 *  Well inside this, and inside the 60s a Hobby deployment allows. */
export const maxDuration = 60;

/**
 * THE MAILBOX POLLER — one GET per schedule.
 *
 * Vercel Cron calls this with `Authorization: Bearer <CRON_SECRET>`, so a
 * schedule entry plus that variable is the whole deployment story:
 *
 *   { "crons": [{ "path": "/api/cron/mail", "schedule": "*\/5 * * * *" }] }
 *
 * Until CRON_SECRET exists the endpoint still works for a signed-in admin —
 * which is what the "sync now" button uses — and refuses everyone else. It is
 * never open: an anonymous caller gets 401 either way, with a reason that says
 * which of the two situations it is rather than leaving an operator to guess.
 *
 * ┌ OPERATOR NOTE, AND IT IS THE WHOLE SCHEDULE ──────────────────────────────┐
 * │ CRON_SECRET IS NOT AN OPTIONAL EXTRA. The platform scheduler arrives with │
 * │ no session, so without that variable `syncCaller` answers                 │
 * │ `cron_secret_missing`, this route answers 401 on the line below, and      │
 * │ EVERY job hanging off this schedule — the mailbox, the weekly ranking,    │
 * │ the block sweep — does not run. Not "runs and finds nothing": does not    │
 * │ run.                                                                      │
 * │                                                                           │
 * │ That is the correct refusal, not a bug to design around: with no secret   │
 * │ there is nothing that distinguishes the scheduler from a passer-by, and   │
 * │ an endpoint that spends money must not guess. The fix is one variable in  │
 * │ the deployment, never a weaker gate here.                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The work itself lives in `syncNowAction`, deliberately: the button and the
 * schedule must do the same thing, and the authorisation rule has to exist in
 * exactly one place or the two will drift apart. This route is the HTTP shape
 * around it.
 *
 * Each run: read the mail integration and the INBOX cursor, fetch everything
 * above it, announce each genuinely new message (deduplicated by folder +
 * UIDVALIDITY + UID, so an overlapping run cannot send twice), write the cursor
 * back, then flush whatever else the outbox holds — a waitlist signup queued
 * while Telegram was down goes out here too.
 */

/** Codes that mean "you are not allowed to run this", separated from the codes
 *  that mean "you are, but the mailbox is not ready". */
const UNAUTHORIZED: Record<string, string> = {
  cron_secret_missing: "cron_secret_missing",
  not_admin: "unauthorized",
};

export async function GET() {
  const result = await syncNowAction();

  if (!result.ok && UNAUTHORIZED[result.error]) {
    return NextResponse.json({ ok: false, reason: UNAUTHORIZED[result.error] }, { status: 401 });
  }

  /*
    The caller is authorised from here on, so the housekeeping that has nothing
    to do with the mailbox runs FIRST.

    The tool-popularity ranking is one of those. It is recomputed at most once a
    week — the schedule is daily, the staleness check is what makes it weekly —
    and it must not be skipped just because nobody has configured an inbox yet:
    the global search reads that row on every page load, and a mail integration
    is not a prerequisite for knowing which tools people use.
  */
  const popularity = await refreshPopularityIfDue().catch(() => ({ ok: false as const, reason: "error" }));

  /*
    …and so is clearing expired account blocks. Housekeeping, not enforcement:
    a block that ended at 15:30 stopped applying at 15:30 whether or not this
    ran. All this does is stop the CRM showing a stale "blocked until" on a
    customer who is already working again.

    IT RUNS ABOVE THE MAILBOX CHECK ON PURPOSE. It used to sit below the early
    return, which meant an unconfigured inbox silently cancelled it — two
    unrelated jobs sharing one schedule must not share one failure.
  */
  const blocks = await sweepExpiredBlocks().catch(() => ({ ok: false as const, error: "error" }));

  if (!result.ok) {
    // A disabled or unconfigured integration is a state, not a server fault:
    // answering 500 would turn a normal "not set up yet" into a paging alert.
    return NextResponse.json({
      ok: false, reason: result.error, popularity,
      blocksLifted: blocks.ok ? blocks.lifted : null,
    }, { status: 200 });
  }
  /*
    The same run also checks the provider budgets.
    A monthly spending limit needs a daily glance, not a schedule of its own —
    and one more cron entry is a deployment change for a job that already has
    somewhere to live. It runs AFTER the mailbox so a budget read can never
    delay or fail the message sync, and its own failure is reported rather
    than thrown: the mail result is the reason this endpoint exists.

    KNOWN LIMITATION, stated rather than hidden. This one still goes through a
    server action that opens with requireAdmin(), so on a SCHEDULED run — which
    carries a bearer secret and no session — it reports `{ ok: false }` and
    checks nothing. The admin button works. Giving it the same proof-of-server
    door the sweep above now has means definer reads and writes across every
    provider's budget and its alert markers, which is a wider change than this
    stage is for, on a table that currently holds no rows at all. It is
    recorded as an open finding rather than half-done here.
  */
  const budgets = await runBudgetCheckAction().catch(() => ({ ok: false as const }));

  // Counts only. Nothing about the mailbox, the sender, or the credentials ever
  // belongs in a response a scheduler logs.
  return NextResponse.json({
    ok: true, found: result.found, sent: result.sent, failed: result.failed,
    budgets: budgets.ok ? { checked: budgets.checked, alerted: budgets.alerted } : { ok: false },
    blocksLifted: blocks.ok ? blocks.lifted : null,
    popularity,
  });
}

/**
 * THE EXPIRED-BLOCK SWEEP.
 *
 * Its own client, for the same reason the ranking has one: this route reaches
 * the database through two jobs that are unrelated to each other and to the
 * mailbox, and neither should be able to fail because of the other.
 *
 * The authorisation lives in lib/server/account-blocks.ts, which proves it is
 * the server instead of proving it is a person — an unattended schedule can
 * never be the second thing.
 */
async function sweepExpiredBlocks() {
  const supabase = await createClient();
  return expireAccountBlocks(supabase);
}

/**
 * THE WEEKLY TOOL RANKING.
 *
 * "Co 7 dni przelicz popularność narzędzi" — but a cron entry of its own is a
 * deployment change for a job that already has somewhere to run, so the
 * schedule stays daily and the SEVEN DAYS live in the stored row: the recompute
 * happens only when the last one is at least a week old. That also means a
 * deployment, a re-run or a manual "sync now" cannot churn the ranking.
 *
 * The read is one settings row and the write is a definer RPC, so this costs a
 * single query on the six days out of seven when there is nothing to do.
 */
async function refreshPopularityIfDue(): Promise<
  { ok: true; refreshed: boolean; source: string; sample?: number; measured?: number }
  | { ok: false; reason: string }
> {
  const supabase = await createClient();
  const current = await readToolPopularity(supabase);
  // Measured against the last time the job LOOKED. A week with too little
  // usage to rank is still a week that was checked, so a quiet product does
  // not make this retry every single day.
  if (!popularityIsStale(current.checkedAt, Date.now())) {
    return { ok: true, refreshed: false, source: current.source };
  }
  const result = await refreshToolPopularity(supabase);
  if (!result.ok) return { ok: false, reason: result.error };
  return {
    ok: true, refreshed: true,
    source: result.source, sample: result.sample, measured: result.measured,
  };
}
