"use client";
import { useI18n } from "@/lib/i18n/provider";
import { formatRate, rate } from "@/lib/newsletter";
import type { DashboardTotals } from "@/lib/services/newsletter";

/**
 * THE FUNNEL, WITH NO INVENTED STAGE.
 *
 * Eight rows, each a real count, each measured against the stage above it.
 * The one an email tool usually puts here and this one does not is
 * "Delivered": this transport reports that a server ACCEPTED a message and
 * nothing more — no bounce webhook, no delivery receipt — so the stage is
 * called "przyjęte" and the difference is stated rather than glossed.
 *
 * A stage whose parent is zero shows "—", not "0%". A funnel that prints 0%
 * for a campaign that was never sent teaches an operator to ignore it.
 */
export function Funnel({ totals }: { totals: DashboardTotals }) {
  const { t, locale } = useI18n();

  const rows: { key: string; value: number; of: number }[] = [
    { key: "recipients", value: totals.sent + totals.failed, of: 0 },
    { key: "sent", value: totals.sent, of: totals.sent + totals.failed },
    { key: "accepted", value: totals.accepted, of: totals.sent },
    { key: "opened", value: totals.openedUnique, of: totals.accepted },
    { key: "clicked", value: totals.clickedUnique, of: totals.openedUnique },
    { key: "replied", value: totals.replied, of: totals.accepted },
    { key: "converted", value: totals.converted, of: totals.clickedUnique },
  ];

  const top = Math.max(1, rows[0].value);
  const nf = new Intl.NumberFormat(locale === "pl" ? "pl-PL" : locale);

  return (
    <section className="panel rounded-2xl p-4" data-newsletter-funnel>
      <h2 className="mb-3 font-display text-sm font-semibold">{t("newsletter.funnel.title")}</h2>
      <ol className="space-y-2">
        {rows.map((row, i) => {
          const share = rate(row.value, row.of);
          return (
            <li key={row.key} data-funnel-stage={row.key} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate font-medium">
                  {t(`newsletter.funnel.${row.key}`)}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {nf.format(row.value)}
                  {i > 0 && <span className="ml-2 text-faint">{formatRate(share, locale)}</span>}
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

      {/* THE LAST STAGE IS A SENTENCE, NOT A BAR. There is nothing to
          measure until a payment exists, and a zero-length bar labelled
          "Sprzedaż" would read as a measured zero. */}
      <div className="mt-3 border-t border-line pt-3" data-funnel-stage="revenue">
        <p className="text-[12.5px] font-medium">{t("newsletter.funnel.revenue")}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
          {totals.hasSalesData && totals.revenueCents !== null
            ? new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" })
              .format(totals.revenueCents / 100)
            : t("newsletter.noSalesData")}
        </p>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{t("newsletter.acceptedNote")}</p>
    </section>
  );
}
