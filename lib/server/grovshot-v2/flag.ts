import "server-only";
import type { Client } from "@/lib/services/workspace";
import { isFeatureEnabled } from "@/lib/services/flags";
import { decideTrialWatermark } from "@/lib/server/trial-watermark/pipeline";
import { GROVSHOT_V2_FLAG } from "@/lib/grovshot-v2/stages";
import { customerEconomicsAllowed } from "@/lib/server/grovshot-v2/rollout";

/**
 * WHO GETS THE V2 ENGINE — decided on the server, per order.
 *
 *   · the feature flag `grovshot_engine_v2` (Admin → System): off = nobody;
 *     on with roles {admin} = admins only; plans / rollout narrow it further.
 *     The role is the profiles row of THIS user (the DB guards it against
 *     self-escalation) — never a cookie or a preview switch;
 *   · a lifestyle session only — the advertising session stays on V1 (spec:
 *     „nie była jeszcze testowana”);
 *   · not a trial workspace: V2 delivers through its own path, which does
 *     not draw the trial watermark — a trial order stays on V1, which does;
 *   · a customer (not an admin) only while a typical order meets the billing
 *     margin floor at today's prices (lib/server/grovshot-v2/rollout.ts).
 *
 * Anything that cannot be read means V1. A running order keeps the engine it
 * started on (its run kind), whatever the flag says later.
 */
export async function grovshotV2Enabled(
  supabase: Client, userId: string, workspaceId: string, opts: { sessionType?: string | null } = {},
): Promise<boolean> {
  if (opts.sessionType && opts.sessionType !== "lifestyle") return false;
  try {
    const [{ data: profile }, { data: sub }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
      supabase.from("subscriptions").select("subscription_plans(slug)")
        .eq("workspace_id", workspaceId).in("status", ["active", "trialing", "past_due"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const planSlug = (sub as { subscription_plans?: { slug?: string } } | null)?.subscription_plans?.slug ?? "free";
    const role = profile?.role ?? "user";
    const on = await isFeatureEnabled(supabase, GROVSHOT_V2_FLAG, { role, planSlug, userId });
    if (!on) return false;
    // A customer only while the margin holds at today's prices (an admin
    // tests regardless — admins are never charged differently).
    if (role !== "admin" && !(await customerEconomicsAllowed(supabase))) return false;
    const trial = await decideTrialWatermark(supabase, { workspaceId, credits: 1 });
    return "mode" in trial && trial.mode !== "trial";
  } catch {
    return false;
  }
}

/** The admin test path: only the real role from profiles. */
export async function isAdminUserId(supabase: Client, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}
