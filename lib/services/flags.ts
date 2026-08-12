import type { Client } from "./workspace";

/** Minimal feature-flag check: flag must be enabled and, when scoped,
 *  match the caller's plan/role. rollout_percent gates by a stable hash of
 *  the user id so the same user always gets the same answer. */
export async function isFeatureEnabled(supabase: Client, flag: string, ctx: {
  planSlug?: string; role?: string; userId?: string;
}): Promise<boolean> {
  const { data } = await supabase.from("feature_flags").select("*").eq("flag", flag).maybeSingle();
  if (!data || !data.enabled) return false;
  if (data.plans && data.plans.length > 0 && (!ctx.planSlug || !data.plans.includes(ctx.planSlug))) return false;
  if (data.roles && data.roles.length > 0 && (!ctx.role || !data.roles.includes(ctx.role))) return false;
  if (data.rollout_percent != null && data.rollout_percent < 100) {
    if (!ctx.userId) return false;
    let h = 0;
    for (const c of ctx.userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    if (h % 100 >= data.rollout_percent) return false;
  }
  return true;
}
