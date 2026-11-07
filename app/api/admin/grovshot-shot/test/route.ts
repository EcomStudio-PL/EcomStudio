import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";
import { readShotRuns } from "@/lib/server/grovshot-shot/admin";

export const runtime = "nodejs";
// The test order is driven after the answer (after()), like a customer's.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GROVBASE SHOT → Testy (admins). POST starts a test order on the lifestyle
 * engine through grovshot_shot_test_create (the same database door an
 * operator uses) — "prompts" (Claude only, no image) or "full" (paid Nano
 * Banana Pro calls: refused unless confirmed). Never charged. GET ?run=<id>
 * reads it step by step and keeps the admin's own idle test moving; GET
 * ?list=1 lists the latest lifestyle orders.
 */
async function admin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) } as const;
  return { supabase, adminId: user.id } as const;
}

type Body = {
  photos?: unknown; description?: unknown; notes?: unknown; shots?: unknown; aspectRatio?: unknown; resolution?: unknown;
  kbVersionId?: unknown; mode?: unknown; userPlan?: unknown; confirmed?: unknown; testProductId?: unknown;
};

export async function POST(request: Request) {
  const a = await admin();
  if ("error" in a) return a.error;
  let body: Body;
  try { body = (await request.json()) as Body; } catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  const mode = body.mode === "full" ? "full" : body.mode === "prompts" ? "prompts" : null;
  if (!mode) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  if (mode === "full" && body.confirmed !== true) return NextResponse.json({ ok: false, error: "confirmation_required" }, { status: 400 });
  const workspace = await getCurrentWorkspace(a.supabase, a.adminId);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  const { data, error } = await a.supabase.rpc("grovshot_shot_test_create", {
    p_req: {
      workspace_id: workspace.id, photos: Array.isArray(body.photos) ? body.photos : [], description: typeof body.description === "string" ? body.description : "",
      notes: typeof body.notes === "string" ? body.notes : "", shots: typeof body.shots === "number" ? body.shots : null,
      aspect_ratio: typeof body.aspectRatio === "string" ? body.aspectRatio : "", resolution: typeof body.resolution === "string" ? body.resolution : "",
      kb_version_id: typeof body.kbVersionId === "string" && UUID.test(body.kbVersionId) ? body.kbVersionId : null, mode,
      user_plan: Array.isArray(body.userPlan) && body.userPlan.length ? body.userPlan : null,
      test_product_id: typeof body.testProductId === "string" && UUID.test(body.testProductId) ? body.testProductId : null,
    } as Json,
  });
  const r = (error ? null : data) as { id?: string; created?: boolean; error?: string } | null;
  if (!r?.id) return NextResponse.json({ ok: false, error: r?.error ?? "generic" }, { status: 400 });
  driveGrovshotAfterResponse(a.adminId, workspace.id, r.id, Date.now(), { origin: new URL(request.url).origin });
  return NextResponse.json({ ok: true, runId: r.id, created: Boolean(r.created) }, { status: 202 });
}

export async function GET(request: Request) {
  const a = await admin();
  if ("error" in a) return a.error;
  const url = new URL(request.url);
  if (url.searchParams.get("list") === "1") {
    const runs = await readShotRuns(a.supabase, { limit: 10 }).catch(() => []);
    return NextResponse.json({ ok: true, runs }, { headers: { "Cache-Control": "no-store" } });
  }
  const runId = url.searchParams.get("run") ?? "";
  if (!UUID.test(runId)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  const [run] = await readShotRuns(a.supabase, { ids: [runId], limit: 1 }).catch(() => []);
  if (!run) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { data: row } = await a.supabase.from("ai_engine_runs").select("user_id, workspace_id, locked_until").eq("id", runId).maybeSingle();
  const driving = Boolean(row?.locked_until && Date.parse(row.locked_until) > Date.now());
  if ((run.status === "queued" || run.status === "running") && !driving && row?.user_id === a.adminId && row.workspace_id) {
    driveGrovshotAfterResponse(a.adminId, row.workspace_id, runId, Date.now(), { origin: url.origin });
  }
  return NextResponse.json({ ok: true, run, driving }, { headers: { "Cache-Control": "no-store" } });
}
