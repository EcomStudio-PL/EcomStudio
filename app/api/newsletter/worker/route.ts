import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { runWorkerBatch } from "@/lib/server/newsletter/worker";
import { dispatchToken } from "@/lib/server/server-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One batch is pacing delay plus SMTP round trips, and the worker sizes the
 *  batch to fit inside this rather than the other way round. Sixty seconds is
 *  also the ceiling a Hobby deployment allows. */
export const maxDuration = 60;

/**
 * THE SEND TRIGGER — POST only, and there is deliberately no session path in.
 *
 * /api/cron/mail accepts EITHER a bearer secret OR an ambient admin session, on
 * a GET. That is defensible for what it does: it polls a mailbox, and the worst
 * an accidental extra call achieves is reading the same messages twice.
 *
 * THIS ENDPOINT IS NOT THAT. Behind it is a bulk mailing. An ambient session
 * check means any request carrying an admin cookie can start one — a prefetch,
 * an image tag in a page the admin opens, a CSRF-shaped form post from another
 * origin, a link in a support e-mail. The rows would go out for real, and mail
 * cannot be recalled. So:
 *
 *   · POST only. A GET does not exist here at all, which is what keeps browsers,
 *     prefetchers, link scanners and crawlers away from it by construction
 *     rather than by an authorisation check they might get past;
 *   · two credentials, both of which are values only a server holds:
 *     `Authorization: Bearer <CRON_SECRET>` for the platform scheduler, and
 *     `x-newsletter-token: <dispatch token>` for the in-database pg_cron job
 *     from migration 0095, which cannot set an Authorization header through a
 *     stored secret as conveniently as an ordinary one;
 *   · no cookie, no session, no is_admin(). An operator who wants to send now
 *     presses the button in the panel, which runs the same `runWorkerBatch`
 *     through a server action under their own session — the work is shared, the
 *     door is not.
 *
 * The database client here is ANONYMOUS on purpose. The worker proves who it is
 * to Postgres with the dispatch token through the queue's SECURITY DEFINER
 * functions; it has no user to act as, and giving it one would make the send
 * depend on whose cookie happened to arrive.
 */

/** Constant-time compare. `timingSafeEqual` throws on a length mismatch, which
 *  would itself leak the length, so the lengths are checked first and the
 *  constant-time compare always runs. */
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function bearer(header: string | null): string {
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  return match ? match[1].trim() : "";
}

type Verdict = { ok: true; via: "cron_secret" | "dispatch_token" } | { ok: false; reason: string };

/**
 * Who may start a send. Both credentials are optional in a deployment and at
 * least one must exist — with neither configured this endpoint refuses
 * everybody and says which of the two situations it is, rather than leaving an
 * operator to guess why their scheduler gets a 401.
 */
function authorize(request: Request): Verdict {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const serverToken = dispatchToken();

  const presented = bearer(request.headers.get("authorization"));
  if (cronSecret && presented && equal(presented, cronSecret)) {
    return { ok: true, via: "cron_secret" };
  }

  const header = request.headers.get("x-newsletter-token")?.trim() ?? "";
  if (serverToken && header && equal(header, serverToken)) {
    return { ok: true, via: "dispatch_token" };
  }

  if (!cronSecret && !serverToken) return { ok: false, reason: "no_trigger_credential_configured" };
  return { ok: false, reason: "unauthorized" };
}

export async function POST(request: Request) {
  const verdict = authorize(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });
  }

  // Built exactly the way the public site builds its reader: URL and
  // publishable key, no cookies, no session. Every privileged thing the worker
  // does goes through a token-gated RPC.
  const supabase = createAnonClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

  const run = await runWorkerBatch(supabase);

  /*
    COUNTS AND A REASON CODE, NOTHING ELSE. A scheduler logs this response, and
    a log is the last place an address, a subject line or a mail server's reply
    belongs. `reason` is a machine code; the panel maps it to its own copy.

    200 even for a run that sent nothing: "paused", "no mailbox configured" and
    "nothing due" are states of a working product, and answering 500 would turn
    every one of them into a paging alert for an operator who is not on call.
  */
  return NextResponse.json({
    ok: true,
    via: verdict.via,
    claimed: run.claimed,
    sent: run.sent,
    failed: run.failed,
    skipped: run.skipped,
    paused: run.paused,
    reason: run.reason ?? null,
  });
}
