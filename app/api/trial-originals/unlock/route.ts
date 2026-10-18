import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { accountBlockedResponse } from "@/lib/server/account-block";
import { rateLimit } from "@/lib/server/rate-limit";
import { isTrialUuid, unlockTrialAsset } from "@/lib/server/trial-watermark/unlock";

// The clean original is decrypted and its derivatives made with sharp.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * UNLOCK ONE TRIAL IMAGE — POST {assetId} → TrialUnlockResult.
 *
 * The body names an asset and nothing else: no path, no state, no plan. The
 * workspace is the session's; entitlement is the database's AND Stripe's
 * (R11); the target path is derived in SQL; the clean bytes are checked
 * against the hash SQL holds. lib/server/trial-watermark/unlock.ts has the
 * two phases and what undoes them.
 *
 * Every domain outcome answers 200 with its `state`; only a request that is
 * not one (no session, a paused account, a malformed id, a runaway loop)
 * gets another status. All of them `no-store` (R36).
 */
const NO_STORE = { "Cache-Control": "no-store" };
const send = (body: unknown, init: { status: number }) => NextResponse.json(body, { ...init, headers: NO_STORE });

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null) as { assetId?: unknown } | null;
  const assetId = body?.assetId;
  if (!isTrialUuid(assetId)) return send({ state: "error", error: "invalid_input" }, { status: 400 });
  if (!rateLimit(`trialwm:unlock:${user.id}`, 30, 60_000)) {
    return send({ state: "error", error: "rate_limited" }, { status: 429 });
  }

  const result = await unlockTrialAsset(supabase, { workspaceId: workspace.id, assetId: assetId.toLowerCase() });
  return send(result, { status: 200 });
}
