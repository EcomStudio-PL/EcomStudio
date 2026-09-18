import Link from "next/link";
import {
  BarChart3, CheckCheck, MailX, MousePointerClick, Reply, Send, Sparkles,
  TriangleAlert, UserPlus, Users, Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRate, rate } from "@/lib/newsletter";
import { dashboardTotals, listCampaigns, listSources, queueDepth } from "@/lib/services/newsletter";
import { readSettings } from "@/lib/server/newsletter/settings";
import { RangePicker, resolveRange } from "@/components/admin/newsletter/range-picker";
import { Funnel } from "@/components/admin/newsletter/funnel";
import { SendingPanel } from "@/components/admin/newsletter/sending-panel";

/**
 * PULPIT — what the newsletter is actually doing, before anything else.
 *
 * The order of this screen is an argument about which numbers deserve trust.
 * Contacts and sends are facts. Open rate is a guess and is labelled as one,
 * because Apple Mail Privacy Protection opens messages on the recipient's
 * behalf and inflates it for everyone. Clicks, replies and conversions are
 * the ones worth acting on, so they sit next to it rather than below it.
 *
 * REVENUE IS EITHER A MEASUREMENT OR A SENTENCE, never a zero. Production has
 * no payments table rows at all, so a "0 zł" tile here would not be a small
 * number — it would be a fabricated one, and an operator would read it as
 * "the newsletter earns nothing" rather than "nothing is hooked up yet".
 */
export default async function NewsletterDashboard({ searchParams }: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const range = resolveRange(params);
  const [totals, queued, settings, campaigns, sources] = await Promise.all([
    dashboardTotals(supabase, range.since, range.until),
    queueDepth(supabase),
    readSettings(supabase),
    listCampaigns(supabase, { pageSize: 5 }),
    listSources(supabase),
  ]);

  const openRate = rate(totals.openedUnique, totals.sent);
  const clickRate = rate(totals.clickedUnique, totals.sent);
  const replyRate = rate(totals.replied, totals.sent);
  const unsubRate = rate(totals.unsubscribed, totals.sent);
  const nf = new Intl.NumberFormat(locale === "pl" ? "pl-PL" : locale);

  return (
    <div className="space-y-5">
      <RangePicker />

      {/* ── THE NUMBERS ──────────────────────────────────────────────────
          Four across on a laptop, two on a phone. A 1920 monitor gets six,
          because a dashboard rendered as one narrow column on a wide screen
          is a mobile layout somebody forgot to finish. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        <Stat label={t("newsletter.kpi.contacts")} value={nf.format(totals.contacts)}
          icon={Users} tone="accent" />
        <Stat label={t("newsletter.kpi.newContacts")} value={nf.format(totals.newContacts)}
          icon={UserPlus} tone="violet" />
        <Stat label={t("newsletter.kpi.sent")} value={nf.format(totals.sent)}
          icon={Send} tone="indigo" />
        <Stat label={t("newsletter.kpi.accepted")} value={nf.format(totals.accepted)}
          hint={t("newsletter.acceptedNote")} icon={CheckCheck} tone="success" />
        <Stat label={t("newsletter.kpi.openRate")} value={formatRate(openRate, locale)}
          hint={`${nf.format(totals.openedUnique)} ${t("newsletter.kpi.unique")}`}
          icon={BarChart3} tone="purple" />
        <Stat label={t("newsletter.kpi.clickRate")} value={formatRate(clickRate, locale)}
          hint={`${nf.format(totals.clickedUnique)} ${t("newsletter.kpi.unique")}`}
          icon={MousePointerClick} tone="accent2" />
        <Stat label={t("newsletter.kpi.replies")} value={nf.format(totals.replied)}
          hint={formatRate(replyRate, locale)} icon={Reply} tone="indigo" />
        <Stat label={t("newsletter.kpi.conversions")} value={nf.format(totals.converted)}
          icon={Sparkles} tone="violet" />
        <Stat label={t("newsletter.kpi.unsubscribes")} value={nf.format(totals.unsubscribed)}
          hint={formatRate(unsubRate, locale)} icon={MailX} />
        <Stat label={t("newsletter.kpi.failed")} value={nf.format(totals.failed)}
          icon={TriangleAlert} />
      </div>

      <p className="text-[12px] leading-relaxed text-faint">{t("newsletter.openRateNote")}</p>

      {/* ── REVENUE ──────────────────────────────────────────────────────
          The one tile that refuses to be a number until there is something
          to count. See the note at the top of this file. */}
      {totals.hasSalesData && totals.revenueCents !== null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={t("newsletter.kpi.revenue")}
            value={new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" })
              .format(totals.revenueCents / 100)}
            icon={Wallet} tone="success" />
        </div>
      ) : (
        <EmptyState icon={Wallet}
          title={t("newsletter.noSalesData")}
          body={t("newsletter.noSalesDataHint")} />
      )}

      <Funnel totals={totals} />

      <SendingPanel queued={queued} paused={settings.paused} ratePerHour={settings.ratePerHour}
        lastRunAt={settings.lastRunAt} lastRunSent={settings.lastRunSent}
        lastRunFailed={settings.lastRunFailed} />

      {/* ── WHERE TO GO NEXT ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel rounded-2xl p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">{t("newsletter.analytics.top")}</h2>
          {campaigns.rows.length === 0 ? (
            <p className="text-[13px] text-muted">{t("newsletter.campaigns.none")}</p>
          ) : (
            <ul className="space-y-1.5">
              {campaigns.rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/newsletter/kampanie/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors hover:bg-raised">
                    <span className="min-w-0 truncate font-medium">{c.name}</span>
                    <span className="shrink-0 text-[12px] text-muted">
                      {t(`newsletter.status.${c.status}`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel rounded-2xl p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">{t("newsletter.analytics.sources")}</h2>
          <ul className="space-y-1.5">
            {sources.map((s) => (
              <li key={s.key}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[13px]">
                <span className="min-w-0 truncate">{s.name}</span>
                <span className="shrink-0 tabular-nums text-muted">{nf.format(s.contacts)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
