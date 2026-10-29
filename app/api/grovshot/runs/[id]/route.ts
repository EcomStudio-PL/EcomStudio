import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
// A read of an order nobody is driving picks it up again, after the answer.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GROVBASE SHOT V2 — the customer's view of their own order (closed
 *  vocabulary, built in SQL: grovshot_run_status). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const { data, error } = await supabase.rpc("grovshot_run_status", { p_run_id: id });
  if (error) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  if (!data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const run = data as { status?: string; driving?: boolean };
  if ((run.status === "queued" || run.status === "running") && !run.driving) {
    const workspace = await getCurrentWorkspace(supabase, user.id);
    if (workspace) driveGrovshotAfterResponse(user.id, workspace.id, id, startedAt, { origin: new URL(request.url).origin });
  }
  return NextResponse.json({ ok: true, run: data }, { headers: { "Cache-Control": "no-store" } });
}
