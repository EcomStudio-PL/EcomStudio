"use client";
import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Pause, Play, Send, Wrench } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  provisionSchedulerAction, runWorkerNowAction,
  setNewsletterPausedAction, setNewsletterRateAction,
} from "@/app/actions/newsletter";
import type { SchedulerStatus } from "@/lib/services/newsletter";

/** The chain, in the order an operator should fix it: extensions first
 *  (nothing else can be true without them), then the job, then the two
 *  secrets. Only the FIRST broken link is named, because a list of five
 *  problems where four are consequences of the first is not a list of five
 *  problems. */
function firstMissingLink(s: SchedulerStatus): string | null {
  if (!s.pgCron) return "pgCron";
  if (!s.pgNet) return "pgNet";
  if (!s.jobScheduled) return "job";
  if (!s.urlConfigured) return "url";
  if (!s.tokenConfigured) return "token";
  return null;
}

/**
 * THE SENDING PANEL — the kill switch, the rate dial, and what the worker did.
 *
 * TWO THINGS HERE ARE SAFETY EQUIPMENT, not settings.
 *
 * The pause is §74's kill switch, and its blast radius has to be stated on
 * screen: it stops MARKETING and nothing else. An operator hitting it during
 * an incident must not have to wonder whether they have just stopped password
 * resets and login codes as well — they have not, and the hint says so.
 *
 * The rate is not a performance knob. This app sends through one shared
 * mailbox whose SMTP password is also the admin inbox's IMAP password, so
 * sending too fast does not deliver sooner — it gets the identity throttled
 * and takes the inbox down with it. Hence the warning under the field.
 */
export function SendingPanel({
  queued, paused, ratePerHour, lastRunAt, lastRunSent, lastRunFailed, scheduler,
}: {
  queued: number;
  paused: boolean;
  ratePerHour: number;
  lastRunAt: string | null;
  lastRunSent: number;
  lastRunFailed: number;
  scheduler: SchedulerStatus;
}) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [rate, setRate] = useState(String(ratePerHour));

  const run = (promise: Promise<{ ok: boolean; error?: string }>, ok: string) => {
    start(async () => {
      const res = await promise;
      if (res.ok) toast.success(ok);
      else toast.error(t(`newsletter.err.${res.error ?? "generic"}`));
    });
  };

  return (
    <section className="panel rounded-2xl p-4" data-sending-panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold">{t("newsletter.worker.title")}</h2>
        <span className="text-[12.5px] text-muted">
          {t("newsletter.worker.queue")}: <span className="tabular-nums font-semibold">{queued}</span>
        </span>
      </div>

      {/* THE SCHEDULER, WHEN IT IS NOT ACTUALLY RUNNING.
          Above the pause banner on purpose: pausing is a decision somebody
          made, while this is a campaign scheduled for 18:00 that will sit at
          "zaplanowana" forever because nothing is there to fire it. Without
          this block the screen shows a queue, a rate and a working "Wyślij
          teraz" button — every one of them true — and still sends nothing on
          schedule. One line names the broken link so it can be fixed rather
          than hunted for; "Wyślij teraz" keeps working meanwhile, which is
          why the block informs instead of blocking. */}
      {!scheduler.ready && (
        <div className="mb-3 rounded-xl border border-[rgb(var(--danger)/0.4)] bg-[rgb(var(--danger)/0.08)] px-3.5 py-3"
          data-scheduler-down>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <AlertTriangle size={14} aria-hidden className="shrink-0 text-[rgb(var(--danger))]" />
            {t("newsletter.scheduler.down")}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {t("newsletter.scheduler.downHint")}
          </p>
          <p className="mt-1.5 text-[12px] font-medium text-muted" data-scheduler-missing>
            {t(`newsletter.scheduler.missing.${firstMissingLink(scheduler) ?? "token"}`)}
          </p>

          {/* A BUTTON, NOT AN INSTRUCTION. The two missing values are this
              deployment's own address and a token derived from a server key —
              neither is something an operator can go and look up, so naming
              them and stopping was a dead end. Both are already known to the
              server; this asks it to write them. Only offered for the two
              vault links: missing extensions or an unscheduled job are a
              database migration's job, not a button's. */}
          {(firstMissingLink(scheduler) === "url" || firstMissingLink(scheduler) === "token") && (
            <Button size="sm" variant="primary" className="mt-2.5" disabled={pending}
              data-scheduler-fix
              onClick={() => run(provisionSchedulerAction(), t("newsletter.scheduler.fixed"))}>
              {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Wrench size={14} aria-hidden />}
              {t("newsletter.scheduler.fix")}
            </Button>
          )}
        </div>
      )}

      {paused && (
        <div className="mb-3 rounded-xl border border-[rgb(var(--caution)/0.4)] bg-[rgb(var(--caution)/0.08)] px-3.5 py-3"
          data-sending-paused>
          <p className="text-[13px] font-semibold text-ink">{t("newsletter.worker.paused")}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {t("newsletter.worker.pausedHint")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Button size="sm" variant={paused ? "primary" : "secondary"} disabled={pending}
          data-toggle-pause
          onClick={() => run(
            setNewsletterPausedAction(!paused),
            paused ? t("newsletter.worker.resume") : t("newsletter.worker.paused"),
          )}>
          {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
          {paused ? t("newsletter.worker.resume") : t("newsletter.worker.pause")}
        </Button>

        <Button size="sm" variant="secondary" disabled={pending || paused} data-run-now
          onClick={() => run(runWorkerNowAction(), t("newsletter.schedule.started"))}>
          {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Send size={14} aria-hidden />}
          {/* "Wyślij teraz", not "Wysyłka" — the panel is already titled
              "Wysyłka", and a button wearing its own section's name tells an
              operator nothing about what pressing it does. This one drains the
              queue now instead of waiting for the next scheduled run. */}
          {t("newsletter.schedule.now")}
        </Button>

        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">{t("newsletter.worker.rate")}</span>
          <span className="flex items-center gap-2">
            <Input value={rate} inputMode="numeric" className="w-24" data-rate-input
              onChange={(e) => setRate(e.target.value.replace(/\D/g, ""))}
              onBlur={() => {
                const next = Number.parseInt(rate, 10);
                if (Number.isFinite(next) && next !== ratePerHour) {
                  run(setNewsletterRateAction(next), t("newsletter.worker.rate"));
                }
              }} />
            <span className="text-[12px] text-faint">{t("newsletter.worker.ratePerHour")}</span>
          </span>
        </label>
      </div>

      {/* THE BLAST RADIUS IS STATED BEFORE THE BUTTON IS PRESSED, not only in
          the banner afterwards. An operator reaching for a kill switch during
          an incident is deciding whether they are about to stop password
          resets and login codes too; learning the answer once the switch is
          already thrown is learning it too late. When paused, the banner above
          carries the same sentence, so it is never absent. */}
      {!paused && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint" data-pause-blast-radius>
          {t("newsletter.worker.pausedHint")}
        </p>
      )}

      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t("newsletter.worker.rateHint")}</p>

      <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted" data-last-run>
        {t("newsletter.worker.lastRun")}:{" "}
        {lastRunAt
          ? `${formatDate(lastRunAt, locale)} · ${lastRunSent} / ${lastRunFailed}`
          : t("newsletter.worker.never")}
      </p>
    </section>
  );
}
