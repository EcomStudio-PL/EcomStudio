import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { clampShots, runPromptSession, type PromptSessionInput } from "@/lib/server/prompt-engine";
import { resolveShotBriefs } from "@/lib/server/shot-plan";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** "PRZYGOTUJ UJĘCIA" — reference analysis + scene strategy → 5-10 hidden
 *  concepts. Auth + workspace membership via Supabase RLS. The response
 *  carries ids and counts only; prompts never leave the server. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  // A temporarily blocked account keeps its data and loses its access — and
  // access means this route too, not just the screen that links to it.
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const blockedFeature = await featureBlockedForApi(supabase, "prompts");
  if (blockedFeature) {
    return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blockedFeature }, { status: 503 });
  }
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: PromptSessionInput;
  try { body = (await request.json()) as PromptSessionInput; }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }

  const locale = (await cookies()).get("ecs_locale")?.value ?? "pl";
  const referencePaths = (body.referencePaths ?? []).filter(
    (p) => typeof p === "string" && p.startsWith(`${workspace.id}/`)
  );
  // Brief contents are sanitized again inside the engine; here only the shape
  // is constrained, and a shot's chosen photo (Plan ujęć: its storage path)
  // must be one of THIS request's reference photos (lib/server/shot-plan.ts).
  const plan = resolveShotBriefs(body.shotBriefs, referencePaths);
  if (!plan.ok) return NextResponse.json({ ok: false, error: "invalid_shot_plan" }, { status: 400 });
  const result = await runPromptSession(supabase, user.id, workspace.id, {
    ...body,
    shots: clampShots(body.shots),
    locale,
    sessionType: body.sessionType === "advertising" || body.sessionType === "lifestyle"
      ? body.sessionType : undefined,
    shotBriefs: plan.briefs,
    referencePaths,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
