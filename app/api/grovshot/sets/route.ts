import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { readSets } from "@/lib/server/grovshot-shot/sets";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** GROVBASE SHOT — the member's own sets (closed vocabulary + their library rows). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  const sets = await readSets(supabase, workspace.id, 10);
  if (!sets) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  // An open order or regeneration nobody drives right now is picked up again after the answer.
  const { data: active } = await supabase.rpc("grovshot_runs_active", { p_workspace_id: workspace.id });
  for (const r of (Array.isArray(active) ? active : []) as { id?: string; driving?: boolean }[]) {
    if (r.id && !r.driving) driveGrovshotAfterResponse(user.id, workspace.id, r.id, Date.now(), { origin: new URL(request.url).origin });
  }
  return NextResponse.json({ ok: true, sets }, { headers: { "Cache-Control": "no-store" } });
}
