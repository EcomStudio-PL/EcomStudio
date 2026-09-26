import { NextResponse } from "next/server";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { runDaily, errorCode } from "@/lib/server/grovnews/pipeline";
import { dispatchToken } from "@/lib/server/server-token";
import { bearerToken, secretMatches } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Fetching sources and asking a model are slow; the pipeline works to a
 *  budget below this and resumes on the next tick if it runs out. */
export const maxDuration = 300;
const RUN_BUDGET_MS = 240_000;

/**
 * THE GROVNEWS DAILY RUN — POST only, token only, the shape of
 * /api/newsletter/worker on purpose.
 *
 * Behind this door the server downloads the internet and spends AI money, and
 * in AUTOMATIC mode it queues a mailing. So, exactly as for the worker:
 *
 *   · POST only — no GET exists, so no browser, prefetcher, crawler or image
 *     tag can reach it;
 *   · two credentials, both held only by servers: `Authorization: Bearer
 *     <CRON_SECRET>` and `x-grovnews-token: <dispatch token>` (what the
 *     pg_cron tick from migration 0121 sends);
 *   · no cookie, no session, no is_admin() — an admin who wants a run now
 *     presses the button in the panel, which calls the same `runDaily` under
 *     their own session;
 *   · an ANONYMOUS database client: everything privileged goes through
 *     token-gated SECURITY DEFINER functions.
 *
 * A FAILURE IS A 500. "Nothing to do" (disabled, already done, busy) is a 200;
 * an exception is recorded in the run ledger and reported as a failure, so the
 * next tick retries and the panel shows why (ADR "Zadania w tle…").
 */

type Verdict = { ok: true; via: "cron_secret" | "dispatch_token" } | { ok: false; reason: string };

function authorize(request: Request): Verdict {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const serverToken = dispatchToken();

  const presented = bearerToken(request.headers.get("authorization"));
  if (cronSecret && secretMatches(presented, cronSecret)) return { ok: true, via: "cron_secret" };

  const header = request.headers.get("x-grovnews-token")?.trim() ?? "";
  if (serverToken && secretMatches(header, serverToken)) return { ok: true, via: "dispatch_token" };

  if (!cronSecret && !serverToken) return { ok: false, reason: "no_trigger_credential_configured" };
  return { ok: false, reason: "unauthorized" };
}

export async function POST(request: Request) {
  const verdict = authorize(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });
  }

  const supabase = createAnonClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    const run = await runDaily(supabase, "CRON", RUN_BUDGET_MS);
    // Counts and machine codes only — a scheduler logs this response.
    return NextResponse.json({ ok: true, via: verdict.via, status: run.status, reason: run.reason ?? null, stage: run.stage ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: errorCode(e) }, { status: 500 });
  }
}
