import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getLocale } from "@/lib/i18n/server";
import { runSmartPrompt } from "@/lib/server/smart-prompt";

// Above the run's own deadline (SMART_PROMPT_DEADLINE_MS, 240 s), so a slow
// provider ends in the module's refund path rather than in a killed
// invocation the ledger reconciler has to clean up later.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * INTELIGENTNY PROMPT — POST { requestId, intent, variationIndex, referencePaths }.
 *
 * The same gates as /api/generate (signed in, account not paused, the
 * generator live, a workspace), then lib/server/smart-prompt.ts owns the rest:
 * validation, the catalogue price, the charge, the call and the refund. The
 * body carries no price and no instruction, and the answer carries neither.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  const blockedFeature = await featureBlockedForApi(supabase, "generator");
  if (blockedFeature) {
    return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blockedFeature }, { status: 503 });
  }
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const result = await runSmartPrompt(supabase, user.id, workspace.id, {
    intent: body.intent,
    variationIndex: body.variationIndex,
    requestId: body.requestId,
    referencePaths: body.referencePaths,
    locale: await getLocale(),
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true, prompt: result.prompt, credits: result.credits, balance: result.balance,
    variationIndex: result.variationIndex,
  });
}
