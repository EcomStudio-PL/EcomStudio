import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { startGrovshotRun, type StartBody } from "@/lib/server/grovshot-v2/start";
import { driveGrovshotAfterResponse } from "@/lib/server/grovshot-v2/drive";

export const runtime = "nodejs";
// The start request also drives the order's first invocation, after the response.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GROVBASE SHOT V2 — START AN ORDER.
 *
 * The browser sends the photo PATHS (in its order), the shot count, format,
 * size, the Allegro description, optional dimensions, the shot plan and the
 * total it showed. Nothing is charged here — each shot is charged when it is
 * delivered. `engine_v1` means this customer's order belongs to the V1
 * engine (flag off, trial, advertising): the panel then runs V1 as before.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  // GrovShot is planned AND rendered: both switches apply, as on V1.
  const blocked = await featureBlockedForApi(supabase, "prompts") ?? await featureBlockedForApi(supabase, "generator");
  if (blocked) return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blocked }, { status: 503 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: StartBody = {};
  try { body = (await request.json()) as StartBody; } catch { /* validated below */ }
  const result = await startGrovshotRun(supabase, user.id, workspace.id, body);
  // Accepted in the customer's session; driven from here in the server
  // context (no session of theirs is needed for any later step).
  if (result.ok) driveGrovshotAfterResponse(user.id, workspace.id, result.runId, startedAt, { origin: new URL(request.url).origin });
  const status = result.ok ? 202
    : result.error === "insufficient_credits" ? 402
      : result.error === "concurrency_limit" || result.error === "too_many_runs" || result.error === "rate_limited" || result.error === "analysis_limit" ? 429
        : result.error === "engine_v1" || result.error === "price_changed" ? 409
          : result.error === "prompt_unconfigured" || result.error === "model_unavailable" || result.error === "analysis_unavailable" || result.error === "config_invalid" ? 503
            : 400;
  // Blockers name configuration for an admin; a customer gets the code only.
  const { blockers: _blockers, ...safe } = result as typeof result & { blockers?: string[] };
  return NextResponse.json(safe, { status });
}
