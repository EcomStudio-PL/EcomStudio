"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, Bot, CalendarClock, Clock, KeyRound, Loader2, Mail, Play, Save, Sparkles,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { Segmented } from "@/components/ui/segmented";
import { AdminTable } from "@/components/ui/admin-table";
import { runDailyNowAction, saveSettingsAction } from "@/app/actions/grovnews-research";
import {
  AI_PROVIDERS, EDITION_STATUSES, LOOKBACK_RANGE, MAX_OPERATOR_EMAILS, MODES, RUN_STAGES, SOURCE_ERROR_KINDS, editionDateLabel,
  parseOperatorEmails, sourceErrorKind, type GrovNewsAiProvider, type GrovNewsMode,
} from "@/lib/grovnews-research";
import type { AdminRun, AdminSettings, SchedulerStatus } from "@/lib/services/grovnews-research";
import { cn } from "@/lib/utils";

/**
 * GROVNEWS AUTOMATION — the mode, the daily schedule, and what the job did.
 *
 * REVIEW is the default and the safe mode: the job fetches, analyses, writes
 * the day's ONE article as a draft, and a person publishes and sends.
 * AUTOMATIC publishes that article only when nothing in it is flagged for
 * review, and mails it at most once a day — so turning it on is confirmed
 * before it is saved. Whatever this screen says, the database re-checks every
 * publish and every send.
 *
 * The three health cards (scheduler, AI, server key) say what is missing in
 * words an admin can act on — never a raw code, never an environment variable.
 * The last-run card reads the run's stats blob field by field: every number
 * is optional (an old run lacks the newer ones) and a missing one reads "—".
 */

const RUN_STATUSES = ["RUNNING", "DONE", "FAILED"] as const;
const RUN_TRIGGERS = ["CRON", "ADMIN"] as const;
const RUN_TONE: Record<(typeof RUN_STATUSES)[number], "info" | "success" | "danger"> = {
  RUNNING: "info", DONE: "success", FAILED: "danger",
};
const SKIP_REASONS = ["done", "busy", "gave_up", "failed", "waiting_publish", "waiting_send"] as const;
/** Why a day ended without an article (pipeline.ts noTopicsReason). */
const NO_TOPICS_REASONS = ["no_sources", "all_sources_failed", "below_threshold", "no_candidates"] as const;
const TICKS = ["succeeded", "failed", "running"] as const;

/** How far back a story still counts as today's news (hours). The stored
 *  value is offered even when it is not one of these. */
const LOOKBACK_PRESETS = [12, 24, 36, 48, 72, 168] as const;

/** What a daily run ended with (pipeline.ts `stats.outcome`); anything else
 *  reads as "other". */
const OUTCOMES = [
  "published_queued", "published", "published_email_off", "draft_review", "no_topics", "ai_unavailable",
  "provider_down", "published_no_recipients", "published_edition_empty", "published_already_queued", "not_attached",
] as const;
type Outcome = (typeof OUTCOMES)[number] | "other";
type Tone = NonNullable<React.ComponentProps<typeof Badge>["tone"]>;
const OUTCOME_TONE: Record<Outcome, Tone> = {
  published_queued: "success", published: "success", published_already_queued: "success",
  published_email_off: "info", draft_review: "accent", no_topics: "neutral",
  ai_unavailable: "danger", provider_down: "danger",
  published_no_recipients: "warning", published_edition_empty: "warning", not_attached: "warning", other: "neutral",
};
/** Why the day's article waits for a person (daily.ts composeDaily). */
const REVIEW_REASONS = ["topic_review", "few_topics", "sources_failed", "topic_dropped", "lead_unsupported"] as const;
const ARTICLE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const SEND_STATUSES = ["queued", "already_queued", "no_recipients", "edition_empty"] as const;
const SEND_TONE: Record<(typeof SEND_STATUSES)[number] | "other", Tone> = {
  queued: "success", already_queued: "success", no_recipients: "warning", edition_empty: "warning", other: "neutral",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null;

/** Numeric, in Warsaw time: "26.09.2026 07:05" — month NAMES differ between
 *  the server's and the browser's ICU, which is a hydration error. */
function useFormatDateTime() {
  const { locale } = useI18n();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
      timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    return (iso: string | null) => (iso ? fmt.format(new Date(iso)) : null);
  }, [locale]);
}

/** A number from a JSON blob the job wrote — or null, never a throw. */
function num(stats: Record<string, unknown>, section: string, field: string): number | null {
  const s = stats[section];
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const v = (s as Record<string, unknown>)[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(stats: Record<string, unknown>, section: string, field: string): string | null {
  const s = stats[section];
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const v = (s as Record<string, unknown>)[field];
  return typeof v === "string" ? v : null;
}

/** One section of the blob as an object — or null. */
function section(stats: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const s = stats[name];
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : null;
}

function outcomeOf(stats: Record<string, unknown>): Outcome | null {
  const o = stats.outcome;
  if (typeof o !== "string" || !o) return null;
  return oneOf(OUTCOMES, o) ?? "other";
}

/** An integer in [min, max] typed into a field — or null. */
function intIn(v: string, min: number, max: number): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

type Form = {
  mode: GrovNewsMode; dailyEnabled: boolean; runHour: number;
  minRelevance: string; minImportance: string; maxTopics: string; autoPublishOfficialSensitive: boolean;
  minTopics: string; lookbackHours: number; emailEnabled: boolean;
  /** 0128 — "" means "the default" (platform order / provider's model /
   *  right after the previous step). */
  aiProvider: "" | GrovNewsAiProvider; aiModel: string; publishHour: string; sendHour: string; operatorEmails: string;
};

const fromSettings = (s: AdminSettings): Form => ({
  mode: s.mode, dailyEnabled: s.dailyEnabled, runHour: s.runHour,
  minRelevance: String(s.minRelevance), minImportance: String(s.minImportance), maxTopics: String(s.maxTopics),
  autoPublishOfficialSensitive: s.autoPublishOfficialSensitive,
  minTopics: String(s.minTopics), lookbackHours: s.lookbackHours, emailEnabled: s.emailEnabled,
  aiProvider: s.aiProvider ?? "", aiModel: s.aiModel ?? "",
  publishHour: s.publishHour === null ? "" : String(s.publishHour), sendHour: s.sendHour === null ? "" : String(s.sendHour),
  operatorEmails: s.operatorEmails.join("\n"),
});

/** What the server says about the platform's AI providers: switched on, and
 *  holding a usable key (never the key itself). */
export type ProviderStatus = {
  providers: Record<GrovNewsAiProvider, { active: boolean; usable: boolean }>;
  platformOrder: GrovNewsAiProvider[];
};

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function AutomationPanel({ settings, scheduler, runs, aiAvailable, serverKey, providers, modelOptions }: {
  settings: AdminSettings;
  scheduler: SchedulerStatus | null;
  runs: AdminRun[];
  aiAvailable: boolean;
  serverKey: boolean;
  providers: ProviderStatus | null;
  modelOptions: Record<GrovNewsAiProvider, readonly string[]>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormatDateTime();
  const [saving, startSave] = useTransition();
  const [running, startRun] = useTransition();
  const [form, setForm] = useState<Form>(() => fromSettings(settings));
  const [confirming, setConfirming] = useState(false);

  const initial = useMemo(() => JSON.stringify(fromSettings(settings)), [settings]);
  const dirty = JSON.stringify(form) !== initial;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // The minimum is checked here as the server checks it (1–10, never above
  // the maximum), so a wrong pair is explained at the field, not in a toast.
  const minTopics = intIn(form.minTopics, 1, 10);
  const maxTopics = intIn(form.maxTopics, 1, 10);
  const minTopicsError = minTopics === null ? "range" : maxTopics !== null && minTopics > maxTopics ? "aboveMax" : null;
  // 0128: prepare ≤ publish ≤ send (the database checks the same order), and
  // at most five plausible operator addresses.
  const publishHourN = form.publishHour === "" ? null : Number(form.publishHour);
  const sendHourN = form.sendHour === "" ? null : Number(form.sendHour);
  const hoursError = (publishHourN !== null && publishHourN < form.runHour)
    || (sendHourN !== null && sendHourN < (publishHourN ?? form.runHour));
  const operators = parseOperatorEmails(form.operatorEmails);
  const operatorsError = operators === null;
  const providerLabel = (p: GrovNewsAiProvider) => t(`grovnewsAdm.automation.aiProviderName.${p}`);
  const chosen = form.aiProvider === "" ? null : form.aiProvider;
  const chosenStatus = chosen && providers ? providers.providers[chosen] : null;
  const lookbackOptions = useMemo(() => {
    const list: number[] = [...LOOKBACK_PRESETS];
    const current = settings.lookbackHours;
    if (Number.isInteger(current) && current >= LOOKBACK_RANGE.min && current <= LOOKBACK_RANGE.max && !list.includes(current)) {
      list.push(current);
    }
    return list.sort((a, b) => a - b);
  }, [settings.lookbackHours]);

  const save = () => startSave(async () => {
    const res = await saveSettingsAction({
      mode: form.mode, dailyEnabled: form.dailyEnabled, runHour: form.runHour,
      minRelevance: Number(form.minRelevance), minImportance: Number(form.minImportance), maxTopics: Number(form.maxTopics),
      autoPublishOfficialSensitive: form.autoPublishOfficialSensitive,
      minTopics: Number(form.minTopics), lookbackHours: form.lookbackHours, emailEnabled: form.emailEnabled,
      aiProvider: form.aiProvider || null, aiModel: form.aiProvider && form.aiModel ? form.aiModel : null,
      publishHour: publishHourN, sendHour: sendHourN, operatorEmails: operators ?? [],
    });
    setConfirming(false);
    if (res.ok) { toast.success(t("grovnewsAdm.saved")); router.refresh(); return; }
    toast.error(t(res.error === "invalid" ? "grovnewsAdm.automation.errInvalidDaily"
      : res.error === "hours" ? "grovnewsAdm.automation.errHours"
      : res.error === "operators" ? "grovnewsAdm.automation.errOperators"
      : res.error === "model" ? "grovnewsAdm.automation.errModel"
      : res.error === "forbidden" ? "grovnewsAdm.errForbidden" : "common.error"));
  });

  // Turning AUTOMATIC on is the one change that lets content reach
  // subscribers without a person — it is confirmed before it is saved.
  const onSave = () => (form.mode === "AUTOMATIC" && settings.mode !== "AUTOMATIC" ? setConfirming(true) : save());

  const runNow = () => startRun(async () => {
    const res = await runDailyNowAction();
    if (!res.ok) {
      toast.error(t(res.error === "noServerKey" ? "grovnewsAdm.automation.run.errNoServerKey"
        : res.error === "forbidden" ? "grovnewsAdm.errForbidden" : "grovnewsAdm.automation.run.errGeneric"));
      router.refresh();
      return;
    }
    if (res.status === "done") toast.success(t("grovnewsAdm.automation.run.done"));
    else if (res.reason === "waiting_publish" || res.reason === "waiting_send") {
      toast.info(t(`grovnewsAdm.automation.run.skipped.${res.reason}`));
    } else if (res.status === "partial") {
      const stage = oneOf(RUN_STAGES, res.stage);
      toast.info(stage
        ? t("grovnewsAdm.automation.run.partialAt", { stage: t(`grovnewsAdm.runStage.${stage}`) })
        : t("grovnewsAdm.automation.run.partial"));
    } else {
      const reason = oneOf(SKIP_REASONS, res.reason);
      toast.warning(t(reason ? `grovnewsAdm.automation.run.skipped.${reason}` : "grovnewsAdm.automation.run.skipped.other"));
    }
    router.refresh();
  });

  const schedulerOk = !!scheduler && scheduler.pgCron && scheduler.jobScheduled && scheduler.triggerConfigured;
  const tick = scheduler?.lastTick ?? null;
  const tickStatus = tick ? oneOf(TICKS, tick.status) : null;

  return (
    <div className="min-w-0 space-y-5">
      <header className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight">{t("grovnewsAdm.automation.title")}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("grovnewsAdm.automation.subDaily")}</p>
      </header>

      {/* ── health ─────────────────────────────────────────────────────────── */}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        <StatusCard icon={CalendarClock} title={t("grovnewsAdm.automation.scheduler.title")} data="scheduler" ok={schedulerOk}
          badge={!scheduler ? t("grovnewsAdm.automation.scheduler.unknown")
            : schedulerOk ? t("grovnewsAdm.automation.scheduler.active") : t("grovnewsAdm.automation.scheduler.inactive")}>
          {!scheduler ? <p>{t("grovnewsAdm.automation.scheduler.unknownHint")}</p>
            : !scheduler.pgCron ? <p>{t("grovnewsAdm.automation.scheduler.noCron")}</p>
            : !scheduler.jobScheduled ? <p>{t("grovnewsAdm.automation.scheduler.noJob")}</p>
            : !scheduler.triggerConfigured ? (
              <>
                <p>{t("grovnewsAdm.automation.scheduler.noTrigger")}</p>
                <CardLink href="/admin/newsletter">{t("grovnewsAdm.automation.scheduler.openSending")}</CardLink>
              </>
            ) : <p>{t(settings.dailyEnabled ? "grovnewsAdm.automation.scheduler.activeHint" : "grovnewsAdm.automation.scheduler.dailyOff")}</p>}
          {scheduler && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
              {tick ? (
                <>
                  <span>{t("grovnewsAdm.automation.scheduler.lastTick")}</span>
                  {tick.at && <span className="tabular-nums">{fmt(tick.at)}</span>}
                  <Badge tone={tickStatus === "succeeded" ? "success" : tickStatus === "failed" ? "danger" : "neutral"}>
                    {t(`grovnewsAdm.automation.tick.${tickStatus ?? "other"}`)}
                  </Badge>
                </>
              ) : <span>{t("grovnewsAdm.automation.scheduler.noTick")}</span>}
            </p>
          )}
        </StatusCard>

        <StatusCard icon={Sparkles} title={t("grovnewsAdm.automation.ai.title")} data="ai" ok={aiAvailable}
          badge={t(aiAvailable ? "grovnewsAdm.automation.ai.available" : "grovnewsAdm.automation.ai.missing")}>
          {aiAvailable ? <p>{t("grovnewsAdm.automation.ai.availableHint")}</p> : (
            <>
              <p>{t("grovnewsAdm.automation.ai.missingHint")}</p>
              <CardLink href="/admin/ai/modele?tab=dostawcy">{t("grovnewsAdm.automation.ai.openProviders")}</CardLink>
            </>
          )}
        </StatusCard>

        <StatusCard icon={KeyRound} title={t("grovnewsAdm.automation.key.title")} data="server-key" ok={serverKey}
          badge={t(serverKey ? "grovnewsAdm.automation.key.available" : "grovnewsAdm.automation.key.missing")}>
          <p>{t(serverKey ? "grovnewsAdm.automation.key.availableHint" : "grovnewsAdm.automation.key.missingHint")}</p>
        </StatusCard>
      </div>

      {/* ── run now ────────────────────────────────────────────────────────── */}
      <section className="panel flex min-w-0 flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.automation.runNow")}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {t(serverKey ? "grovnewsAdm.automation.runNowHint" : "grovnewsAdm.automation.run.errNoServerKey")}
          </p>
        </div>
        <Button onClick={runNow} disabled={running || !serverKey} className="w-full shrink-0 sm:w-auto" data-automation-run-now>
          {running ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />}
          {t(running ? "grovnewsAdm.automation.running" : "grovnewsAdm.automation.runNow")}
        </Button>
      </section>

      {/* ── settings ───────────────────────────────────────────────────────── */}
      <section className="panel min-w-0 space-y-5 rounded-2xl p-4 sm:p-5" data-automation-settings>
        <div className="min-w-0">
          <Label>{t("grovnewsAdm.automation.modeLabel")}</Label>
          <Segmented label={t("grovnewsAdm.automation.modeLabel")} value={form.mode}
            onChange={(v) => { const m = oneOf(MODES, v); if (m) set("mode", m); }}
            options={MODES.map((m) => ({ value: m, label: t(`grovnewsAdm.automation.mode.${m}`) }))} />
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" data-automation-mode={form.mode}>
            {MODES.map((m) => (
              <div key={m} className={cn("min-w-0 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed transition-colors",
                form.mode === m ? "border-[rgb(var(--accent)/0.45)] bg-accent-soft text-ink" : "border-line text-muted")}>
                <p className="mb-1 flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                  {t(`grovnewsAdm.automation.mode.${m}`)}
                  {m === "REVIEW" && <Badge tone="success">{t("grovnewsAdm.automation.safeDefault")}</Badge>}
                </p>
                {t(`grovnewsAdm.automation.modeDescDaily.${m}`)}
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 items-start justify-between gap-4 border-t border-line pt-5">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">{t("grovnewsAdm.automation.daily")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.dailyHintDaily")}</p>
          </div>
          <Switch checked={form.dailyEnabled} onChange={(v) => set("dailyEnabled", v)} label={t("grovnewsAdm.automation.daily")} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="gn-run-hour">{t("grovnewsAdm.automation.runHour")}</Label>
            <Select id="gn-run-hour" value={form.runHour} onChange={(e) => set("runHour", Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="gn-tz">{t("grovnewsAdm.automation.timezone")}</Label>
            <Input id="gn-tz" readOnly value={t("grovnewsAdm.automation.timezoneValue")} className="text-muted" />
          </div>
          <div className="min-w-0" data-automation-publish-hour>
            <Label htmlFor="gn-publish-hour">{t("grovnewsAdm.automation.publishHour")}</Label>
            <Select id="gn-publish-hour" value={form.publishHour} onChange={(e) => set("publishHour", e.target.value)}
              aria-invalid={hoursError || undefined}>
              <option value="">{t("grovnewsAdm.automation.hourAfterPrep")}</option>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={String(h)}>{hh(h)}</option>)}
            </Select>
          </div>
          <div className="min-w-0" data-automation-send-hour>
            <Label htmlFor="gn-send-hour">{t("grovnewsAdm.automation.sendHour")}</Label>
            <Select id="gn-send-hour" value={form.sendHour} onChange={(e) => set("sendHour", e.target.value)}
              aria-invalid={hoursError || undefined}>
              <option value="">{t("grovnewsAdm.automation.hourAfterPublish")}</option>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={String(h)}>{hh(h)}</option>)}
            </Select>
          </div>
          <div className="min-w-0 sm:col-span-2 -mt-1 space-y-1 text-[12px] leading-relaxed text-faint" data-automation-hours-hint>
            <p>{t("grovnewsAdm.automation.hoursHint")}</p>
            {hoursError && (
              <p role="alert" className="text-danger" data-automation-hours-error>{t("grovnewsAdm.automation.errHours")}</p>
            )}
          </div>
          <div className="min-w-0">
            <Label htmlFor="gn-min-rel">{t("grovnewsAdm.automation.minRelevance")}</Label>
            <Input id="gn-min-rel" type="number" inputMode="numeric" min={0} max={100} step={1}
              value={form.minRelevance} onChange={(e) => set("minRelevance", e.target.value)} />
          </div>
          <div className="min-w-0">
            <Label htmlFor="gn-min-imp">{t("grovnewsAdm.automation.minImportance")}</Label>
            <Input id="gn-min-imp" type="number" inputMode="numeric" min={0} max={100} step={1}
              value={form.minImportance} onChange={(e) => set("minImportance", e.target.value)} />
          </div>
          <div className="min-w-0" data-automation-min-topics>
            <Label htmlFor="gn-min-topics">{t("grovnewsAdm.automation.minTopics")}</Label>
            <Input id="gn-min-topics" type="number" inputMode="numeric" min={1} max={10} step={1}
              value={form.minTopics} onChange={(e) => set("minTopics", e.target.value)}
              aria-invalid={minTopicsError ? true : undefined}
              aria-describedby={minTopicsError ? "gn-min-topics-error" : undefined} />
            {minTopicsError && (
              <p id="gn-min-topics-error" role="alert" data-automation-min-topics-error={minTopicsError}
                className="mt-1.5 text-[12px] leading-snug text-danger">
                {minTopicsError === "range"
                  ? t("grovnewsAdm.automation.errMinTopicsRange")
                  : t("grovnewsAdm.automation.errMinTopicsAboveMax", { max: maxTopics ?? "" })}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <Label htmlFor="gn-max-topics">{t("grovnewsAdm.automation.maxTopicsDaily")}</Label>
            <Input id="gn-max-topics" type="number" inputMode="numeric" min={1} max={10} step={1}
              value={form.maxTopics} onChange={(e) => set("maxTopics", e.target.value)} />
          </div>
          <div className="min-w-0" data-automation-lookback>
            <Label htmlFor="gn-lookback">{t("grovnewsAdm.automation.lookbackHours")}</Label>
            <Select id="gn-lookback" value={form.lookbackHours} onChange={(e) => set("lookbackHours", Number(e.target.value))}>
              {lookbackOptions.map((h) => (
                <option key={h} value={h}>{t("grovnewsAdm.automation.lookbackOption", { n: h })}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="-mt-2 space-y-1 text-[12px] leading-relaxed text-faint">
          <p>{t("grovnewsAdm.automation.thresholdsHintDaily")}</p>
          <p>{t("grovnewsAdm.automation.topicsHint")}</p>
          <p>{t("grovnewsAdm.automation.lookbackHint")}</p>
        </div>

        {/* ── 0128: the AI GrovNews prefers — inside the platform's stack ──── */}
        <div className="min-w-0 space-y-3 border-t border-line pt-5" data-automation-ai-choice={form.aiProvider || "default"}>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"><Bot size={15} aria-hidden className="shrink-0 text-accent" />{t("grovnewsAdm.automation.aiTitle")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.aiHint")}</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="gn-ai-provider">{t("grovnewsAdm.automation.aiProvider")}</Label>
              <Select id="gn-ai-provider" value={form.aiProvider}
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, aiProvider: v === "openai" || v === "google" ? v : "", aiModel: "" })); }}>
                <option value="">
                  {providers && providers.platformOrder.length > 0
                    ? t("grovnewsAdm.automation.aiProviderDefault", { order: providers.platformOrder.map(providerLabel).join(" → ") })
                    : t("grovnewsAdm.automation.aiProviderDefaultNone")}
                </option>
                {AI_PROVIDERS.map((p) => <option key={p} value={p}>{providerLabel(p)}</option>)}
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="gn-ai-model">{t("grovnewsAdm.automation.aiModel")}</Label>
              <Select id="gn-ai-model" value={form.aiModel} disabled={!chosen} onChange={(e) => set("aiModel", e.target.value)}>
                <option value="">{t("grovnewsAdm.automation.aiModelDefault")}</option>
                {(chosen ? modelOptions[chosen] : []).map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          </div>
          {chosen && (
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] leading-relaxed text-muted" data-automation-ai-credential={
              !chosenStatus ? "unknown" : !chosenStatus.active ? "inactive" : chosenStatus.usable ? "ok" : "missing"}>
              <Badge tone={chosenStatus?.usable ? "success" : "warning"} dot>
                {t(!chosenStatus ? "grovnewsAdm.automation.aiCredUnknown" : !chosenStatus.active ? "grovnewsAdm.automation.aiCredInactive"
                  : chosenStatus.usable ? "grovnewsAdm.automation.aiCredOk" : "grovnewsAdm.automation.aiCredMissing")}
              </Badge>
              {!chosenStatus?.usable && <span className="min-w-0">{t("grovnewsAdm.automation.aiFallbackNote")}</span>}
            </p>
          )}
          {chosen && !chosenStatus?.usable && (
            <CardLink href="/admin/ai/modele?tab=dostawcy">{t("grovnewsAdm.automation.ai.openProviders")}</CardLink>
          )}
        </div>

        <div className="flex min-w-0 items-start justify-between gap-4 border-t border-line pt-5" data-automation-email-enabled={form.emailEnabled ? "on" : "off"}>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">{t("grovnewsAdm.automation.emailEnabled")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.emailEnabledHint")}</p>
          </div>
          <Switch checked={form.emailEnabled} onChange={(v) => set("emailEnabled", v)} label={t("grovnewsAdm.automation.emailEnabled")} />
        </div>

        {/* ── 0128: copies of the day's digest for the team ─────────────────── */}
        <div className="min-w-0 space-y-2 border-t border-line pt-5" data-automation-operators>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"><Mail size={15} aria-hidden className="shrink-0 text-accent" />{t("grovnewsAdm.automation.operatorsTitle")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.operatorsHint", { max: MAX_OPERATOR_EMAILS })}</p>
          </div>
          <Label htmlFor="gn-operators" hint={`${operators?.length ?? "—"}/${MAX_OPERATOR_EMAILS}`}>{t("grovnewsAdm.automation.operatorsLabel")}</Label>
          <Textarea id="gn-operators" rows={3} value={form.operatorEmails} spellCheck={false} autoComplete="off" inputMode="email"
            placeholder={t("grovnewsAdm.automation.operatorsPlaceholder")} aria-invalid={operatorsError || undefined}
            aria-describedby={operatorsError ? "gn-operators-error" : undefined}
            onChange={(e) => set("operatorEmails", e.target.value)} />
          {operatorsError && (
            <p id="gn-operators-error" role="alert" className="text-[12px] leading-snug text-danger" data-automation-operators-error>
              {t("grovnewsAdm.automation.errOperators", { max: MAX_OPERATOR_EMAILS })}
            </p>
          )}
        </div>

        <div className="min-w-0 border-t border-line pt-5">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t("grovnewsAdm.automation.sensitive")}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.sensitiveHint")}</p>
            </div>
            <Switch checked={form.autoPublishOfficialSensitive} label={t("grovnewsAdm.automation.sensitive")}
              onChange={(v) => set("autoPublishOfficialSensitive", v)} />
          </div>
          {form.autoPublishOfficialSensitive && (
            <p role="note" data-automation-sensitive-warning
              className="mt-3 flex min-w-0 items-start gap-2 rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.10)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              <span className="min-w-0">{t("grovnewsAdm.automation.sensitiveWarn")}</span>
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[12px] text-faint">
            {settings.updatedAt && t("grovnewsAdm.automation.updatedAt", { at: fmt(settings.updatedAt) ?? "" })}
          </p>
          <Button onClick={onSave} disabled={saving || !dirty || minTopicsError !== null || hoursError || operatorsError}
            className="w-full shrink-0 sm:w-auto" data-automation-save>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
            {t("grovnewsAdm.save")}
          </Button>
        </div>
      </section>

      {/* ── last run ───────────────────────────────────────────────────────── */}
      {runs[0] && <LastRun run={runs[0]} />}

      {/* ── recent runs ────────────────────────────────────────────────────── */}
      <section className="min-w-0 space-y-3" data-automation-runs>
        <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.automation.runsTitle")}</h2>
        <AdminTable
          empty={t("grovnewsAdm.automation.noRuns")}
          headers={[t("grovnewsAdm.automation.col.date"), t("grovnewsAdm.automation.col.status"), t("grovnewsAdm.automation.col.stage"),
            t("grovnewsAdm.automation.col.trigger"), t("grovnewsAdm.automation.col.attempts"), t("grovnewsAdm.automation.col.summary"),
            t("grovnewsAdm.automation.col.error")]}
          rows={runs.map((r) => {
            const status = oneOf(RUN_STATUSES, r.status);
            const stage = oneOf(RUN_STAGES, r.stage);
            const trigger = oneOf(RUN_TRIGGERS, r.trigger);
            return [
              <span key="d" className="block min-w-0 whitespace-nowrap" data-automation-run={r.id}>
                <span className="block tabular-nums">{editionDateLabel(r.date)}</span>
                <span className="block text-[11.5px] font-normal tabular-nums text-muted">{fmt(r.startedAt)}</span>
              </span>,
              status ? <Badge key="s" tone={RUN_TONE[status]} dot>{t(`grovnewsAdm.runStatus.${status}`)}</Badge> : "—",
              <span key="st" className="whitespace-nowrap">{stage ? t(`grovnewsAdm.runStage.${stage}`) : "—"}</span>,
              <span key="tr" className="whitespace-nowrap">{trigger ? t(`grovnewsAdm.runTrigger.${trigger}`) : "—"}</span>,
              <span key="a" className="tabular-nums">{r.invocations}</span>,
              <RunSummary key="sum" stats={r.stats} />,
              r.error ? <code key="e" className="break-all text-[11.5px] text-danger">{r.error}</code> : "",
            ];
          })}
        />
      </section>

      <ConfirmModal open={confirming} onClose={() => setConfirming(false)} onConfirm={save} pending={saving}
        title={t("grovnewsAdm.automation.confirmTitle")} body={t("grovnewsAdm.automation.confirmBody5")}
        confirmLabel={t("grovnewsAdm.automation.confirm")} />
    </div>
  );
}

function StatusCard({ icon: Icon, title, badge, ok, data, children }: {
  icon: typeof Sparkles; title: string; badge: string; ok: boolean; data: string; children: React.ReactNode;
}) {
  return (
    <div className="panel min-w-0 rounded-2xl p-4" data-automation-status={data} data-state={ok ? "ok" : "attention"}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
          <Icon size={16} aria-hidden className={ok ? "text-success" : "text-warning"} />
          <span className="truncate">{title}</span>
        </p>
        <Badge tone={ok ? "success" : "warning"} dot>{badge}</Badge>
      </div>
      <div className="mt-2 min-w-0 break-words text-[12.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-2 inline-flex min-h-9 items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
      {children}<ArrowRight size={13} aria-hidden />
    </Link>
  );
}

/** A warning line — the same plate as the sensitive-topics warning. */
function WarnLine({ children, data }: { children: React.ReactNode; data: string }) {
  return (
    <div role="note" data-automation-last-run-warning={data}
      className="flex min-w-0 items-start gap-2 rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.10)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
      <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/**
 * THE LAST RUN — what the newest run read, found, judged, wrote and sent,
 * and how it ended. Every number is read defensively from the stats blob
 * (pipeline.ts): a run still in progress, or one written before a field
 * existed, shows "—" rather than a zero it never counted.
 */
function LastRun({ run }: { run: AdminRun }) {
  const { t, locale } = useI18n();
  const fmt = useFormatDateTime();
  const s = run.stats;
  const status = oneOf(RUN_STATUSES, run.status);
  const stage = oneOf(RUN_STAGES, run.stage);
  const trigger = oneOf(RUN_TRIGGERS, run.trigger);
  const outcome = outcomeOf(s);

  const sources = num(s, "ingest", "sources");
  const failed = num(s, "ingest", "failed");
  const stale = num(s, "ingest", "stale");
  const skipped = num(s, "ingest", "skipped");
  const analyzeFailed = num(s, "analyze", "failed");
  const selected = typeof s.selected === "number" && Number.isFinite(s.selected) ? s.selected : null;

  // The same rule the run applies (pipeline.ts DRAFT): half the sources or
  // more failing sends the article to review.
  const sourcesWarn = sources !== null && sources > 0 && failed !== null && failed * 2 >= sources;
  const aiWarn = outcome === "ai_unavailable" || s.ai === "unavailable" ? "unavailable"
    : outcome === "provider_down" || s.ai === "provider_down" ? "provider_down" : null;

  // 0128: what the run spent on AI (traced per request under its id), which
  // sources failed and how, why nothing was written, whether it waits.
  const aiCalls = num(s, "ai_usage", "calls");
  const aiCost = num(s, "ai_usage", "cost_usd_micros");
  const aiUnknown = num(s, "ai_usage", "unknown_cost_calls");
  const usd = (micros: number) => new Intl.NumberFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: micros < 10_000 ? 4 : 2,
  }).format(micros / 1_000_000);
  const sourceErrors = Array.isArray(s.source_errors) ? s.source_errors : [];
  const errorKinds = SOURCE_ERROR_KINDS.map((k) => [k, sourceErrors.filter((e) =>
    e && typeof e === "object" && sourceErrorKind(String((e as Record<string, unknown>).code ?? "")) === k).length] as const)
    .filter(([, n]) => n > 0);
  const waiting = s.waiting === "publish" || s.waiting === "send" ? s.waiting : null;
  const operators = section(s, "operators");

  const metrics: { key: string; label: string; value: number | null; danger?: boolean; notes: string[] }[] = [
    { key: "sources", label: t("grovnewsAdm.automation.lastRun.sources"), value: sources, notes: [] },
    { key: "succeeded", label: t("grovnewsAdm.automation.lastRun.succeeded"), value: num(s, "ingest", "succeeded"), notes: [] },
    { key: "failed", label: t("grovnewsAdm.automation.lastRun.failed"), value: failed, danger: (failed ?? 0) > 0, notes: [] },
    { key: "found", label: t("grovnewsAdm.automation.lastRun.found"), value: num(s, "ingest", "found"), notes: [] },
    { key: "inserted", label: t("grovnewsAdm.automation.lastRun.inserted"), value: num(s, "ingest", "inserted"), notes: [] },
    {
      key: "duplicates", label: t("grovnewsAdm.automation.lastRun.duplicates"), value: num(s, "ingest", "duplicates"),
      notes: [
        ...(stale ? [t("grovnewsAdm.automation.lastRun.staleNote", { n: stale })] : []),
        ...(skipped ? [t("grovnewsAdm.automation.lastRun.skippedNote", { n: skipped })] : []),
      ],
    },
    {
      key: "analyzed", label: t("grovnewsAdm.automation.lastRun.analyzed"), value: num(s, "analyze", "analyzed"),
      notes: [
        ...(s.analyze_capped === true ? [t("grovnewsAdm.automation.lastRun.cappedNote")] : []),
        ...(analyzeFailed ? [t("grovnewsAdm.automation.lastRun.analyzeFailedNote", { n: analyzeFailed })] : []),
      ],
    },
    { key: "selected", label: t("grovnewsAdm.automation.lastRun.selected"), value: selected, notes: [] },
    {
      key: "aiCalls", label: t("grovnewsAdm.automation.lastRun.aiCalls"), value: aiCalls,
      notes: [
        ...(aiCost !== null && aiCalls && aiCost > 0 ? [t("grovnewsAdm.automation.lastRun.aiCost", { cost: usd(aiCost) })] : []),
        ...(aiUnknown ? [t("grovnewsAdm.automation.lastRun.aiCostUnknown", { n: aiUnknown })] : []),
      ],
    },
  ];

  const article = section(s, "article");
  const articleWritten = !!article && typeof article.status === "string";
  const noTopics = article ? oneOf(NO_TOPICS_REASONS, article.reason) : null;
  const articleStatus = article ? oneOf(ARTICLE_STATUSES, article.status) : null;
  const articleTopics = num(s, "article", "topics");
  const merged = num(s, "article", "merged");
  const reasons = article && Array.isArray(article.review)
    ? article.review.filter((r): r is string => typeof r === "string" && r.length > 0)
    : [];
  const editionId = str(s, "article", "edition");

  const send = section(s, "send");
  const sendStatus = send ? oneOf(SEND_STATUSES, send.status) ?? "other" : null;
  const recipients = num(s, "send", "recipients");

  const reasonText = (code: string) => {
    const known = oneOf(REVIEW_REASONS, code);
    return known ? t(`grovnewsAdm.automation.reviewReason.${known}`) : t("grovnewsAdm.automation.reviewReason.other", { code });
  };

  const meta: [string, string][] = [
    [t("grovnewsAdm.automation.col.stage"), stage ? t(`grovnewsAdm.runStage.${stage}`) : "—"],
    [t("grovnewsAdm.automation.col.trigger"), trigger ? t(`grovnewsAdm.runTrigger.${trigger}`) : "—"],
    [t("grovnewsAdm.automation.lastRun.started"), fmt(run.startedAt) ?? "—"],
    [t("grovnewsAdm.automation.lastRun.finished"), fmt(run.finishedAt) ?? "—"],
  ];

  return (
    <section className="panel min-w-0 space-y-4 rounded-2xl p-4 sm:p-5" data-automation-last-run={run.id}
      data-outcome={outcome ?? "none"}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.automation.lastRun.title")}</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold tabular-nums">{editionDateLabel(run.date)}</span>
          {status && <Badge tone={RUN_TONE[status]} dot>{t(`grovnewsAdm.runStatus.${status}`)}</Badge>}
          {waiting && status === "RUNNING" && (
            <Badge tone="info"><Clock size={12} aria-hidden />{t(`grovnewsAdm.automation.lastRun.waiting.${waiting}`)}</Badge>
          )}
        </div>
      </div>

      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-4">
        {meta.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{label}</dt>
            <dd className="mt-0.5 break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {(aiWarn || sourcesWarn) && (
        <div className="min-w-0 space-y-2">
          {aiWarn && (
            <WarnLine data={aiWarn}>
              <p>{t(aiWarn === "unavailable" ? "grovnewsAdm.automation.lastRun.warnAi" : "grovnewsAdm.automation.lastRun.warnProviderDown")}</p>
              <CardLink href="/admin/ai/modele?tab=dostawcy">{t("grovnewsAdm.automation.ai.openProviders")}</CardLink>
            </WarnLine>
          )}
          {sourcesWarn && (
            <WarnLine data="sources">
              <p>{t("grovnewsAdm.automation.lastRun.warnSources", { failed: failed ?? 0, sources: sources ?? 0 })}</p>
              <CardLink href="/admin/newsletter/grovnews/zrodla">{t("grovnewsAdm.automation.lastRun.openSources")}</CardLink>
            </WarnLine>
          )}
        </div>
      )}

      {errorKinds.length > 0 && (
        <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-muted" data-automation-last-run-source-errors>
          <span className="font-semibold">{t("grovnewsAdm.automation.lastRun.sourceErrors")}</span>
          {errorKinds.map(([k, n]) => (
            <Badge key={k} tone="warning">{t(`grovnewsAdm.sources.kind.${k}`, { n })}</Badge>
          ))}
        </p>
      )}

      <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" data-automation-last-run-metrics>
        {metrics.map((m) => (
          <div key={m.key} className="plate min-w-0 rounded-xl px-3 py-2.5" data-metric={m.key}>
            <dt className="break-words text-[11px] font-medium leading-snug text-muted">{m.label}</dt>
            <dd className={cn("mt-1 metric text-lg leading-none tabular-nums", m.danger && "text-danger")}>{m.value ?? "—"}</dd>
            {m.notes.map((n) => (
              <dd key={n} className="mt-1 break-words text-[11px] leading-snug text-faint">{n}</dd>
            ))}
          </div>
        ))}
      </dl>

      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
        <div className="plate min-w-0 rounded-xl p-3.5" data-automation-last-run-article={articleStatus ?? (article ? "none" : "unknown")}>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.automation.lastRun.article")}</p>
          {!article ? <p className="mt-1.5 text-[13px] text-muted">—</p>
            : !articleWritten ? (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted" data-automation-no-topics={noTopics ?? "unknown"}>
                {t(noTopics ? `grovnewsAdm.automation.lastRun.noTopics.${noTopics}` : "grovnewsAdm.automation.lastRun.articleNone")}
              </p>
            ) : (
              <>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                  {articleStatus
                    ? <Badge tone={articleStatus === "PUBLISHED" ? "success" : articleStatus === "DRAFT" ? "accent" : "neutral"} dot>
                      {t(`grovnewsAdm.status.${articleStatus}`)}
                    </Badge>
                    : <span className="text-[13px] text-muted">—</span>}
                  <span className="text-[12.5px] tabular-nums text-muted">
                    {t("grovnewsAdm.automation.lastRun.articleTopics", { n: articleTopics ?? "—" })}
                  </span>
                  {merged ? (
                    <span className="text-[12px] tabular-nums text-faint">{t("grovnewsAdm.automation.lastRun.merged", { n: merged })}</span>
                  ) : null}
                </div>
                {reasons.length > 0 ? (
                  <ul className="mt-2.5 min-w-0 space-y-1.5 text-[12.5px] leading-relaxed text-ink" data-automation-last-run-review>
                    {reasons.map((r) => (
                      <li key={r} className="flex min-w-0 items-start gap-1.5">
                        <AlertTriangle size={13} aria-hidden className="mt-1 shrink-0 text-warning" />
                        <span className="min-w-0 break-words">{reasonText(r)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.lastRun.reviewNone")}</p>
                )}
                {editionId && UUID_RE.test(editionId) && (
                  <CardLink href={`/admin/newsletter/grovnews/wydania/${editionId}`}>{t("grovnewsAdm.automation.lastRun.openEdition")}</CardLink>
                )}
              </>
            )}
        </div>

        <div className="plate min-w-0 rounded-xl p-3.5" data-automation-last-run-email={sendStatus ?? "none"}>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.automation.lastRun.email")}</p>
          {sendStatus ? (
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <Badge tone={SEND_TONE[sendStatus]} dot>{t(`grovnewsAdm.automation.sendStatus.${sendStatus}`)}</Badge>
              <span className="text-[12.5px] tabular-nums text-muted">
                {t("grovnewsAdm.automation.lastRun.recipients", {
                  n: sendStatus === "already_queued" || recipients === null ? "—" : recipients,
                })}
              </span>
              {operators && typeof operators.sent === "number" && (
                <span className="text-[12px] tabular-nums text-faint" data-automation-last-run-operators>
                  {t("grovnewsAdm.automation.lastRun.operators", { sent: operators.sent, failed: typeof operators.failed === "number" ? operators.failed : 0 })}
                </span>
              )}
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-[13px] text-muted">—</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                {t(outcome === "published_email_off" ? "grovnewsAdm.automation.lastRun.emailOff" : "grovnewsAdm.automation.lastRun.emailNotQueued")}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 border-t border-line pt-4 sm:flex-row sm:items-start sm:gap-4"
        data-automation-last-run-outcome={outcome ?? "none"}>
        <p className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint sm:pt-1">
          {t("grovnewsAdm.automation.lastRun.outcome")}
        </p>
        {outcome ? (
          <div className="min-w-0">
            <Badge tone={OUTCOME_TONE[outcome]} dot>{t(`grovnewsAdm.automation.outcomeShort.${outcome}`)}</Badge>
            <p className="mt-1.5 break-words text-[12.5px] leading-relaxed text-muted">{t(`grovnewsAdm.automation.outcome.${outcome}`)}</p>
          </div>
        ) : <p className="text-[13px] text-muted">—</p>}
      </div>
    </section>
  );
}

/** What a run did, from its stats blob — every field optional, since the
 *  blob grows stage by stage and an old run may lack a newer field. */
function RunSummary({ stats }: { stats: Record<string, unknown> }) {
  const { t } = useI18n();
  const parts: string[] = [];
  const sourcesOk = num(stats, "ingest", "succeeded");
  const sourcesFailed = num(stats, "ingest", "failed");
  const inserted = num(stats, "ingest", "inserted");
  const analyzed = num(stats, "analyze", "analyzed");
  const created = num(stats, "drafts", "created");
  const published = num(stats, "drafts", "published");
  const article = section(stats, "article");
  const articleStatus = article ? oneOf(ARTICLE_STATUSES, article.status) : null;
  const edition = oneOf(EDITION_STATUSES, str(stats, "edition", "status"));
  const recipients = num(stats, "send", "recipients");
  const outcome = outcomeOf(stats);
  if (sourcesOk !== null || sourcesFailed !== null) {
    parts.push(t("grovnewsAdm.automation.stats.sources", { ok: sourcesOk ?? "—", failed: sourcesFailed ?? "—" }));
  }
  if (inserted !== null) parts.push(t("grovnewsAdm.automation.stats.ingested", { n: inserted }));
  if (analyzed !== null) parts.push(t("grovnewsAdm.automation.stats.analyzed", { n: analyzed }));
  if (created !== null) parts.push(t("grovnewsAdm.automation.stats.drafts", { n: created }));
  if (published) parts.push(t("grovnewsAdm.automation.stats.published", { n: published }));
  if (articleStatus) {
    parts.push(t("grovnewsAdm.automation.stats.article", { status: t(`grovnewsAdm.automation.articleStatus.${articleStatus}`) }));
  } else if (article && num(stats, "article", "topics") === 0) {
    parts.push(t("grovnewsAdm.automation.stats.noArticle"));
  }
  if (edition) parts.push(t("grovnewsAdm.automation.stats.edition", { status: t(`grovnewsAdm.automation.editionStatus.${edition}`) }));
  if (recipients !== null) parts.push(t("grovnewsAdm.automation.stats.recipients", { n: recipients }));
  const aiCalls = num(stats, "ai_usage", "calls");
  if (aiCalls) parts.push(t("grovnewsAdm.automation.stats.aiCalls", { n: aiCalls }));
  if (stats.waiting === "publish" || stats.waiting === "send") parts.push(t(`grovnewsAdm.automation.lastRun.waiting.${stats.waiting}`));
  // The outcome line already says it when the model was the reason.
  if (outcome !== "ai_unavailable" && outcome !== "provider_down") {
    if (stats.ai === "unavailable") parts.push(t("grovnewsAdm.automation.stats.aiUnavailable"));
    if (stats.ai === "provider_down") parts.push(t("grovnewsAdm.automation.stats.aiDown"));
  }
  if (parts.length === 0 && !outcome) return <span className="text-muted">—</span>;
  return (
    <span className="block min-w-0 max-w-[22rem] break-words text-[12px] leading-snug text-muted">
      {parts.length > 0 && <span className="block">{parts.join(" · ")}</span>}
      {outcome && (
        <span className={cn("block font-semibold", parts.length > 0 && "mt-0.5",
          OUTCOME_TONE[outcome] === "danger" ? "text-danger" : OUTCOME_TONE[outcome] === "warning" ? "text-warning" : "text-ink")}
          data-run-outcome={outcome}>
          {t(`grovnewsAdm.automation.outcomeShort.${outcome}`)}
        </span>
      )}
    </span>
  );
}
