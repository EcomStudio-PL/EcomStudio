import Link from "next/link";
import { BarChart3, Send, Users } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Badge } from "@/components/ui/badge";
import { formatRate, rate } from "@/lib/newsletter";
import type {
  CampaignPerformance, DashboardTotals, SchedulerStatus, SourceRow,
} from "@/lib/services/newsletter";
import type { NewsletterSettings } from "@/lib/server/newsletter/settings";
import { RangePicker } from "@/components/admin/newsletter/range-picker";
import { KpiRow, RevenuePanel, campaignStatusTone, numberFormat } from "@/components/admin/newsletter/kpi";
import { Funnel } from "@/components/admin/newsletter/funnel";
import { SendingPanel } from "@/components/admin/newsletter/sending-panel";

/**
 * PULPIT — what the newsletter is doing, arranged so the answer arrives in the
 * order an operator needs it.
 *
 * The layout is a claim about attention. Numbers first, because that is what
 * the screen was opened for. The funnel next to the sending panel, because the
 * two questions that follow a bad number are "where did they drop out" and "is
 * the queue actually moving" — side by side from `xl` up, since this app's
 * content area runs to 2100px and a single 700px column on a 1920 monitor is a
 * mobile layout somebody forgot to finish.
 *
 * THIS COMPONENT DOES NO FETCHING. Every number arrives as a prop from the
 * page, so the whole screen is one waterfall-free `Promise.all` up there
 * instead of six components each waiting on their own round trip.
 */
export async function Dashboard({
  effective, totals, queued, settings, scheduler, campaigns, sources,
}: {
  effective: string;
  totals: DashboardTotals;
  queued: number;
  settings: NewsletterSettings;
  scheduler: SchedulerStatus;
  campaigns: CampaignPerformance[];
  sources: SourceRow[];
}) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const nf = numberFormat(locale);

  // The widest source, so the share bars below have something honest to be a
  // fraction of. Math.max over an empty list is -Infinity, hence the seed.
  const widestSource = Math.max(1, ...sources.map((s) => s.contacts));

  return (
    <div className="space-y-5">
      <RangePicker effective={effective} />

      <KpiRow totals={totals} />

      {/* Revenue is either a measurement or a sentence, never a zero — see
          RevenuePanel for why that distinction is not pedantry here. */}
      <RevenuePanel totals={totals} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Funnel totals={totals} />
        <SendingPanel queued={queued} paused={settings.paused} ratePerHour={settings.ratePerHour}
          lastRunAt={settings.lastRunAt} lastRunSent={settings.lastRunSent}
          lastRunFailed={settings.lastRunFailed} scheduler={scheduler} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── TOP CAMPAIGNS ────────────────────────────────────────────────
            Names alone would be a list of links. What makes this worth the
            space is the three figures under each one: a campaign is "top"
            because of what it did, and an operator should be able to see
            which of these to open without opening any of them. */}
        <section className="panel rounded-2xl p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold">
            <BarChart3 size={15} className="text-accent" aria-hidden />
            {t("newsletter.analytics.top")}
          </h2>

          {campaigns.length === 0 ? (
            <p className="text-[13px] text-muted">{t("newsletter.analytics.noData")}</p>
          ) : (
            <ul className="space-y-2">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/newsletter/kampanie/${c.id}`}
                    data-top-campaign={c.id}
                    className="plate block rounded-xl px-3.5 py-3 transition-colors hover:bg-raised">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] font-semibold">{c.name}</span>
                      <Badge tone={campaignStatusTone(c.status)} className="shrink-0">
                        {t(`newsletter.status.${c.status}`)}
                      </Badge>
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2">
                      {[
                        { label: t("newsletter.kpi.sent"), value: nf.format(c.sent) },
                        {
                          label: t("newsletter.kpi.openRate"),
                          value: formatRate(rate(c.openedUnique, c.accepted), locale),
                        },
                        {
                          label: t("newsletter.kpi.clickRate"),
                          value: formatRate(rate(c.clickedUnique, c.accepted), locale),
                        },
                      ].map((cell) => (
                        <div key={cell.label} className="min-w-0">
                          <dt className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                            {cell.label}
                          </dt>
                          <dd className="mt-0.5 tabular-nums text-[13px] font-medium">{cell.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── WHERE THE LIST COMES FROM ───────────────────────────────────
            A bar per source rather than a bare count: "form 812 / import 40"
            is four words an operator has to do arithmetic on, and the shape
            of the list is the actual finding. */}
        <section className="panel rounded-2xl p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold">
            <Users size={15} className="text-accent" aria-hidden />
            {t("newsletter.analytics.sources")}
          </h2>

          {sources.length === 0 ? (
            <p className="text-[13px] text-muted">{t("newsletter.analytics.noData")}</p>
          ) : (
            <ul className="space-y-2.5">
              {sources.map((s) => (
                <li key={s.key} data-source={s.key} className="min-w-0">
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate font-medium">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">{nf.format(s.contacts)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-[rgb(var(--accent2))]"
                      style={{ width: `${Math.min(100, (s.contacts / widestSource) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* One way out of the summary and into the detail. The nav has the same
          link, but a dashboard that ends in a dead end makes an operator go
          hunting for the tab they were already looking at. */}
      <div className="flex justify-end">
        <Link href="/admin/newsletter/analityka"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline">
          <Send size={14} aria-hidden />
          {t("newsletter.analytics.title")}
        </Link>
      </div>
    </div>
  );
}
