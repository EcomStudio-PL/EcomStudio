import Link from "next/link";
import { MousePointerClick, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { formatPrice } from "@/lib/utils";
import { formatRate, formatWindow, rate, resolveRange } from "@/lib/newsletter";
import {
  campaignPerformance, dashboardTotals, sourcePerformance,
  type CampaignPerformance,
} from "@/lib/services/newsletter";
import { RangePicker } from "@/components/admin/newsletter/range-picker";
import {
  KpiRow, NoSalesData, RevenuePanel, campaignStatusTone, numberFormat,
} from "@/components/admin/newsletter/kpi";
import { Funnel } from "@/components/admin/newsletter/funnel";

/**
 * ANALITYKA — the pulpit's numbers, with the rows behind them.
 *
 * Same range, same KPI component, same funnel: this screen is not a second
 * opinion about the same data, it is the same opinion with the campaigns and
 * sources unfolded underneath it. Anything that computed a metric differently
 * here would eventually contradict the dashboard, and an operator with two
 * disagreeing open rates trusts neither.
 *
 * FOUR THINGS ON THIS SCREEN DELIBERATELY PRINT "—" RATHER THAN A NUMBER.
 * Conversion and revenue, per campaign and per source, are unmeasurable until
 * there is a payments system: `hasSalesData` asks whether one exists at all,
 * and while it does not, a column of zeroes would read as "these campaigns
 * sold nothing" instead of "nothing is counting yet". The rates use `rate()`,
 * which returns null for a zero denominator, so a campaign nobody received
 * shows an unknown open rate rather than a confident 0%.
 *
 * The layout goes wide on purpose. Tables get the full content width (2100px
 * here), and the two narrow sections pair up from `xl`, because the failure
 * this module was asked to avoid is a dashboard rendered as one thin column on
 * a 1920 monitor.
 */
export default async function NewsletterAnalyticsPage({ searchParams }: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const nf = numberFormat(locale);

  const range = resolveRange(params);
  const [totals, campaigns, sources] = await Promise.all([
    dashboardTotals(supabase, range.since, range.until),
    campaignPerformance(supabase, range.since, range.until),
    sourcePerformance(supabase, range.since, range.until),
  ]);

  // One decision, applied to every conversion and money cell below. Asking
  // "did anyone pay for anything, ever" rather than "is this number zero" is
  // what separates "nobody converted" from "nothing is measuring conversions".
  const salesLive = totals.hasSalesData;
  const money = (cents: number | null) =>
    salesLive && cents !== null ? formatPrice(cents, "PLN") : "—";

  const section = "panel rounded-2xl p-4 sm:p-5";
  const heading = "mb-3 font-display text-sm font-semibold";

  /**
   * The bottom panel's ranking: by CLICK RATE, not by volume, which is what
   * makes it worth having under a table already sorted by volume — the
   * campaign that went to the most people is rarely the one that worked.
   * Campaigns nobody received are excluded first: a 100% click rate over four
   * recipients is noise, and ranking on it would pin the smallest sends to the
   * top of "best campaigns" forever.
   */
  const bestCampaigns = campaigns
    .filter((c) => c.accepted > 0)
    .sort((a, b) =>
      (b.clickedUnique / b.accepted) - (a.clickedUnique / a.accepted)
      || b.clickedUnique - a.clickedUnique)
    .slice(0, 5);

  /** The campaign rows, shared by the table and — sorted differently — by the
   *  "best campaigns" panel at the bottom. */
  const campaignCells = (c: CampaignPerformance) => [
    <Link key="n" href={`/admin/newsletter/kampanie/${c.id}`}
      className="font-medium hover:text-accent hover:underline">{c.name}</Link>,
    <Badge key="s" tone={campaignStatusTone(c.status)}>{t(`newsletter.status.${c.status}`)}</Badge>,
    <span key="sent" className="tabular-nums">{nf.format(c.sent)}</span>,
    <span key="acc" className="tabular-nums">{nf.format(c.accepted)}</span>,
    <span key="open" className="tabular-nums">
      {formatRate(rate(c.openedUnique, c.accepted), locale)}
    </span>,
    <span key="click" className="tabular-nums">
      {formatRate(rate(c.clickedUnique, c.accepted), locale)}
    </span>,
    <span key="conv" className="tabular-nums">{salesLive ? nf.format(c.converted) : "—"}</span>,
    <span key="rev" className="tabular-nums">{money(c.revenueCents)}</span>,
  ];

  return (
    <div className="space-y-5">
      <RangePicker effective={formatWindow(range, locale)} />

      {/* ── PRZEGLĄD ──────────────────────────────────────────────────────
          The identical component the dashboard uses. Not a copy of it. */}
      <section>
        <h2 className={heading}>{t("newsletter.analytics.overview")}</h2>
        <KpiRow totals={totals} />
      </section>

      <Funnel totals={totals} />

      {/* ── WYNIKI KAMPANII ───────────────────────────────────────────────
          Sorted by volume, because this is the ledger: every campaign that
          moved in the window, biggest first. The panel at the bottom is the
          one that answers "which worked best". */}
      <section>
        <h2 className={heading}>{t("newsletter.analytics.campaigns")}</h2>
        <AdminTable
          headers={[
            t("newsletter.campaigns.name"),
            t("newsletter.col.status"),
            t("newsletter.kpi.sent"),
            t("newsletter.kpi.accepted"),
            t("newsletter.kpi.openRate"),
            t("newsletter.kpi.clickRate"),
            t("newsletter.kpi.conversions"),
            t("newsletter.kpi.revenue"),
          ]}
          rows={campaigns.map(campaignCells)}
          empty={t("newsletter.analytics.noData")}
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          {t("newsletter.acceptedNote")}
        </p>
      </section>

      {/* ── ŹRÓDŁA KONTAKTÓW ──────────────────────────────────────────────
          The question this table exists for is not "where did people come
          from" — the dashboard answers that — but "which of those routes
          produced people who do anything afterwards". */}
      <section>
        <h2 className={heading}>{t("newsletter.analytics.sources")}</h2>
        <AdminTable
          headers={[
            t("newsletter.col.source"),
            t("newsletter.kpi.contacts"),
            t("newsletter.kpi.sent"),
            t("newsletter.kpi.clickRate"),
            t("newsletter.analytics.conversion"),
            t("newsletter.kpi.revenue"),
          ]}
          rows={sources.map((s) => [
            <span key="n" className="font-medium">{s.name}</span>,
            <span key="c" className="tabular-nums">{nf.format(s.contacts)}</span>,
            <span key="s" className="tabular-nums">{nf.format(s.sent)}</span>,
            <span key="cl" className="tabular-nums">
              {formatRate(rate(s.clickedUnique, s.sent), locale)}
            </span>,
            <span key="cv" className="tabular-nums">
              {salesLive ? formatRate(rate(s.converted, s.clickedUnique), locale) : "—"}
            </span>,
            <span key="r" className="tabular-nums">{money(s.revenueCents)}</span>,
          ])}
          empty={t("newsletter.analytics.noData")}
        />
      </section>

      {/* ── KONWERSJA · PRZYCHÓD ──────────────────────────────────────────
          Paired from xl so two short panels do not become two tall bands of
          whitespace on a wide monitor. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className={section}>
          <h2 className={heading}>{t("newsletter.analytics.conversion")}</h2>
          {salesLive ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label={t("newsletter.kpi.conversions")} value={nf.format(totals.converted)}
                icon={Sparkles} tone="violet" />
              {/* Of the people who clicked — the only denominator that makes
                  this a statement about the campaign rather than about how
                  many addresses happen to be on the list. */}
              <Stat label={t("newsletter.analytics.conversion")}
                value={formatRate(rate(totals.converted, totals.clickedUnique), locale)}
                hint={t("newsletter.funnel.clicked")}
                icon={MousePointerClick} tone="accent2" />
            </div>
          ) : (
            <NoSalesData variant="note" />
          )}
        </section>

        <section className={section}>
          <h2 className={heading}>{t("newsletter.analytics.revenue")}</h2>
          <RevenuePanel totals={totals} variant="note" />
        </section>
      </div>

      {/* ── NAJLEPSZE KAMPANIE ──────────────────────────────────────────── */}
      <section className={section}>
        <h2 className={heading}>{t("newsletter.analytics.top")}</h2>
        {bestCampaigns.length === 0 ? (
          <p className="text-[13px] text-muted">{t("newsletter.analytics.noData")}</p>
        ) : (
          <ul className="grid gap-2 xl:grid-cols-2 2xl:grid-cols-3">
            {bestCampaigns.map((c) => (
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
                      { label: t("newsletter.kpi.accepted"), value: nf.format(c.accepted) },
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
    </div>
  );
}
