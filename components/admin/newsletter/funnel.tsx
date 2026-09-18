"use client";
import { useI18n } from "@/lib/i18n/provider";
import { formatRate, rate } from "@/lib/newsletter";
import { formatPrice } from "@/lib/utils";
import type { DashboardTotals } from "@/lib/services/newsletter";

/**
 * THE FUNNEL, WITH NO INVENTED STAGE.
 *
 * Seven bars and a sentence, each a real count, each measured against the
 * stage above it. The stage every other email tool puts here and this one does
 * not is "Delivered": this transport learns that a mail server answered 250 OK
 * and nothing after that — no bounce webhook, no delivery receipt, no
 * complaint feed. So the stage is called "Przyjęte" and the gap between that
 * and delivery is stated under the chart instead of being papered over.
 *
 * TWO NUMBERS PER ROW, MEANING TWO DIFFERENT THINGS. The bar's LENGTH is the
 * stage's share of the first one, which is what makes a funnel look like a
 * funnel and lets the eye find the cliff. The percentage PRINTED next to the
 * count is the share of the stage immediately above, which is the number an
 * operator can act on: "half the people who opened it clicked" is a fact about
 * the mail, while "half the recipients clicked" is a fact about the list.
 *
 * A stage whose parent is zero prints "—", never "0%". `rate()` returns null
 * for a zero denominator precisely so this stays impossible: a funnel that
 * shows 0% for a campaign that was never sent teaches an operator to ignore
 * the whole panel.
 */
export function Funnel({ totals }: { totals: DashboardTotals }) {
  const { t, locale } = useI18n();

  // `of: null` marks the first stage — it has nothing above it to be a
  // percentage of, which is a different statement from "0%".
  const rows: { key: string; value: number; of: number | null }[] = [
    { key: "recipients", value: totals.recipients, of: null },
    { key: "sent", value: totals.sent, of: totals.recipients },
    { key: "accepted", value: totals.accepted, of: totals.sent },
    { key: "opened", value: totals.openedUnique, of: totals.accepted },
    { key: "clicked", value: totals.clickedUnique, of: totals.openedUnique },
    { key: "replied", value: totals.replied, of: totals.accepted },
    /*
      CONVERSIONS ARE A STAGE ONLY WHEN SOMETHING COUNTS THEM.

      `converted` is attributions with `converted_at` set, and nothing sets it
      until there is a payments system — production has no payment rows at all.
      Drawn unconditionally, this stage printed a zero-length bar and "0,0% of
      those who clicked", which is the funnel's most damning-looking number and
      is not a measurement: every single person who clicked would have had to
      fail to buy for it to be one. The revenue row below already refuses to be
      a bar for exactly this reason; the stage above it now refuses too, and
      the sentence under the chart says why.
    */
    ...(totals.hasSalesData
      ? [{ key: "converted", value: totals.converted, of: totals.clickedUnique }]
      : []),
  ];

  const top = Math.max(1, rows[0].value);
  const nf = new Intl.NumberFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB");

  return (
    <section className="panel rounded-2xl p-4 sm:p-5" data-newsletter-funnel>
      <h2 className="mb-4 font-display text-sm font-semibold">{t("newsletter.funnel.title")}</h2>

      <ol className="space-y-2.5">
        {rows.map((row) => {
          const share = row.of === null ? null : rate(row.value, row.of);
          return (
            <li key={row.key} data-funnel-stage={row.key} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate font-medium">
                  {t(`newsletter.funnel.${row.key}`)}
                </span>
                {/* The pair never wraps onto the label: at 320px the label
                    truncates and the numbers stay whole, because a count cut
                    to "1 2…" is worse than a name cut to "Konwersj…". */}
                <span className="shrink-0 whitespace-nowrap tabular-nums text-muted">
                  {nf.format(row.value)}
                  {row.of !== null && (
                    <span className="ml-2 text-faint">{formatRate(share, locale)}</span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-[rgb(var(--accent))] transition-[width] duration-300"
                  style={{ width: `${Math.min(100, (row.value / top) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ol>

      {/* THE LAST STAGE IS A SENTENCE, NOT A BAR. There is nothing to measure
          until a payment exists, and a zero-length bar labelled "Sprzedaż"
          would read as a measured zero rather than as a missing system. */}
      <div className="mt-4 border-t border-line pt-3" data-funnel-stage="revenue">
        <p className="text-[12.5px] font-medium">{t("newsletter.funnel.revenue")}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
          {totals.hasSalesData && totals.revenueCents !== null
            ? formatPrice(totals.revenueCents, "PLN")
            : t("newsletter.noSalesData")}
        </p>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{t("newsletter.acceptedNote")}</p>
    </section>
  );
}
