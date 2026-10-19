import "server-only";
import type { Client } from "@/lib/services/workspace";
import { safeError } from "@/lib/server/integrations";
import { getPrelaunchPublicConfig } from "./public";
import { rpcRewardEnsure } from "./rpc";

/**
 * PRE-LAUNCH REWARDS, PAID LAZILY — the hook app/(app)/layout.tsx calls next
 * to the welcome bonus, after the blocked-account guard.
 *
 * The credits a confirmed signup was promised (X) and the ones each confirmed
 * referral earns (Y) cannot be granted when the e-mail is confirmed: there is
 * no account yet, and registration may still be closed. So the first time a
 * VERIFIED account with the same address opens the app, prelaunch_reward_ensure
 * (0144) looks for what it is owed and pays it — once per claim, through the
 * ledger, as type `bonus` (never `topup`: a bonus does not unlock the trial
 * watermark). Idempotency, the caps, the email-hop and alias rules and the
 * locking all live in that one SQL function; this file only decides whether to
 * ask, and records what came back.
 *
 * WHETHER TO ASK comes from the cached public config (60 s, tag
 * `prelaunch-config`): while rewards are switched off — the whole pre-launch,
 * by default — this costs no database round trip at all.
 *
 * NEVER BREAKS THE RENDER. Every failure is swallowed (and logged scrubbed):
 * a promotion is never worth taking the application down for, and the grant
 * simply happens on a later page load.
 *
 * The activity row is informational (S20: log_activity is client-callable, so
 * it proves nothing) and carries amounts only — the money itself is in
 * prelaunch_reward_claims and credit_transactions, which is what the admin
 * stats read. No bell notification yet (D17, optional): it needs copy of its
 * own and is left for a follow-up.
 */
export async function ensurePrelaunchRewards(supabase: Client, workspaceId: string): Promise<void> {
  try {
    const config = await getPrelaunchPublicConfig();
    if (!config.rewardsActive) return;
    const result = await rpcRewardEnsure(supabase);
    if (!result || result.granted <= 0) return;
    await supabase.rpc("log_activity", {
      p_workspace_id: workspaceId,
      p_action: "prelaunch.reward_granted",
      p_entity_type: "workspace",
      p_entity_id: workspaceId,
      p_metadata: { granted: result.granted, signup: result.signup, referrals: result.referrals },
    });
  } catch (e) {
    console.error("prelaunch.reward", safeError(e));
  }
}
