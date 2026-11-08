import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { startShotRegen } from "@/lib/server/grovshot-v2/start-shot";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GROVBASE SHOT — "Wygeneruj ponownie" for ONE shot of the member's own set:
 * the same prompt and references, a new generation at the price the customer
 * confirmed (`quotedTotal`), charged only when the image is delivered.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const blocked = await featureBlockedForApi(supabase, "prompts") ?? await featureBlockedForApi(supabase, "generator");
  if (blocked) return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blocked }, { status: 503 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });
  let body: { shot?: unknown; quotedTotal?: unknown; requestId?: unknown } = {};
  try { body = await request.json(); } catch { /* validated below */ }
  const result = await startShotRegen(supabase, user.id, workspace.id, id, Number(body.shot), body.quotedTotal,
    typeof body.requestId === "string" ? body.requestId : null);
  if (result.ok) driveGrovshotAfterResponse(user.id, workspace.id, result.runId, startedAt, { origin: new URL(request.url).origin });
  const status = result.ok ? 202 : result.error === "insufficient_credits" ? 402 : result.error === "not_found" ? 404
    : result.error === "price_changed" || result.error === "order_in_progress" || result.error === "engine_v1" ? 409
      : result.error === "too_many_runs" || result.error === "rate_limited" || result.error === "concurrency_limit" ? 429 : 400;
  const { blockers: _b, ...safe } = result as typeof result & { blockers?: string[] };
  return NextResponse.json(safe, { status });
}
