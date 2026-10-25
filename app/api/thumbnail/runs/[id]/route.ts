import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { INVOCATION_BUDGET_MS, advanceThumbnailRun } from "@/lib/server/thumbnail/run";
import { readThumbnailRun } from "@/lib/server/thumbnail/status";
import { driveThumbnailAfterResponse } from "@/lib/server/thumbnail/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ONE MINIATURKA RUN, for the member who started it.
 *
 *   GET   its state (stage, each photo's Retusz, the result) — cheap, for
 *         the panel's live view and for a refreshed page. A run that nobody
 *         is driving right now is picked up again after the response
 *         (Generacje w toku V2), so it keeps moving while the customer is on
 *         any page that watches it — the lease still allows one driver.
 *   POST  move it forward: this request claims the run's lease and works for
 *         at most one invocation, in the customer's own session (which the
 *         ledger requires), then answers with the new state. A second tab or
 *         a double click gets the state back without driving ("busy").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const run = await readThumbnailRun(supabase, id);
  if (run === "unavailable") return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  if (!run) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if ((run.status === "queued" || run.status === "running") && !run.driving) {
    const workspace = await getCurrentWorkspace(supabase, user.id);
    if (workspace) driveThumbnailAfterResponse(supabase, user.id, workspace.id, id, startedAt);
  }
  return NextResponse.json({ ok: true, run }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let advanced: Awaited<ReturnType<typeof advanceThumbnailRun>> = "busy";
  try {
    advanced = await advanceThumbnailRun(supabase, user.id, workspace.id, id, { deadlineAt: startedAt + INVOCATION_BUDGET_MS });
  } catch {
    // The lease expires on its own and the next call resumes the run; a step
    // that was in flight is recovered from what it left, never re-sent.
    console.error("[thumbnail] advance aborted", id);
  }
  if (advanced === "not_found") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const run = await readThumbnailRun(supabase, id);
  // A read that failed is retried by the panel (not "not_found", which ends
  // its driving for good).
  if (run === "unavailable") return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  if (!run) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, run, advanced }, { headers: { "Cache-Control": "no-store" } });
}
