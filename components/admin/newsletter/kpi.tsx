import {
  BarChart3, CheckCheck, MailX, MousePointerClick, Reply, Send, Sparkles,
  TriangleAlert, UserPlus, Users, Wallet,
} from "lucide-react";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPrice } from "@/lib/utils";
import { formatRate, rate, type CampaignStatus } from "@/lib/newsletter";
import type { DashboardTotals } from "@/lib/services/newsletter";

/**
 * THE ELEVEN NUMBERS, WRITTEN ONCE.
 *
 * Pulpit and Analityka show the same headline metrics over the same range, and
 * the fastest way to end up with two dashboards that quietly disagree is to
 * lay the tiles out twice. Everything about how a newsletter number is allowed
 * to be presented lives in this file: which ones are facts, which one is a
 * guess and says so, and which one refuses to be a number at all.
 *
 * It is a SERVER component and reads its own dictionary. The alternative was
 * passing `t` down from each page, which works but makes the rule optional —
 * and a rule that each caller has to remember to apply is the rule that gets
 * skipped on screen nine.
 */

/** Digit grouping in the language the operator is reading. Not a shared util
 *  because the money case already has one (`formatPrice`) and a second general
 *  number formatter in lib/utils would immediately be used for money too. */
export const numberFormat = (locale: string) =>
  new Intl.NumberFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB");

/**
 * A campaign's status in the badge vocabulary, so Pulpit and Analityka never
 * colour the same word differently. `sending` is INFO rather than success: it
 * is not finished, and a green "Wysyłanie" invites an operator to close the
 * tab on a send that still has half a queue left to get wrong.
 */
export const campaignStatusTone = (status: CampaignStatus):
  "neutral" | "success" | "warning" | "danger" | "info" | "accent" => {
  switch (status) {
    case "sent": return "success";
    case "sending": return "info";
    case "scheduled": return "accent";
    case "paused": return "warning";
    case "failed": return "danger";
    default: return "neutral";
  }
};

/**
 * THE KPI GRID.
 *
 * Two across on a phone, six on a wide monitor. The count matters: this app's
 * admin content area runs to 2100px, and a KPI row that stops at four columns
 * leaves a 1920 screen with a third of its width empty and the funnel pushed
 * below the fold for no reason.
 *
 * The ORDER is an argument about trust. Contacts and sends are counted facts.
 * Open rate is a guess — Apple Mail Privacy Protection opens messages on the
 * recipient's behalf, so it is inflated for everyone by an unknown amount —
 * and it sits next to click rate, replies and conversions rather than above
 * them, because those three are the ones worth acting on.
 */
export async function KpiRow({ totals }: { totals: DashboardTotals }) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const nf = numberFormat(locale);

  const openRate = rate(totals.openedUnique, totals.accepted);
  const clickRate = rate(totals.clickedUnique, totals.accepted);
  const replyRate = rate(totals.replied, totals.accepted);
  const unsubRate = rate(totals.unsubscribed, totals.accepted);

  return (
    <div data-newsletter-kpi>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        <Stat label={t("newsletter.kpi.contacts")} value={nf.format(totals.contacts)}
          icon={Users} tone="accent" />
        <Stat label={t("newsletter.kpi.newContacts")} value={nf.format(totals.newContacts)}
          icon={UserPlus} tone="violet" />
        <Stat label={t("newsletter.kpi.sent")} value={nf.format(totals.sent)}
          icon={Send} tone="indigo" />
        {/* "Przyjęte", never "Dostarczone". The hint is not decoration: it is
            the whole reason this tile is allowed to exist. */}
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
        {/* THE ONE TILE THAT IS NOT ALLOWED TO PRINT A ZERO.
            A conversion is an attribution row with `converted_at` set, and
            nothing sets it until a payments system exists — production has no
            payment rows at all. So this counter can only ever be 0, and "0"
            under "Konwersje" is read as "the newsletter sold nothing", which is
            a business conclusion drawn from a measurement nobody took. The
            same branch the revenue panel and the Analityka table already use:
            `hasSalesData` asks whether anything is counting, not whether the
            number is small. */}
        <Stat label={t("newsletter.kpi.conversions")}
          value={totals.hasSalesData ? nf.format(totals.converted) : "—"}
          hint={totals.hasSalesData ? undefined : t("newsletter.noSalesData")}
          icon={Sparkles} tone="violet" />
        <Stat label={t("newsletter.kpi.unsubscribes")} value={nf.format(totals.unsubscribed)}
          hint={formatRate(unsubRate, locale)} icon={MailX} />
        <Stat label={t("newsletter.kpi.failed")} value={nf.format(totals.failed)}
          icon={TriangleAlert} />
      </div>

      {/* Said once per screen, under the tiles it qualifies. Repeating it on
          every rate turns the caveat into wallpaper. */}
      <p className="mt-3 text-[12px] leading-relaxed text-faint" data-open-rate-note>
        {t("newsletter.openRateNote")}
      </p>
    </div>
  );
}

/**
 * "THERE IS NOTHING TO COUNT YET", SAID THE SAME WAY EVERYWHERE.
 *
 * Production has no payment rows at all. A "0 zł" or a "0%" conversion would
 * not be a small number, it would be a fabricated one, and an operator reads
 * it as "the newsletter earns nothing" rather than "billing is not connected
 * yet" — the first is a business conclusion drawn from a measurement nobody
 * took. Both wordings come from the same two keys so that the answer cannot
 * drift between the two screens that ask the question.
 *
 * `note` exists because a screen can legitimately raise the subject twice —
 * once for conversion, once for revenue — and two full-height empty states
 * stacked on one page stop reading as information and start reading as a
 * broken page.
 */
export async function NoSalesData({ variant = "panel" }: { variant?: "panel" | "note" }) {
  const { dict } = await getDictionary();
  const t = makeT(dict);

  if (variant === "note") {
    return (
      <div data-no-sales-data className="plate rounded-xl px-3.5 py-3">
        <p className="text-[13px] font-semibold">{t("newsletter.noSalesData")}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          {t("newsletter.noSalesDataHint")}
        </p>
      </div>
    );
  }

  return (
    <EmptyState icon={Wallet}
      title={t("newsletter.noSalesData")}
      body={t("newsletter.noSalesDataHint")} />
  );
}

/**
 * THE ONE TILE THAT REFUSES TO BE A ZERO.
 *
 * Branches on `hasSalesData` — which asks whether a payments system exists at
 * all — rather than on the amount. `revenueCents` is checked too, because the
 * service layer keeps it null when no attribution ever carried an amount, and
 * null is not the same claim as zero.
 */
export async function RevenuePanel({ totals, variant = "panel" }: {
  totals: DashboardTotals;
  variant?: "panel" | "note";
}) {
  const { dict } = await getDictionary();
  const t = makeT(dict);

  if (!totals.hasSalesData || totals.revenueCents === null) {
    return <NoSalesData variant={variant} />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label={t("newsletter.kpi.revenue")}
        value={formatPrice(totals.revenueCents, "PLN")}
        icon={Wallet} tone="success" />
    </div>
  );
}
