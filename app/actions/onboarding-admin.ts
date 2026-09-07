"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import {
  BONUS_CONTENT_KEY, BONUS_SETTINGS_KEY, getBonusConfig,
} from "@/lib/server/welcome-bonus";
import type { BonusConfig, BonusCopy, SurveyQuestion } from "@/lib/welcome-bonus";

/**
 * ADMIN — the welcome bonus and its survey.
 *
 * Content only. An admin can change what the offer is worth, how long it runs,
 * what it says and which questions it asks; they cannot inject markup, styling
 * or script, and every value is clamped here rather than trusted. The role is
 * re-checked on every write because a server action is its own entry point.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const PAGE = "/admin/settings/onboarding";

export type OnboardingSaveInput = {
  active: boolean;
  amount: number;
  hours: number;
  icon: string;
  badge: string;
  copy: BonusCopy;
  mobileOverride: boolean;
  mobileCopy: BonusCopy;
  questions: SurveyQuestion[];
  /** Start a new campaign: everyone who already has an offer keeps it at the
   *  old terms, new accounts get the new ones. */
  bumpCampaign: boolean;
};

const clampCopy = (c: BonusCopy): BonusCopy => {
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 400) : "");
  return {
    notificationTitle: s(c.notificationTitle), notificationBody: s(c.notificationBody),
    modalTitle: s(c.modalTitle), modalSubtitle: s(c.modalSubtitle), cta: s(c.cta),
    successTitle: s(c.successTitle), successBody: s(c.successBody),
  };
};

export async function saveOnboardingConfigAction(input: OnboardingSaveInput): Promise<Result> {
  try {
    const amount = Math.round(Number(input.amount));
    const hours = Math.round(Number(input.hours));
    if (!Number.isFinite(amount) || amount < 1 || amount > 100_000) return { ok: false, error: "amount" };
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) return { ok: false, error: "hours" };

    // §34: a bonus paid for a survey needs a survey. At least one enabled and
    // required question, or the claim is a button with no question behind it.
    const questions = (Array.isArray(input.questions) ? input.questions : [])
      .filter((q) => q && typeof q.key === "string" && q.key.trim() !== "" && Array.isArray(q.options) && q.options.length > 0)
      .slice(0, 12)
      .map((q) => ({
        key: q.key.trim().slice(0, 60),
        type: q.type === "MULTI_SELECT" ? "MULTI_SELECT" as const : "SINGLE_SELECT" as const,
        label: typeof q.label === "string" ? q.label.slice(0, 200) : "",
        options: q.options.slice(0, 24).map((o) => ({
          value: String(o.value ?? "").trim().slice(0, 60),
          label: typeof o.label === "string" ? o.label.slice(0, 120) : "",
        })).filter((o) => o.value !== ""),
        required: q.required === true,
        enabled: q.enabled !== false,
      }))
      .filter((q) => q.options.length > 0);
    if (questions.length === 0) return { ok: false, error: "no_questions" };
    if (!questions.some((q) => q.enabled && q.required)) return { ok: false, error: "no_required" };

    const { supabase, adminId } = await requireAdmin();
    const current = await getBonusConfig(supabase);
    const campaignVersion = input.bumpCampaign ? current.campaignVersion + 1 : current.campaignVersion;

    const { error: flatError } = await supabase.from("app_settings").upsert({
      key: BONUS_SETTINGS_KEY,
      value: {
        active: input.active === true,
        amount,
        hours,
        campaign_version: campaignVersion,
        icon: typeof input.icon === "string" ? input.icon.slice(0, 500) : "",
        badge: (input.badge ?? "").trim().slice(0, 24) || "BONUS",
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (flatError) return { ok: false, error: "generic" };

    // The campaign's start date is written ONCE and never moved: it is the
    // §48 cutoff that keeps existing accounts out of the promotion, and
    // rewriting it on every save would quietly re-enrol or exclude people.
    const { data: existingContent } = await supabase
      .from("app_settings").select("value").eq("key", BONUS_CONTENT_KEY).maybeSingle();
    const startedAt = (existingContent?.value as { campaign_started_at?: string } | null)?.campaign_started_at
      ?? new Date().toISOString();

    const { error: contentError } = await supabase.from("app_settings").upsert({
      key: BONUS_CONTENT_KEY,
      value: {
        campaign_started_at: startedAt,
        copy: clampCopy(input.copy),
        mobile_override: input.mobileOverride === true,
        mobile_copy: clampCopy(input.mobileCopy),
        questions,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (contentError) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "welcome_bonus.saved",
      entityType: "app_settings", entityId: BONUS_SETTINGS_KEY,
      after: { active: input.active === true, amount, hours, campaign_version: campaignVersion, questions: questions.length },
    });
    revalidatePath(PAGE);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

export type OnboardingStats = {
  issued: number;
  claimed: number;
  expired: number;
  pending: number;
  conversion: number;
  /** Average hours from offer to claim — null while nothing has been claimed. */
  averageHoursToClaim: number | null;
};

/** §40 — four numbers and a rate, not an analytics product. */
export async function onboardingStatsAction(): Promise<OnboardingStats | null> {
  try {
    const { supabase } = await requireAdmin();
    // Counted in SQL (0066, SECURITY INVOKER — RLS still applies). This used
    // to read one row per registered customer, four columns each, to produce
    // four counters and an average.
    const { data } = await supabase.rpc("welcome_bonus_stats");
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const issued = Number(row.issued ?? 0);
    const claimed = Number(row.claimed ?? 0);
    const avg = row.avg_hours_to_claim;
    return {
      issued,
      claimed,
      expired: Number(row.expired ?? 0),
      pending: Number(row.pending ?? 0),
      conversion: issued === 0 ? 0 : Math.round((claimed / issued) * 1000) / 10,
      averageHoursToClaim: avg == null ? null : Math.round(Number(avg) * 10) / 10,
    };
  } catch {
    return null;
  }
}

/** The saved configuration, for the panel to edit. */
export async function onboardingConfigAction(): Promise<BonusConfig | null> {
  try {
    const { supabase } = await requireAdmin();
    return await getBonusConfig(supabase);
  } catch {
    return null;
  }
}
