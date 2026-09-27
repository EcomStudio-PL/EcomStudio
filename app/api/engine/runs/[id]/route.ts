import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { driveAfterResponse } from "@/lib/server/engine/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A WORKFLOW RUN'S STATUS, for the customer who started it.
 *
 * Read through `ai_engine_run_status`, which answers only for the caller's
 * own run in a workspace they belong to: status, progress, result paths, a
 * safe error code. Never a step, a model, a step output or a prompt — those
 * stay admin-only.
 *
 * Polling also KEEPS THE RUN MOVING: a run that nobody is driving right now
 * (the previous invocation ran out of time, or died) is picked up again after
 * this response is sent. The lease guarantees only one driver at a time, and
 * a step that already succeeded is never executed (or paid for) twice.
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

  const { data, error } = await supabase.rpc("ai_engine_run_status", { p_run_id: id });
  const run = (error ? null : data) as {
    status?: string; progress?: { done?: number; total?: number; step?: number; steps?: number; failed?: number };
    outputs?: { path?: string }[]; error?: string | null; credits?: number | null; driving?: boolean;
  } | null;
  if (!run?.status) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const active = run.status === "queued" || run.status === "running";
  if (active && !run.driving) driveAfterResponse(supabase, id, startedAt);

  // Results are signed with the CUSTOMER's session: storage policies decide,
  // so a path outside their workspace cannot be signed here.
  const images: { url: string; path: string }[] = [];
  const paths = (run.outputs ?? []).map((o) => o.path).filter((p): p is string => typeof p === "string");
  if (!active && paths.length) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.signedUrl && s.path) images.push({ url: s.signedUrl, path: s.path });
  }

  const p = run.progress ?? {};
  return NextResponse.json({
    ok: true,
    status: run.status,
    progress: {
      step: p.step ?? 0, steps: p.steps ?? 0,
      done: p.done ?? 0, total: p.total ?? 1, failed: p.failed ?? 0,
    },
    images,
    credits: run.credits ?? 0,
    error: active || run.status === "ok" ? null : run.error ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
