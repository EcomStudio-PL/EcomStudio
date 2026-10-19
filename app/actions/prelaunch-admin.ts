"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { premiereState } from "@/lib/server/pricing-offer";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { getBonusConfig } from "@/lib/server/welcome-bonus";
import { EARLY_ACCESS_SUPPORTED } from "@/lib/launch/campaign";
import { PRELAUNCH_CONFIG_TAG } from "@/lib/server/prelaunch/public";
import {
  PRELAUNCH_SETTING_KEY, parsePrelaunchCampaign, serializePrelaunchCampaign, validatePrelaunchCampaignInput,
  type CampaignField, type CampaignInvalidReason, type PrelaunchCampaignPanel,
} from "@/lib/server/prelaunch/campaign-config";

/**
 * ADMIN — the pre-launch campaign settings (Strony WWW → the launch page).
 *
 * The private `prelaunch` row is written ONLY here: the generic /admin/system
 * editor neither lists nor saves it (S5). One strict validation, one bad field
 * and nothing is saved; the row is audited before and after; switching the
 * rewards ON — the one change that moves money — needs the operator's explicit
 * confirmation, so neither a stale form nor a replayed call can do it.
 *
 * Admins read the private row with their own session: settings_admin_write
 * (`for all to authenticated using (is_admin())`, migration 0110) covers
 * SELECT, so no definer read function is needed — a non-admin simply gets no
 * row. The launch date arrives as a Warsaw wall clock ({date, time}) and is
 * converted HERE, on the server's rules, refusing the DST gap and overlap.
 *
 * After a save the public config's cache tag is revalidated together with
 * "/", so the countdown and the offer line follow within the request.
 *
 * Error codes: forbidden · invalid (with field + reason) · migration_pending ·
 * confirm_required · generic.
 */

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return null;
  return { supabase, adminId: user.id };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** user_defaults.welcome_credits — what an account gets at birth today. */
function welcomeCreditsOf(value: unknown): number | null {
  const n = isObj(value) ? value.welcome_credits : null;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Everything the panel shows. Null = not an admin, or the row could not be read. */
export async function prelaunchCampaignPanelAction(): Promise<PrelaunchCampaignPanel | null> {
  try {
    const admin = await requireAdmin();
    if (!admin) return null;
    const now = Date.now();
    const [rows, access, bonus] = await Promise.all([
      admin.supabase.from("app_settings").select("key, value, updated_at").in("key", [PRELAUNCH_SETTING_KEY, "user_defaults"]),
      getPlatformAccess(admin.supabase).catch(() => null),
      getBonusConfig(admin.supabase).catch(() => null),
    ]);
    // A failed read is a failure, never the defaults shown as if they were saved.
    if (rows.error) return null;
    const byKey = new Map((rows.data ?? []).map((r) => [r.key as string, r]));
    const row = byKey.get(PRELAUNCH_SETTING_KEY);
    return {
      installed: Boolean(row),
      config: parsePrelaunchCampaign(row?.value ?? null),
      updatedAt: (row?.updated_at as string | null | undefined) ?? null,
      now,
      premiereActive: premiereState(now).status === "active",
      earlyAccessSupported: EARLY_ACCESS_SUPPORTED,
      platform: access ? { allowSignup: access.allowSignup, signupOpensAt: access.signupOpensAt } : null,
      welcomeCredits: welcomeCreditsOf(byKey.get("user_defaults")?.value),
      surveyBonus: bonus ? { active: bonus.active, amount: bonus.amount } : null,
    };
  } catch {
    return null;
  }
}

export type PrelaunchCampaignSaveResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "migration_pending" | "confirm_required" | "generic";
      field?: CampaignField;
      reason?: CampaignInvalidReason;
    };

/**
 * Save the whole set. `input.confirm` is the operator's answer to the "switch
 * rewards on?" dialog; a save that would turn them on without it is refused.
 * Turning them off is always allowed — it stops new grants and never takes
 * back credits already paid.
 */
export async function savePrelaunchCampaignAction(input: unknown): Promise<PrelaunchCampaignSaveResult> {
  try {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: "forbidden" };

    const { data: rows, error: readError } = await admin.supabase
      .from("app_settings").select("key, value").in("key", [PRELAUNCH_SETTING_KEY, "user_defaults"]);
    if (readError) return { ok: false, error: "generic" };
    const byKey = new Map((rows ?? []).map((r) => [r.key as string, r.value as unknown]));
    // 0144 seeds the row AND makes it private. Before that, a save would
    // create a row every visitor can read — unapproved figures included.
    if (!byKey.has(PRELAUNCH_SETTING_KEY)) return { ok: false, error: "migration_pending" };
    const stored = byKey.get(PRELAUNCH_SETTING_KEY);
    const before = parsePrelaunchCampaign(stored);

    const now = Date.now();
    const v = validatePrelaunchCampaignInput(input, {
      now,
      premiereActive: premiereState(now).status === "active",
      welcomeCredits: welcomeCreditsOf(byKey.get("user_defaults")),
      before,
    });
    if (!v.ok) return { ok: false, error: "invalid", field: v.field, reason: v.reason };

    const turningOn = v.config.rewardsActive && !before.rewardsActive;
    if (turningOn && !(isObj(input) && input.confirm === true)) return { ok: false, error: "confirm_required" };

    const after = serializePrelaunchCampaign(v.config, stored);
    // UPDATE, never upsert: the existence check above is what keeps this row
    // from being created outside the migration that makes it private.
    const { error } = await admin.supabase.from("app_settings")
      .update({ value: after as never, updated_at: new Date().toISOString() })
      .eq("key", PRELAUNCH_SETTING_KEY);
    if (error) return { ok: false, error: "generic" };

    await logAudit(admin.supabase, {
      actorId: admin.adminId,
      action: turningOn ? "admin.prelaunch_rewards_enabled"
        : before.rewardsActive && !v.config.rewardsActive ? "admin.prelaunch_rewards_disabled"
        : "admin.prelaunch_campaign_saved",
      entityType: "app_settings", entityId: PRELAUNCH_SETTING_KEY,
      before: isObj(stored) ? stored : { value: stored ?? null },
      after,
    });
    revalidateTag(PRELAUNCH_CONFIG_TAG);
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}
