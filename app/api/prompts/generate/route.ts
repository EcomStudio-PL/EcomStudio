import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { clampShots, runPromptSession, type PromptSessionInput } from "@/lib/server/prompt-engine";
import { resolveShotBriefs } from "@/lib/server/shot-plan";
import { DEFAULT_SHOT_SETTINGS, parseShotSettings } from "@/lib/grovshot-shot/settings";
import { checkV1ShotOrder } from "@/lib/grovshot-shot/v1-order";
import { isAdminUserId } from "@/lib/server/grovshot-v2/flag";

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

  // GrovBase Shot's rules, from its one setting (the same the lifestyle
  // engine's start route reads): a switched-off scenario (the advertising
  // session) is refused, the Allegro description is required, a manual plan
  // is an admin-only parameter (lib/grovshot-shot/v1-order.ts).
  const [{ data: settingsRow }, admin] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "grovshot_shot").maybeSingle(),
    isAdminUserId(supabase, user.id),
  ]);
  const parsedSettings = parseShotSettings(settingsRow?.value ?? null);
  const order = checkV1ShotOrder(body, parsedSettings.ok ? parsedSettings.settings : DEFAULT_SHOT_SETTINGS, admin);
  if (!order.ok) return NextResponse.json({ ok: false, error: order.error }, { status: 400 });

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
    sessionType: order.sessionType,
    description: order.description,
    shotBriefs: plan.briefs,
    referencePaths,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  // The session's concept ids in priority order — read here, on the server:
  // the browser cannot read generated_prompts itself (0171).
  const { data: concepts } = await supabase.from("generated_prompts").select("id, priority")
    .eq("session_id", result.sessionId).eq("workspace_id", workspace.id).order("priority", { ascending: true });
  return NextResponse.json({ ...result, conceptIds: (concepts ?? []).map((c) => c.id) }, { status: 200 });
}
