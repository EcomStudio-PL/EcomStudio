"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, CalendarClock, KeyRound, Loader2, Play, Save, Sparkles,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { Segmented } from "@/components/ui/segmented";
import { AdminTable } from "@/components/ui/admin-table";
import { runDailyNowAction, saveSettingsAction } from "@/app/actions/grovnews-research";
import { EDITION_STATUSES, MODES, RUN_STAGES, editionDateLabel, type GrovNewsMode } from "@/lib/grovnews-research";
import type { AdminRun, AdminSettings, SchedulerStatus } from "@/lib/services/grovnews-research";
import { cn } from "@/lib/utils";

/**
 * GROVNEWS AUTOMATION — the mode, the daily schedule, and what the job did.
 *
 * REVIEW is the default and the safe mode: the job fetches, analyses, drafts
 * and prepares the edition, and a person publishes and sends. AUTOMATIC lets
 * confident items through on its own, so turning it on is confirmed before it
 * is saved. Whatever this screen says, the database re-checks every publish
 * and the pipeline never auto-publishes an item flagged for review.
 *
 * The three health cards (scheduler, AI, server key) say what is missing in
 * words an admin can act on — never a raw code, never an environment variable.
 */

const RUN_STATUSES = ["RUNNING", "DONE", "FAILED"] as const;
const RUN_TRIGGERS = ["CRON", "ADMIN"] as const;
const RUN_TONE: Record<(typeof RUN_STATUSES)[number], "info" | "success" | "danger"> = {
  RUNNING: "info", DONE: "success", FAILED: "danger",
};
const SKIP_REASONS = ["done", "busy", "gave_up", "failed"] as const;
const TICKS = ["succeeded", "failed", "running"] as const;

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

type Form = {
  mode: GrovNewsMode; dailyEnabled: boolean; runHour: number;
  minRelevance: string; minImportance: string; maxTopics: string; autoPublishOfficialSensitive: boolean;
};

const fromSettings = (s: AdminSettings): Form => ({
  mode: s.mode, dailyEnabled: s.dailyEnabled, runHour: s.runHour,
  minRelevance: String(s.minRelevance), minImportance: String(s.minImportance), maxTopics: String(s.maxTopics),
  autoPublishOfficialSensitive: s.autoPublishOfficialSensitive,
});

export function AutomationPanel({ settings, scheduler, runs, aiAvailable, serverKey }: {
  settings: AdminSettings;
  scheduler: SchedulerStatus | null;
  runs: AdminRun[];
  aiAvailable: boolean;
  serverKey: boolean;
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

  const save = () => startSave(async () => {
    const res = await saveSettingsAction({
      mode: form.mode, dailyEnabled: form.dailyEnabled, runHour: form.runHour,
      minRelevance: Number(form.minRelevance), minImportance: Number(form.minImportance), maxTopics: Number(form.maxTopics),
      autoPublishOfficialSensitive: form.autoPublishOfficialSensitive,
    });
    setConfirming(false);
    if (res.ok) { toast.success(t("grovnewsAdm.saved")); router.refresh(); return; }
    toast.error(t(res.error === "invalid" ? "grovnewsAdm.automation.errInvalid"
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
    else if (res.status === "partial") {
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
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("grovnewsAdm.automation.sub")}</p>
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
                {t(`grovnewsAdm.automation.modeDesc.${m}`)}
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 items-start justify-between gap-4 border-t border-line pt-5">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">{t("grovnewsAdm.automation.daily")}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.automation.dailyHint")}</p>
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
          <div className="min-w-0">
            <Label htmlFor="gn-max-topics">{t("grovnewsAdm.automation.maxTopics")}</Label>
            <Input id="gn-max-topics" type="number" inputMode="numeric" min={1} max={10} step={1}
              value={form.maxTopics} onChange={(e) => set("maxTopics", e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-[12px] leading-relaxed text-faint">{t("grovnewsAdm.automation.thresholdsHint")}</p>

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
          <Button onClick={onSave} disabled={saving || !dirty} className="w-full shrink-0 sm:w-auto" data-automation-save>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
            {t("grovnewsAdm.save")}
          </Button>
        </div>
      </section>

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
        title={t("grovnewsAdm.automation.confirmTitle")} body={t("grovnewsAdm.automation.confirmBody")}
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

/** What a run did, from its stats blob — every field optional, since the
 *  blob grows stage by stage and an old run may lack a newer field. */
function RunSummary({ stats }: { stats: Record<string, unknown> }) {
  const { t } = useI18n();
  const parts: string[] = [];
  const inserted = num(stats, "ingest", "inserted");
  const analyzed = num(stats, "analyze", "analyzed");
  const created = num(stats, "drafts", "created");
  const published = num(stats, "drafts", "published");
  const edition = oneOf(EDITION_STATUSES, str(stats, "edition", "status"));
  const recipients = num(stats, "send", "recipients");
  if (inserted !== null) parts.push(t("grovnewsAdm.automation.stats.ingested", { n: inserted }));
  if (analyzed !== null) parts.push(t("grovnewsAdm.automation.stats.analyzed", { n: analyzed }));
  if (created !== null) parts.push(t("grovnewsAdm.automation.stats.drafts", { n: created }));
  if (published) parts.push(t("grovnewsAdm.automation.stats.published", { n: published }));
  if (edition) parts.push(t("grovnewsAdm.automation.stats.edition", { status: t(`grovnewsAdm.automation.editionStatus.${edition}`) }));
  if (recipients !== null) parts.push(t("grovnewsAdm.automation.stats.recipients", { n: recipients }));
  if (stats.ai === "unavailable") parts.push(t("grovnewsAdm.automation.stats.aiUnavailable"));
  if (stats.ai === "provider_down") parts.push(t("grovnewsAdm.automation.stats.aiDown"));
  if (parts.length === 0) return <span className="text-muted">—</span>;
  return <span className="block min-w-0 max-w-[22rem] text-[12px] leading-snug text-muted">{parts.join(" · ")}</span>;
}
