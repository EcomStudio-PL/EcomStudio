import { NextResponse } from "next/server";
import { syncNowAction } from "@/app/actions/mail";

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
  if (!result.ok) {
    // A disabled or unconfigured integration is a state, not a server fault:
    // answering 500 would turn a normal "not set up yet" into a paging alert.
    return NextResponse.json({ ok: false, reason: result.error }, { status: 200 });
  }
  // Counts only. Nothing about the mailbox, the sender, or the credentials ever
  // belongs in a response a scheduler logs.
  return NextResponse.json({ ok: true, found: result.found, sent: result.sent, failed: result.failed });
}
