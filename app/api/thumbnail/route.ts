import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { featureBlockedForApi } from "@/lib/server/feature-availability";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { startThumbnailRun, type StartBody } from "@/lib/server/thumbnail/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MINIATURKA — START A RUN.
 *
 * The browser sends the storage PATHS of the photos it uploaded (in its
 * order, duplicates kept), the Retusz choice, the total it showed and a
 * per-click `attempt` id. The server re-prices everything from the live
 * catalogue (`price_changed` if the shown total is stale), checks the balance,
 * and records the run — nothing is charged here. The model, the prompt and
 * the price list never appear in the request or the response.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const paused = await accountBlockedResponse(supabase, user.id);
  if (paused) return paused;
  // The category's switch, then the tool's own.
  const blocked = await featureBlockedForApi(supabase, "image_ecommerce")
    ?? await featureBlockedForApi(supabase, "ecommerce_thumbnail");
  if (blocked) return NextResponse.json({ ok: false, error: "feature_unavailable", feature_status: blocked }, { status: 503 });
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return NextResponse.json({ ok: false, error: "no_workspace" }, { status: 400 });

  let body: StartBody = {};
  try { body = (await request.json()) as StartBody; } catch { /* validated below */ }
  const result = await startThumbnailRun(supabase, user.id, workspace.id, body);
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "insufficient_credits" ? 402 : 400 });
}
