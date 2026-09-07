"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { checkProviderBudgets } from "@/lib/server/provider-budgets";

/**
 * PROVIDER BUDGETS — the writes and the manual check.
 *
 * The budget is OUR spending limit, measured against OUR recorded costs. It
 * does not query a provider for a balance and does not claim to know one.
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

export async function saveProviderBudgetAction(input: {
  providerId: string;
  /** Whole USD from the form; stored in micros like every other cost. */
  monthlyBudgetUsd: number | null;
  warnPercent: number;
  criticalPercent: number;
  maxRequestUsd: number | null;
  failureRatePercent: number | null;
  alertsEnabled: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const warn = clampPercent(input.warnPercent, 75);
    const critical = clampPercent(input.criticalPercent, 90);
    // A critical threshold below the warning would fire the two in the wrong
    // order and read as noise.
    if (critical <= warn) return { ok: false, error: "thresholds_out_of_order" };

    const { error } = await supabase.from("ai_provider_budgets").upsert({
      provider_id: input.providerId,
      monthly_budget_usd_micros: toMicros(input.monthlyBudgetUsd),
      warn_percent: warn,
      critical_percent: critical,
      max_request_usd_micros: toMicros(input.maxRequestUsd),
      failure_rate_percent: input.failureRatePercent === null
        ? null : clampPercent(input.failureRatePercent, 25),
      alerts_enabled: input.alertsEnabled,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "ai_provider.budget_saved",
      entityType: "ai_provider", entityId: input.providerId,
      after: { budget_usd: input.monthlyBudgetUsd, warn, critical, alerts: input.alertsEnabled },
    });
    revalidatePath("/admin/ai/modele");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

const toMicros = (usd: number | null): number | null =>
  usd === null || !Number.isFinite(usd) || usd <= 0 ? null : Math.round(usd * 1_000_000);

const clampPercent = (value: number, fallback: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : fallback;
};

/**
 * Run the budget check now.
 *
 * The same function the daily cron calls, exposed as a button — the schedule
 * and the button must do the same thing, or the two will drift apart.
 */
export async function runBudgetCheckAction(): Promise<Result & { checked?: number; alerted?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const result = await checkProviderBudgets(supabase);
    await logAudit(supabase, {
      actorId: adminId, action: "ai_provider.budget_checked",
      entityType: "ai_provider", entityId: "all",
      after: { checked: result.checked, alerted: result.alerted },
    });
    revalidatePath("/admin/ai/modele");
    return { ok: true, checked: result.checked, alerted: result.alerted };
  } catch { return { ok: false, error: "generic" }; }
}
