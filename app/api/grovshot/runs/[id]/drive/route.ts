import { NextResponse } from "next/server";
import { bearerToken } from "@/lib/server/cron-auth";
import { readBlockState } from "@/lib/server/account-block";
import { getCurrentWorkspaceFresh } from "@/lib/services/workspace";
import { CHAIN_HEADER, bearerClient, chainSignatureOk, driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GROVBASE SHOT V2 — THE NEXT INVOCATION OF AN ORDER, started by the server
 * itself (lib/server/grovshot-v2/drive.ts). POST only. Two credentials, both
 * required: the server-only signature over the run id (so no browser, link
 * or prefetch can start one) and the customer's own session token (the
 * ledger acts only in the customer's session; RLS and the run's own checks
 * do the rest — the driver refuses a run that is not this user's).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  if (!UUID.test(id) || !chainSignatureOk(id, request.headers.get(CHAIN_HEADER))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const supabase = bearerClient(token);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const block = await readBlockState(supabase, user.id).catch(() => null);
  if (!block || block.blocked) return NextResponse.json({ ok: false, error: "account_blocked" }, { status: 403 });
  const workspace = await getCurrentWorkspaceFresh(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  driveGrovshotAfterResponse(supabase, user.id, workspace.id, id, startedAt, { origin: new URL(request.url).origin, token });
  return NextResponse.json({ ok: true }, { status: 202 });
}
