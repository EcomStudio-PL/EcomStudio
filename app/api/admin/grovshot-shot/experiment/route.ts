import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import { noStore, UUID } from "@/lib/server/grovshot-shot/guard";
import { createClient } from "@/lib/supabase/server";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
// The experiment is driven after the answer (after()), like any order.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** The role re-checked IN this route (no layout runs for an API call). */
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: noStore }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: noStore }) } as const;
  return { supabase, adminId: user.id } as const;
}

/**
 * GROVBASE SHOT → an admin's experiment on ONE shot (admins only).
 *   POST { sourceRunId, shot, prompt, references:[photo numbers], confirmUsdMicros }
 *     → grovshot_shot_experiment_create (0168): one paid Nano Banana Pro call
 *       at the confirmed price, a test run (never charged, never in the
 *       customer's gallery), within the daily ceiling;
 *   POST { action: "publish", runId }
 *     → grovshot_shot_experiment_publish: the explicit "Dodaj do galerii
 *       klienta" (audited, idempotent).
 */
type Body = { action?: unknown; sourceRunId?: unknown; runId?: unknown; shot?: unknown; prompt?: unknown; references?: unknown; confirmUsdMicros?: unknown };

export async function POST(request: Request) {
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  let body: Body;
  try { body = (await request.json()) as Body; } catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: noStore }); }

  if (body.action === "publish") {
    const runId = typeof body.runId === "string" && UUID.test(body.runId) ? body.runId : null;
    if (!runId) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: noStore });
    const { data, error } = await a.supabase.rpc("grovshot_shot_experiment_publish", { p_run_id: runId });
    const r = (error ? null : data) as { ok?: boolean; error?: string; generation_id?: string; duplicate?: boolean } | null;
    if (!r?.ok) return NextResponse.json({ ok: false, error: error ? "migration_missing_or_failed" : r?.error ?? "generic" }, { status: 400, headers: noStore });
    return NextResponse.json({ ok: true, generationId: r.generation_id ?? null, duplicate: Boolean(r.duplicate) }, { headers: noStore });
  }

  const sourceRunId = typeof body.sourceRunId === "string" && UUID.test(body.sourceRunId) ? body.sourceRunId : null;
  const refs = Array.isArray(body.references) ? body.references.filter((x): x is number => typeof x === "number" && Number.isInteger(x)) : [];
  if (!sourceRunId || typeof body.shot !== "number" || typeof body.prompt !== "string" || refs.length === 0 || typeof body.confirmUsdMicros !== "number") {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: noStore });
  }
  const { data, error } = await a.supabase.rpc("grovshot_shot_experiment_create", {
    p_req: { source_run_id: sourceRunId, shot: body.shot, prompt: body.prompt, references: refs, confirm_usd_micros: Math.round(body.confirmUsdMicros) } as Json,
  });
  const r = (error ? null : data) as { id?: string; created?: boolean; error?: string; estimate_usd_micros?: number; spent_usd_micros?: number; cap_usd_micros?: number } | null;
  if (!r?.id) {
    return NextResponse.json({
      ok: false, error: error ? "migration_missing_or_failed" : r?.error ?? "generic",
      estimateUsdMicros: r?.estimate_usd_micros ?? null, spentUsdMicros: r?.spent_usd_micros ?? null, capUsdMicros: r?.cap_usd_micros ?? null,
    }, { status: 400, headers: noStore });
  }
  const { data: runRow } = await a.supabase.from("ai_engine_runs").select("workspace_id").eq("id", r.id).maybeSingle();
  const ws = (runRow as { workspace_id?: string | null } | null)?.workspace_id;
  if (ws) driveGrovshotAfterResponse(a.adminId, ws, r.id, Date.now(), { origin: new URL(request.url).origin });
  return NextResponse.json({ ok: true, runId: r.id, created: Boolean(r.created), estimateUsdMicros: r.estimate_usd_micros ?? null }, { status: 202, headers: noStore });
}
