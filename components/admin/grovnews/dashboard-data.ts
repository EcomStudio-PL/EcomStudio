import "server-only";
import type { Client } from "@/lib/services/workspace";
import {
  adminSourceHealth, adminStats, adminToday,
  type AdminStats, type SourceHealthSummary, type TodayStatus,
} from "@/lib/services/grovnews";
import { adminGetSettings, adminSchedulerStatus, todayRunSummary } from "@/lib/services/grovnews-research";
import { grovnewsEconomics, type GrovNewsEconomics, type GrovNewsWindow } from "@/lib/services/api-economics";

/**
 * GROVNEWS PULPIT — the data behind "does GrovNews work today?", in one
 * place so each source of numbers is wired on ONE line:
 *
 *   health    → adminSourceHealth   (lib/services/grovnews.ts)
 *   today     → adminToday          (lib/services/grovnews.ts)
 *   economics → grovnewsEconomics   (lib/services/api-economics.ts)
 *
 * Every read is admin-only under RLS; the page sits behind the admin layout.
 * A read that fails yields null for its block (shown as "no data"), never a
 * zero and never a broken page.
 */

export type DashboardSettings = {
  dailyEnabled: boolean; mode: "REVIEW" | "AUTOMATIC"; runHour: number; emailEnabled: boolean;
  /** AUTOMATIC mode's publish / send hours (0128); null = right after the previous step. */
  publishHour: number | null; sendHour: number | null;
};

export type DashboardData = {
  stats: AdminStats;
  health: SourceHealthSummary | null;
  today: TodayStatus | null;
  settings: DashboardSettings;
  /** pg_cron job present (null = the scheduler status could not be read). */
  scheduled: boolean | null;
  economics: GrovNewsEconomics | null;
  /** AI cost of TODAY'S RUN (its traced calls, run_ref = run id); null before a run exists. */
  runCost: GrovNewsWindow | null;
};

const orNull = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

export async function loadGrovNewsDashboard(db: Client, now: Date = new Date()): Promise<DashboardData> {
  const [stats, health, today, settings, scheduler, economics, run] = await Promise.all([
    adminStats(db, now),
    orNull(adminSourceHealth(db)),
    orNull(adminToday(db, now)),
    adminGetSettings(db),
    orNull(adminSchedulerStatus(db)),
    orNull(grovnewsEconomics(db, now)),
    orNull(todayRunSummary(db, now)),
  ]);
  return {
    stats, health, today,
    settings: {
      dailyEnabled: settings.dailyEnabled, mode: settings.mode, runHour: settings.runHour, emailEnabled: settings.emailEnabled,
      publishHour: settings.publishHour ?? null, sendHour: settings.sendHour ?? null,
    },
    scheduled: scheduler ? scheduler.jobScheduled : null,
    economics,
    runCost: run && run.status !== null
      ? { aiCostUsdMicros: run.aiCostUsdMicros ?? 0, aiCalls: run.aiCalls, unknownCostCalls: run.unknownCostCalls }
      : null,
  };
}

/* ── the one-word answer ───────────────────────────────────────────────────── */

export const VERDICTS = ["off", "failed", "aiDown", "sent", "queued", "published", "review", "running", "noTopics", "noEdition", "waiting", "missing"] as const;
export type VerdictKey = (typeof VERDICTS)[number];
export type Verdict = { key: VerdictKey; tone: "success" | "warning" | "danger" | "info" | "neutral" };

/** The hour on the Warsaw wall clock (0–23). */
export function warsawHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}

/**
 * "Does GrovNews work today?" in one badge. Pure; the order is the answer's
 * priority: switched off → something failed → how far today got → whether
 * today's run is still due.
 */
export function dashboardVerdict(today: TodayStatus | null, settings: DashboardSettings, now: Date): Verdict {
  if (!settings.dailyEnabled) return { key: "off", tone: "neutral" };
  const e = today?.edition ?? null;
  const run = today?.run ?? null;
  const mail = today?.mail ?? null;
  if (e?.status === "FAILED" || run?.status === "FAILED" || (mail && mail.failed > 0 && mail.sent === 0)) return { key: "failed", tone: "danger" };
  if (e?.status === "SENT") return { key: "sent", tone: "success" };
  if (e?.status === "QUEUED") return { key: "queued", tone: "success" };
  if (e?.status === "PUBLISHED") return { key: "published", tone: "success" };
  if (e?.status === "DRAFT" || e?.status === "READY") return { key: "review", tone: "warning" };
  if (run?.outcome === "ai_unavailable" || run?.outcome === "provider_down") return { key: "aiDown", tone: "danger" };
  if (run?.status === "RUNNING") return { key: "running", tone: "info" };
  if (run?.outcome === "no_topics") return { key: "noTopics", tone: "neutral" };
  if (!run) return warsawHour(now) < settings.runHour ? { key: "waiting", tone: "neutral" } : { key: "missing", tone: "warning" };
  // A finished run that left no edition and gave no known reason.
  return { key: "noEdition", tone: "warning" };
}
