"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { loadReserveSnapshot, sendTestReport } from "@/lib/server/api-reserves/reports";
import { syncProviderBalances } from "@/lib/server/api-reserves/providers";

/**
 * API RESERVE CENTER — the admin's writes (0180). Thin wrappers: who is asking
 * (an admin), the definer function that re-checks is_admin() itself, an audit
 * row, the page re-rendered. Nothing here spends money or buys provider credit.
 */

type Result = { ok: boolean; error?: string };
const PATH = "/admin/finance/rezerwy";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

const reason = (e: unknown) => (e instanceof Error && /^(unauthenticated|not_admin)$/.test(e.message) ? e.message : "generic");
const usdToMicros = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 1_000_000) : null;
};

export async function saveReserveSettingsAction(input: {
  enabled: boolean; bufferPercent: number; horizonDays: number; scenario: "standard" | "cautious"; cautiousFactor: number;
  historyDays: number; minHistoryCredits: number; dailyReportHour: number; reportTimezone: string;
  hourlySkipEmpty: boolean; alertRepeatHours: number;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const clamp = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
    const payload = {
      enabled: input.enabled === true,
      buffer_percent: clamp(Number(input.bufferPercent), 0, 500, 20),
      horizon_days: Math.round(clamp(Number(input.horizonDays), 1, 365, 30)),
      scenario: input.scenario === "cautious" ? "cautious" : "standard",
      cautious_factor: clamp(Number(input.cautiousFactor), 1, 10, 1.5),
      history_days: Math.round(clamp(Number(input.historyDays), 7, 365, 90)),
      min_history_credits: clamp(Number(input.minHistoryCredits), 0, 1_000_000, 50),
      daily_report_hour: Math.round(clamp(Number(input.dailyReportHour), 0, 23, 23)),
      report_timezone: String(input.reportTimezone || "Europe/Warsaw").slice(0, 64),
      hourly_skip_empty: input.hourlySkipEmpty === true,
      alert_repeat_hours: Math.round(clamp(Number(input.alertRepeatHours), 1, 168, 6)),
    };
    const { error } = await supabase.rpc("api_reserve_settings_save", { p: payload });
    if (error) return { ok: false, error: /time zone/i.test(error.message) ? "bad_timezone" : "generic" };
    await logAudit(supabase, { actorId: adminId, action: "finance.reserves.settings", entityType: "api_reserve_settings", entityId: "main", after: payload });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

export async function saveProviderFundsAction(input: {
  providerId: string; mode: "auto" | "manual" | "postpaid" | "off"; warnUsd: number; criticalUsd: number;
  creditLimitUsd: number | null; billingUrl: string | null;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!/^[0-9a-f-]{36}$/i.test(input.providerId)) return { ok: false, error: "invalid" };
    const url = (input.billingUrl ?? "").trim();
    if (url && !/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: "bad_url" };
    const warn = usdToMicros(input.warnUsd);
    const critical = usdToMicros(input.criticalUsd);
    if (warn === null || critical === null || warn < 0 || critical < 0) return { ok: false, error: "invalid" };
    const limit = input.creditLimitUsd === null || input.creditLimitUsd === undefined ? null : usdToMicros(input.creditLimitUsd);
    const payload = {
      mode: ["auto", "manual", "postpaid", "off"].includes(input.mode) ? input.mode : "manual",
      warn_usd_micros: warn, critical_usd_micros: critical, credit_limit_usd_micros: limit, billing_url: url || null,
    };
    const { error } = await supabase.rpc("api_provider_funds_save", { p_provider: input.providerId, p: payload });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, { actorId: adminId, action: "finance.reserves.provider", entityType: "ai_provider", entityId: input.providerId, after: payload });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

/** "The provider shows $X now" / "I added $X" / "± $X correction". */
export async function recordProviderFundsAction(input: {
  providerId: string; kind: "balance_set" | "topup" | "correction"; amountUsd: number; note?: string;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!/^[0-9a-f-]{36}$/i.test(input.providerId)) return { ok: false, error: "invalid" };
    if (!["balance_set", "topup", "correction"].includes(input.kind)) return { ok: false, error: "invalid" };
    const micros = usdToMicros(input.amountUsd);
    if (micros === null || (input.kind !== "correction" && micros < 0)) return { ok: false, error: "invalid" };
    const { error } = await supabase.rpc("api_provider_fund_record", {
      p_provider: input.providerId, p_kind: input.kind, p_amount_usd_micros: micros, p_note: (input.note ?? "").slice(0, 300) || undefined,
    });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, { actorId: adminId, action: `finance.reserves.${input.kind}`, entityType: "ai_provider", entityId: input.providerId, after: { usd_micros: micros } });
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

/** Read the official balance APIs now (one provider or all automatic ones). */
export async function syncProviderFundsAction(slug?: string): Promise<Result & { results?: Record<string, string> }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const snap = await loadReserveSnapshot(supabase);
    if (!snap) return { ok: false, error: "generic" };
    const results = await syncProviderBalances(supabase, snap.providers.map((p) => ({ id: p.id, slug: p.slug, mode: p.mode, active: p.active })), slug);
    await logAudit(supabase, { actorId: adminId, action: "finance.reserves.sync", entityType: "api_provider_funds", after: results });
    revalidatePath(PATH);
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}

export async function sendTestReserveReportAction(kind: "sale" | "hourly" | "daily" | "funds_low"): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!["sale", "hourly", "daily", "funds_low"].includes(kind)) return { ok: false, error: "invalid" };
    const sent = await sendTestReport(supabase, kind);
    await logAudit(supabase, { actorId: adminId, action: "finance.reserves.test_report", entityType: "notification", after: { kind } });
    revalidatePath(PATH);
    return sent ? { ok: true } : { ok: false, error: "generic" };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}
