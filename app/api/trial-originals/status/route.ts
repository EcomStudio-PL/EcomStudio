import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { rateLimit } from "@/lib/server/rate-limit";
import { isTrialUuid, trialStatus } from "@/lib/server/trial-watermark/unlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * WHAT ONE TRIAL IMAGE IS RIGHT NOW — the unlock dialog's poll.
 *
 * GET ?assetId=<uuid> → TrialStatusResult: locked / unlocked / expired /
 * unavailable / not_found, the days left, and the database's view of the
 * workspace's entitlement (the unlock itself asks Stripe as well). A download
 * link is handed out only for an asset that is already a clean library file,
 * and lives for the config's short TTL (D3).
 *
 * Every answer is `no-store` (R36): a cached "locked" after a purchase, or a
 * cached link, is wrong the moment it is reused.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const send = (body: unknown, init: { status: number }) => NextResponse.json(body, { ...init, headers: NO_STORE });

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return send({ state: "error", error: "unauthenticated" }, { status: 401 });
  const blocked = await accountBlockedResponse(supabase, user.id);
  if (blocked) {
    blocked.headers.set("Cache-Control", "no-store");
    return blocked;
  }
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return send({ state: "error", error: "no_workspace" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const assetId = params.get("assetId") ?? params.get("asset");
  if (!isTrialUuid(assetId)) return send({ state: "error", error: "invalid_input" }, { status: 400 });
  // A dialog polls with backoff for about two minutes; this is a brake on a
  // loop gone wrong, not a quota.
  if (!rateLimit(`trialwm:status:${user.id}`, 120, 60_000)) {
    return send({ state: "error", error: "rate_limited" }, { status: 429 });
  }

  const result = await trialStatus(supabase, { workspaceId: workspace.id, assetId: assetId.toLowerCase() });
  return send(result, { status: 200 });
}
