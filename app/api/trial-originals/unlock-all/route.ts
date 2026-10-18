import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { rateLimit } from "@/lib/server/rate-limit";
import { isTrialUuid, unlockNextBatch } from "@/lib/server/trial-watermark/unlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Work stops being started this long into a request, leaving room for the
 *  item in flight, the signing call and the answer (R31/R35). */
const BUDGET_MS = 40_000;
const MAX_SKIP = 200;

/**
 * "USUŃ ZNAK WODNY ZE WSZYSTKICH" — ONE BATCH PER REQUEST.
 *
 * POST {bulkId?, skip?} → TrialBulkResult. The first call carries no bulk id
 * and gets one minted here; every next call sends it back with `skip` = the
 * items that failed so far, until `done`. Which items, how many remain and
 * the counts in `watermark_bulk_unlocked` are all the server's: the client
 * only says "next", and which failures not to retry.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const send = (body: unknown, init: { status: number }) => NextResponse.json(body, { ...init, headers: NO_STORE });

export async function POST(request: Request) {
  const started = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return send({ state: "error", error: "unauthenticated" }, { status: 401 });
  const blocked = await accountBlockedResponse(supabase, user.id);
  if (blocked) {
    blocked.headers.set("Cache-Control", "no-store");
    return blocked;
  }
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return send({ state: "error", error: "no_workspace" }, { status: 400 });

  const body = await request.json().catch(() => null) as { bulkId?: unknown; skip?: unknown } | null;
  const bulkIn = body?.bulkId;
  if (bulkIn !== undefined && bulkIn !== null && !isTrialUuid(bulkIn)) {
    return send({ state: "error", error: "invalid_input" }, { status: 400 });
  }
  const skipIn = body?.skip ?? [];
  if (!Array.isArray(skipIn) || skipIn.length > MAX_SKIP || !skipIn.every(isTrialUuid)) {
    return send({ state: "error", error: "invalid_input" }, { status: 400 });
  }
  if (!rateLimit(`trialwm:unlock-all:${user.id}`, 60, 60_000)) {
    return send({ state: "error", error: "rate_limited" }, { status: 429 });
  }

  const result = await unlockNextBatch(supabase, {
    workspaceId: workspace.id,
    bulkId: typeof bulkIn === "string" ? bulkIn.toLowerCase() : randomUUID(),
    skip: [...new Set(skipIn.map((s) => s.toLowerCase()))],
    deadline: started + BUDGET_MS,
  });
  return send(result, { status: 200 });
}
