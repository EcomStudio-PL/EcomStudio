import Link from "next/link";
import { ArrowRight, Bot, CalendarDays, Rss } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatWarsawNumeric } from "@/lib/grovnews-billing";
import { editionDateLabel } from "@/lib/grovnews-research";
import type { GrovNewsEconomics, GrovNewsWindow } from "@/lib/services/api-economics";
import type { DashboardData, Verdict } from "./dashboard-data";
import { cn } from "@/lib/utils";

type T = (key: string, vars?: Record<string, string | number>) => string;

const BASE = "/admin/newsletter/grovnews";

/** USD from micro-dollars: cents for ordinary sums, four places below a cent
 *  so a real but tiny cost never reads as $0.00. */
export function formatUsdMicros(micros: number): string {
  const usd = micros / 1_000_000;
  const digits = micros > 0 && usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd);
}

/** An AI cost window as the dashboard states it. Unknown stays unknown: a
 *  window whose only calls have no price is "unknown", never $0.00, and a
 *  partly-priced one is a floor ("≥"). */
export function aiCostLabel(w: GrovNewsWindow | null, t: T): { value: string; hint: string } {
  if (!w) return { value: "—", hint: t("grovnewsAdm.dash.noData") };
  if (w.unknownCostCalls > 0 && w.aiCostUsdMicros === 0) {
    return { value: t("grovnewsAdm.dash.unknown"), hint: t("grovnewsAdm.dash.unpricedCalls", { n: w.unknownCostCalls }) };
  }
  const value = formatUsdMicros(w.aiCostUsdMicros);
  return w.unknownCostCalls > 0
    ? { value: `≥ ${value}`, hint: t("grovnewsAdm.dash.unpricedCalls", { n: w.unknownCostCalls }) }
    : { value, hint: t("grovnewsAdm.dash.calls", { n: w.aiCalls }) };
}

function Tile({ label, value, hint, tone, badge, data }: {
  label: string; value: string | number; hint?: string; tone?: "success" | "danger" | "warning" | "muted";
  badge?: string; data?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-[rgb(var(--ink)/0.04)] px-3 py-2.5" data-grovnews-dash-tile={data}>
      <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-faint">
        <span className="min-w-0">{label}</span>
        {badge && <Badge tone="warning" className="px-1.5 py-0 text-[9.5px] normal-case tracking-normal">{badge}</Badge>}
      </p>
      <p className={cn("metric mt-1 truncate text-[19px] leading-tight",
        tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "muted" ? "text-muted" : "text-ink")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted" title={hint}>{hint}</p>}
    </div>
  );
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const linkCls = "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-raised";

/**
 * "DZISIAJ" — does GrovNews work today? One verdict badge, the automation's
 * switches, the sources' health in one line, and today's intake → edition →
 * mail → AI cost, each a counted number (or said to be unknown).
 */
export function GrovNewsTodayPanel({ data, verdict, locale, t }: { data: DashboardData; verdict: Verdict; locale: string; t: T }) {
  const { today, health, settings, economics, scheduled } = data;
  const e = today?.edition ?? null;
  const run = today?.run ?? null;
  const mail = today?.mail ?? null;
  const cost = aiCostLabel(economics?.today ?? null, t);
  const hour = hh(settings.runHour);
  const dash = "—";
  return (
    <section className="panel relative min-w-0 overflow-hidden rounded-2xl p-4 sm:p-5" aria-labelledby="gn-dash-today" data-grovnews-dash-today>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="gn-dash-today" className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
            {t("grovnewsAdm.dash.today")}
            {/* The verdict may be a sentence: it wraps on a phone instead of
                pushing the page sideways (Badge is nowrap by default). */}
            <Badge tone={verdict.tone} dot className="!whitespace-normal">{t(`grovnewsAdm.dash.verdict.${verdict.key}`, { hour })}</Badge>
          </h2>
          <p className="mt-1 text-[12.5px] text-muted">
            {t("grovnewsAdm.dash.todaySub", { date: today ? editionDateLabel(today.date) : dash })}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e && <Link href={`${BASE}/wydania/${e.id}`} className={linkCls}><CalendarDays size={14} aria-hidden />{t("grovnewsAdm.dash.openEdition")}</Link>}
          <Link href={`${BASE}/zrodla`} className={linkCls}><Rss size={14} aria-hidden />{t("grovnewsAdm.nav.sources")}</Link>
          <Link href={`${BASE}/automatyzacja`} className={linkCls}><Bot size={14} aria-hidden />{t("grovnewsAdm.nav.automation")}</Link>
        </div>
      </div>

      {/* Automation switches, as they are now. */}
      <p className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted" data-grovnews-dash-automation>
        <span className={settings.dailyEnabled ? "font-semibold text-success" : "font-semibold text-muted"}>
          {settings.dailyEnabled ? t("grovnewsAdm.dash.dailyOn") : t("grovnewsAdm.dash.dailyOff")}
        </span>
        <span aria-hidden>·</span>
        <span>{t("grovnewsAdm.dash.mode", { mode: t(`grovnewsAdm.automation.mode.${settings.mode}`) })}</span>
        <span aria-hidden>·</span>
        <span>{t("grovnewsAdm.dash.runHour", { hour })}</span>
        {settings.mode === "AUTOMATIC" && settings.publishHour !== null && (
          <><span aria-hidden>·</span><span>{t("grovnewsAdm.dash.publishHour", { hour: hh(settings.publishHour) })}</span></>
        )}
        {settings.mode === "AUTOMATIC" && settings.sendHour !== null && (
          <><span aria-hidden>·</span><span>{t("grovnewsAdm.dash.sendHour", { hour: hh(settings.sendHour) })}</span></>
        )}
        <span aria-hidden>·</span>
        <span>{settings.emailEnabled ? t("grovnewsAdm.dash.emailOn") : t("grovnewsAdm.dash.emailOff")}</span>
        {scheduled === false && (<><span aria-hidden>·</span><span className="font-semibold text-danger">{t("grovnewsAdm.dash.notScheduled")}</span></>)}
      </p>

      {/* Sources' health in one line: real counts, causes largest first. */}
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5" data-grovnews-dash-health>
        {health ? (
          <>
            <Badge tone="neutral">{t("grovnewsAdm.dash.health.total", { n: health.total })}</Badge>
            <Badge tone="success">{t("grovnewsAdm.dash.health.ok", { n: health.ok })}</Badge>
            {health.causes.map((c) => (
              <Badge key={c.bucket} tone={c.bucket === "empty" ? "warning" : "danger"}>
                {t(`grovnewsAdm.dash.bucket.${c.bucket}`, { n: c.count })}
              </Badge>
            ))}
            {health.unchecked > 0 && <Badge tone="info">{t("grovnewsAdm.dash.health.unchecked", { n: health.unchecked })}</Badge>}
            {health.disabled > 0 && <Badge tone="neutral">{t("grovnewsAdm.dash.health.disabled", { n: health.disabled })}</Badge>}
          </>
        ) : <span className="text-[12.5px] text-muted">{t("grovnewsAdm.dash.noData")}</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Tile data="sources" label={t("grovnewsAdm.dash.sourcesActive")} value={health?.enabled ?? dash} />
        <Tile data="errors" label={t("grovnewsAdm.dash.sourcesErrors")} value={health?.withErrors ?? dash}
          tone={health && health.withErrors > 0 ? "danger" : undefined} />
        <Tile data="fetched" label={t("grovnewsAdm.dash.fetched")} value={today?.items.fetched ?? dash}
          hint={today ? t("grovnewsAdm.dash.duplicates", { n: today.items.duplicates }) : undefined} />
        <Tile data="rejected" label={t("grovnewsAdm.dash.rejected")} value={today?.items.rejected ?? dash} />
        <Tile data="topics" label={t("grovnewsAdm.dash.editionItems")} value={e ? e.topics : dash} />
        <Tile data="edition" label={t("grovnewsAdm.dash.editionStatus")}
          value={e ? t(`grovnewsAdm.editionStatus.${e.status}`) : t("grovnewsAdm.dash.noEdition")}
          tone={!e ? "muted" : e.status === "FAILED" ? "danger" : e.status === "DRAFT" || e.status === "READY" ? "warning" : "success"}
          hint={e?.failureReason ?? undefined} />
        <Tile data="mail" label={t("grovnewsAdm.dash.mailStatus")}
          value={mail?.campaignStatus ? t(`grovnewsAdm.dash.campaign.${mailStatusKey(mail.campaignStatus)}`) : t("grovnewsAdm.dash.noMail")}
          tone={!mail ? "muted" : mail.failed > 0 && mail.sent === 0 ? "danger" : undefined} />
        <Tile data="recipients" label={t("grovnewsAdm.dash.recipients")} value={mail ? mail.recipients : e?.recipients ?? dash} />
        <Tile data="sent" label={t("grovnewsAdm.dash.sent")} value={mail?.sent ?? dash} tone={mail && mail.sent > 0 ? "success" : undefined} />
        <Tile data="failed" label={t("grovnewsAdm.dash.failed")} value={mail?.failed ?? dash} tone={mail && mail.failed > 0 ? "danger" : undefined} />
        <Tile data="ai-cost" label={t("grovnewsAdm.dash.aiCostToday")} value={cost.value} hint={cost.hint} badge={t("grovnewsAdm.dash.estimated")} />
      </div>

      {/* The run itself, when there is one today. */}
      <p className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted" data-grovnews-dash-run>
        {run ? (
          <>
            <span className="font-semibold text-ink">{t("grovnewsAdm.dash.run")}</span>
            <Badge tone={run.status === "FAILED" ? "danger" : run.status === "DONE" ? "success" : "info"}>{t(`grovnewsAdm.runStatus.${run.status}`)}</Badge>
            <span>{t(`grovnewsAdm.runStage.${run.stage}`)}</span>
            {run.outcome && (<><span aria-hidden>·</span><span>{t(`grovnewsAdm.automation.outcomeShort.${outcomeKey(run.outcome)}`)}</span></>)}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatWarsawNumeric(run.startedAt, locale)}</span>
            {run.error && <span className="min-w-0 basis-full break-words text-danger">{run.error}</span>}
          </>
        ) : <span>{t("grovnewsAdm.dash.noRun")}</span>}
      </p>
    </section>
  );
}

const OUTCOMES = [
  "published_queued", "published", "published_email_off", "draft_review", "no_topics", "ai_unavailable", "provider_down",
  "published_no_recipients", "published_edition_empty", "published_already_queued", "not_attached",
] as const;
const outcomeKey = (o: string) => ((OUTCOMES as readonly string[]).includes(o) ? o : "other");

const CAMPAIGN = ["draft", "scheduled", "sending", "sent", "paused", "cancelled", "failed"] as const;
const mailStatusKey = (s: string) => ((CAMPAIGN as readonly string[]).includes(s) ? s : "other");

/**
 * GROVNEWS ECONOMICS — AI cost today / 30 days (priced from the usage record,
 * so "estimated"), editions, paying subscribers, MRR, free access granted, and
 * a margin labelled as the estimate it is. Data too thin for a margin is said
 * so in words, not shown as a number.
 */
export function GrovNewsEconomicsPanel({ economics, locale, t }: { economics: GrovNewsEconomics | null; locale: string; t: T }) {
  const dash = "—";
  const today = aiCostLabel(economics?.today ?? null, t);
  const d30 = aiCostLabel(economics?.days30 ?? null, t);
  const money = (cents: number) => formatMoney(cents, economics?.currency ?? "PLN", locale);
  const partial = economics !== null && economics.days30.unknownCostCalls > 0;
  const margin = economics && economics.margin30Cents !== null && !partial ? economics.margin30Cents : null;
  return (
    <section className="panel min-w-0 rounded-2xl p-4 sm:p-5" aria-labelledby="gn-dash-econ" data-grovnews-dash-economics>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 id="gn-dash-econ" className="text-[16px] font-semibold">{t("grovnewsAdm.dash.econ.title")}</h2>
        <Link href={`${BASE}/monetyzacja`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
          {t("grovnewsAdm.nav.monetization")}<ArrowRight size={13} aria-hidden />
        </Link>
      </div>
      {economics ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <Tile data="ai-today" label={t("grovnewsAdm.dash.aiCostToday")} value={today.value} hint={today.hint} badge={t("grovnewsAdm.dash.estimated")} />
            <Tile data="ai-30" label={t("grovnewsAdm.dash.econ.ai30")} value={d30.value} hint={d30.hint} badge={t("grovnewsAdm.dash.estimated")} />
            <Tile data="editions-30" label={t("grovnewsAdm.dash.econ.editions30")} value={economics.editions30} />
            <Tile data="paid" label={t("grovnewsAdm.dash.econ.activePaid")} value={economics.activePaid} tone={economics.activePaid > 0 ? "success" : undefined} />
            <Tile data="mrr" label={t("grovnewsAdm.dash.econ.mrr")} value={money(economics.mrrCents)}
              hint={t("grovnewsAdm.dash.econ.revenue30", { amount: money(economics.revenue30Cents) })} />
            <Tile data="grants" label={t("grovnewsAdm.dash.econ.grants")} value={economics.promoActive + economics.launchActive + economics.adminGrants}
              hint={t("grovnewsAdm.dash.econ.grantsHint", { promo: economics.promoActive, launch: economics.launchActive, admin: economics.adminGrants })} />
            <Tile data="margin" label={t("grovnewsAdm.dash.econ.margin")} value={margin === null ? dash : money(margin)}
              tone={margin === null ? "muted" : margin < 0 ? "danger" : "success"} badge={t("grovnewsAdm.dash.econ.estimatedMargin")} />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted" data-grovnews-dash-margin-note>
            {margin === null
              ? partial
                ? t("grovnewsAdm.dash.econ.insufficientUnpriced", { n: economics.days30.unknownCostCalls })
                : t("grovnewsAdm.dash.econ.insufficient")
              : t("grovnewsAdm.dash.econ.marginNote")}
          </p>
        </>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted">{t("grovnewsAdm.dash.econ.unavailable")}</p>
      )}
    </section>
  );
}
