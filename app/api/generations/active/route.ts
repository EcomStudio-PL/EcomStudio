import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { parseTrack, readInflight } from "@/lib/server/inflight";
import { driveThumbnailAfterResponse } from "@/lib/server/thumbnail/drive";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
// A Miniaturka run nobody is driving is resumed after the answer (below).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GENERACJE W TOKU V2 — the customer's generations in progress, for the
 * tiles on every page (a tool's gallery, the library, the tab title).
 *
 *   GET ?track=job:<id>,run:<id>   in progress now, plus what became of the
 *                                   ones the page is still showing (their
 *                                   results, or the failure and whether the
 *                                   credits came back), the plan's limit and
 *                                   the balance.
 *
 * It never starts or charges anything. The one thing it does besides reading
 * is what the run's own status read always did: a Miniaturka run the
 * customer already started that NOBODY is driving right now (its last
 * invocation used up its time) is picked up again after this answer — so a
 * long run keeps moving while the customer is anywhere in the app. The run's
 * lease allows one driver; a paid step is never executed twice. The browser
 * asks only while something is in progress (lib/inflight/store.ts).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  const track = parseTrack(new URL(request.url).searchParams.get("track"));
  const startedAt = Date.now();
  try {
    const { undrivenRuns, ...snapshot } = await readInflight(supabase, user.id, workspace.id, track);
    const { undrivenV2, ...body } = snapshot;
    for (const runId of undrivenRuns.slice(0, 3)) driveThumbnailAfterResponse(supabase, user.id, workspace.id, runId, startedAt);
    // GrovShot V2: at most ONE order per poll (each one can hold the image
    // lane for a whole invocation), with this request's fresh session token
    // so the order can continue on its own after the page is closed.
    if (undrivenV2.length > 0) {
      const { data: { session } } = await supabase.auth.getSession();
      driveGrovshotAfterResponse(supabase, user.id, workspace.id, undrivenV2[0], startedAt,
        session?.access_token ? { origin: new URL(request.url).origin, token: session.access_token } : null);
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
