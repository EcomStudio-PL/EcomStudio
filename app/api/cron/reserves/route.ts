import { NextResponse } from "next/server";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { dispatchToken } from "@/lib/server/server-token";
import { bearerToken, secretMatches } from "@/lib/server/cron-auth";
import { runReservesTick } from "@/lib/server/api-reserves/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * API RESERVE CENTER — THE SCHEDULED RUN (0180). Woken every 15 minutes by
 * pg_cron through pg_net (`api_reserves_cron_tick`), because Vercel Hobby runs
 * one cron a day. POST only, no session path in: the bearer is the server's
 * dispatch token (what Vault holds for the tick) or CRON_SECRET. Every
 * privileged read and write below goes through a token-gated function; the
 * reply is counts and codes, never an amount or a key.
 */
type Verdict = { ok: true; via: "cron_secret" | "dispatch_token" } | { ok: false; reason: string };

function authorize(request: Request): Verdict {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const serverToken = dispatchToken();
  const presented = bearerToken(request.headers.get("authorization"));
  if (cronSecret && secretMatches(presented, cronSecret)) return { ok: true, via: "cron_secret" };
  if (serverToken && secretMatches(presented, serverToken)) return { ok: true, via: "dispatch_token" };
  if (!cronSecret && !serverToken) return { ok: false, reason: "no_trigger_credential_configured" };
  return { ok: false, reason: "unauthorized" };
}

export async function POST(request: Request) {
  const verdict = authorize(request);
  if (!verdict.ok) return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });
  const supabase = createAnonClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  try {
    const run = await runReservesTick(supabase);
    return NextResponse.json({
      ok: true, via: verdict.via, ran: run.ran, hourly: run.hourly ?? null, daily: run.daily ?? null,
      alerts: run.alerts?.length ?? 0, synced: run.synced ? Object.keys(run.synced).length : 0,
    });
  } catch (e) {
    console.error("cron.reserves", e instanceof Error ? e.message : "error");
    return NextResponse.json({ ok: false, reason: "failed" }, { status: 200 });
  }
}
