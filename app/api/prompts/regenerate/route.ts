import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { regeneratePrompt } from "@/lib/server/prompt-engine";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Regenerate a single prompt card with a fresh, still-diverse scene. */
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

  let body: { promptId?: string };
  try { body = (await request.json()) as { promptId?: string }; }
  catch { return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 }); }
  if (!body.promptId || typeof body.promptId !== "string")
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });

  const result = await regeneratePrompt(supabase, workspace.id, body.promptId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
