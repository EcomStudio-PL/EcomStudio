import { NextResponse } from "next/server";
import { dispatchToken } from "@/lib/server/server-token";
import { bearerToken, secretMatches } from "@/lib/server/cron-auth";
import { driveDueOrders } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GROVBASE SHOT V2 — THE WORKER. POST only, no session: the pg_cron tick
 * (0163, every minute, a no-op while every order has a driver) presents the
 * dispatch token in `x-grovshot-token`; a platform cron may present
 * CRON_SECRET as a bearer. It picks up the orders nobody holds — oldest
 * first, a few at a time — and drives them after the response.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const serverToken = dispatchToken() ?? "";
  const viaCron = Boolean(cronSecret) && secretMatches(bearerToken(request.headers.get("authorization")), cronSecret);
  const viaToken = Boolean(serverToken) && secretMatches(request.headers.get("x-grovshot-token")?.trim() ?? "", serverToken);
  if (!viaCron && !viaToken) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const picked = await driveDueOrders(startedAt, new URL(request.url).origin);
  return NextResponse.json({ ok: true, picked }, { status: 202 });
}
