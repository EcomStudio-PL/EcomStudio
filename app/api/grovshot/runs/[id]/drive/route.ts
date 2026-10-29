import { NextResponse } from "next/server";
import {
  CHAIN_HEADER, STALL_HEADER, chainSignatureOk, driveGrovshotAfterResponse, openOrderOwner, parseStalls,
} from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GROVBASE SHOT V2 — THE NEXT INVOCATION OF AN ORDER, started by the server
 * itself (lib/server/grovshot-v2/drive.ts). POST only. The credential is the
 * server-only signature over the run id and the hop's stall count (so no
 * browser, link or prefetch can start one, nor reset the count). No customer
 * session: the order was accepted in theirs; every step from here runs in the
 * server context, scoped by the database to this order and its lease (0163).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  const stalls = parseStalls(request.headers.get(STALL_HEADER));
  if (!UUID.test(id) || stalls === null || !chainSignatureOk(id, request.headers.get(CHAIN_HEADER), stalls)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const owner = await openOrderOwner(id);
  if (!owner) return NextResponse.json({ ok: true, finished: true }, { status: 200 });
  // A hop: the previous invocation has just released the run — wait its
  // short lease out rather than give up on the first refusal.
  driveGrovshotAfterResponse(owner.userId, owner.workspaceId, id, startedAt, { origin: new URL(request.url).origin, stalls }, { awaitLease: true });
  return NextResponse.json({ ok: true }, { status: 202 });
}
