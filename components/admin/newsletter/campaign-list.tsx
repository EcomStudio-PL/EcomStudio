import Link from "next/link";
import { Send } from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { cn, formatDate, formatPrice } from "@/lib/utils";
import { CAMPAIGN_STATUSES, formatRate, rate } from "@/lib/newsletter";
import type { CampaignPerformance, CampaignRow } from "@/lib/services/newsletter";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { campaignStatusTone, numberFormat, NoSalesData } from "@/components/admin/newsletter/kpi";
import { NewCampaignButton } from "@/components/admin/newsletter/campaign-new";

/**
 * THE CAMPAIGN REGISTER.
 *
 * A SERVER COMPONENT, and that is a decision rather than an accident. Every
 * rule this table has to obey about how a newsletter number may be presented
 * already lives in a server module — `campaignStatusTone` so that Pulpit,
 * Analityka and this screen never colour "Wysyłanie" three different ways, and
 * `NoSalesData` so the answer to "what is the revenue" is worded once. Those
 * live next to `getDictionary`, which reads cookies, so a client component
 * cannot import them; making this list a client component would therefore have
 * meant a second copy of the tone map and a second wording of the sales
 * caveat — which is exactly the drift the shared helpers were written to stop.
 *
 * So everything here renders on the server, the filter and the pager are plain
 * links (shareable, and correct with JavaScript still loading), and the only
 * client code on the screen is the one genuinely interactive control: the
 * button that creates a draft.
 *
 * WHAT THE RATES ARE OVER. Open and click rates are measured against ACCEPTED
 * messages, not against the audience — a message the mail server never took
 * cannot be opened, and dividing by the audience would quietly punish every
 * campaign with a hard bounce in it. A rate with a zero denominator is
 * unknown, so `rate()` returns null and `formatRate()` prints "—": a campaign
 * that has not gone out yet has no open rate, which is a different statement
 * from an open rate of 0 %.
 *
 * AND THE REVENUE COLUMN NEVER PRINTS A ZERO. Production has no payments at
 * all, so nothing is attributed to any campaign and `revenueCents` is null all
 * the way down. Each cell prints "—" and one note under the table explains
 * why, because "0 zł" in a revenue column does not read as "billing is not
 * connected" — it reads as "the newsletter earns nothing", which is a business
 * conclusion drawn from a measurement nobody took.
 */

/** Zeroes for a campaign the aggregate has never heard of — a draft, or one
 *  whose every recipient row was deleted with it. Written once so the table
 *  cannot accidentally treat "no activity" as "no campaign". */
const NO_ACTIVITY = {
  recipients: 0, sent: 0, accepted: 0, failed: 0,
  openedUnique: 0, clickedUnique: 0, replied: 0, unsubscribed: 0,
  converted: 0, revenueCents: null,
} as const;

export async function CampaignList({ rows, performance, total, page, pages, status }: {
  rows: CampaignRow[];
  performance: CampaignPerformance[];
  total: number;
  page: number;
  pages: number;
  /** The status the list is currently filtered to, already validated. */
  status?: string;
}) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const nf = numberFormat(locale);

  const byId = new Map(performance.map((p) => [p.id, p]));

  /** One place that builds this screen's links, so the pager cannot drop the
   *  filter and the filter cannot strand somebody on page four of a list that
   *  now has one page. */
  const href = (next: { status?: string; page?: number }) => {
    const params = new URLSearchParams();
    if (next.status) params.set("status", next.status);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    return `/admin/newsletter/kampanie${params.size ? `?${params}` : ""}`;
  };

  const pill = (on: boolean) => cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2",
    "text-[12.5px] font-semibold transition-colors duration-150",
    on ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink",
  );

  const headers = [
    t("common.name"),
    t("newsletter.col.status"),
    t("newsletter.funnel.recipients"),
    t("newsletter.kpi.sent"),
    t("newsletter.kpi.openRate"),
    t("newsletter.kpi.clickRate"),
    t("newsletter.kpi.replies"),
    t("newsletter.kpi.conversions"),
    t("newsletter.kpi.revenue"),
    t("newsletter.col.created"),
  ];

  /* Is ANYTHING attributing money yet? Asked once, over the whole page, and
     used for the conversions column as well as the note under the table: a
     conversion is an attribution row with `converted_at` set, and the same
     missing payments system that keeps every `revenueCents` null is what keeps
     every `converted` at zero. A column of zeroes reads as "these campaigns
     sold nothing" rather than "nothing is counting", which is the one reading
     this module refuses to allow anywhere else. */
  const anyRevenue = performance.some((p) => p.revenueCents !== null);

  const tableRows = rows.map((campaign) => {
    const stats = byId.get(campaign.id) ?? NO_ACTIVITY;
    return [
      <Link key="name" href={`/admin/newsletter/kampanie/${campaign.id}`}
        data-campaign={campaign.id}
        className="block min-w-0 text-ink transition-colors hover:text-accent">
        <span className="block break-words font-semibold">{campaign.name}</span>
        {/* The kind only earns a line when it is not the ordinary case: every
            campaign being labelled "Jednorazowa" teaches an operator to stop
            reading the column that would have told them about a sequence. */}
        {campaign.kind !== "one_off" && (
          <span className="mt-0.5 block text-[11px] text-faint">
            {t(`newsletter.kind.${campaign.kind}`)}
          </span>
        )}
      </Link>,
      <Badge key="status" tone={campaignStatusTone(campaign.status)}>
        {t(`newsletter.status.${campaign.status}`)}
      </Badge>,
      <span key="recipients" className="tabular-nums">{nf.format(stats.recipients)}</span>,
      <span key="sent" className="tabular-nums">{nf.format(stats.sent)}</span>,
      <span key="open" className="tabular-nums">
        {formatRate(rate(stats.openedUnique, stats.accepted), locale)}
      </span>,
      <span key="click" className="tabular-nums">
        {formatRate(rate(stats.clickedUnique, stats.accepted), locale)}
      </span>,
      <span key="reply" className="tabular-nums">{nf.format(stats.replied)}</span>,
      <span key="converted" className="tabular-nums">
        {anyRevenue ? nf.format(stats.converted) : "—"}
      </span>,
      // Never a zero: null means nothing was ever attributed, and the note
      // under the table says what that is about.
      <span key="revenue" className="tabular-nums text-muted">
        {stats.revenueCents === null ? "—" : formatPrice(stats.revenueCents, "PLN")}
      </span>,
      <span key="created" className="whitespace-nowrap text-muted">
        {formatDate(campaign.createdAt, locale)}
      </span>,
    ];
  });

  return (
    <div data-campaign-list className="space-y-4">
      {/* ── FILTER AND THE ONE BUTTON ──────────────────────────────────────
          Links rather than a select: a filtered list is something an operator
          sends to somebody, and it has to survive a refresh. The row scrolls
          sideways inside its own gutter at 320px instead of widening the
          page. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="-mx-4 min-w-0 flex-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max min-w-full items-center gap-1.5 pb-0.5 sm:w-auto sm:flex-wrap">
            <Link href={href({})} className={pill(!status)} data-campaign-filter="">
              {t("newsletter.filter.all")}
            </Link>
            {CAMPAIGN_STATUSES.map((value) => (
              <Link key={value} href={href({ status: value })} data-campaign-filter={value}
                className={pill(status === value)}>
                {t(`newsletter.status.${value}`)}
              </Link>
            ))}
          </div>
        </div>
        <NewCampaignButton />
      </div>

      {/* An empty LIST and an empty FILTER are different situations and get
          different words. Only the first one deserves the "start here" hint —
          telling somebody how to write their first campaign when they have
          forty of them and simply filtered to "Anulowane" is noise. */}
      {rows.length === 0 ? (
        status ? (
          <EmptyState
            icon={Send}
            title={t("newsletter.campaigns.none")}
            action={
              <Link href={href({})} className={pill(false)}>{t("newsletter.filter.clear")}</Link>
            }
          />
        ) : (
          <EmptyState
            icon={Send}
            title={t("newsletter.campaigns.none")}
            body={t("newsletter.campaigns.noneHint")}
            action={<NewCampaignButton />}
          />
        )
      ) : (
        <>
          <AdminTable headers={headers} rows={tableRows}
            empty={t("newsletter.campaigns.none")} />

          {/* THE TWO CAVEATS, ONCE, UNDER THE COLUMNS THEY QUALIFY. Repeating
              them on every cell turns a caveat into wallpaper; leaving them
              out turns an approximation into a claim. */}
          <div className="space-y-1.5">
            <p className="text-[12px] leading-relaxed text-faint" data-open-rate-note>
              {t("newsletter.openRateNote")}
            </p>
            <p className="text-[12px] leading-relaxed text-faint" data-accepted-note>
              {t("newsletter.acceptedNote")}
            </p>
          </div>

          {/* The revenue column's explanation, shown only while there is
              nothing to explain away. The moment one campaign has an
              attributed amount, the column is a measurement and the note
              would be wrong. */}
          {!anyRevenue && <NoSalesData variant="note" />}

          {pages > 1 && (
            <div className="flex flex-wrap items-center justify-end gap-3 text-[13px] text-muted">
              <span className="tabular-nums">
                {t("common.pageOf", { a: page, b: pages })} · {total}
              </span>
              <div className="flex items-center gap-1.5">
                {page > 1 && (
                  <Link href={href({ status, page: page - 1 })} className={pill(false)}
                    aria-label={t("common.back")} data-campaign-prev>‹</Link>
                )}
                {page < pages && (
                  <Link href={href({ status, page: page + 1 })} className={pill(false)}
                    aria-label={t("common.next")} data-campaign-next>›</Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
