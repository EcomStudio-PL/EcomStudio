import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney, formatWarsawDate } from "@/lib/grovnews-billing";
import type { AccessView } from "@/lib/services/grovnews";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Where the full subscription card (cancel / resume / Stripe portal) lives. */
export const MANAGE_HREF = "/settings?tab=subscriptions#grovnews";

/**
 * GROVNEWS PREMIUM ● AKTYWNY — the small card at the top of /grovnews for a
 * reader with access. Server component; it only SHOWS the state
 * grovnews_my_state() returned (lib/services/grovnews.ts `grovnewsAccessView`).
 * Nothing here buys, cancels or grants anything: a paying subscriber is sent
 * to the one place that manages the subscription, a bonus/promo reader sees
 * until when access runs, and an admin without an entitlement sees that they
 * read as an admin.
 */
export function GrovNewsAccessCard({ view, locale, t }: { view: AccessView; locale: string; t: T }) {
  const date = (iso: string) => formatWarsawDate(iso, locale);
  const line = view.kind === "PAID"
    ? view.pastDue ? t("grovnews.billing.pastDue")
      : view.renewsOn ? t("grovnews.status.renews", { date: date(view.renewsOn) })
      : view.endsOn ? t("grovnews.status.ends", { date: date(view.endsOn) })
      : null
    : view.kind === "ADMIN" ? t("grovnews.status.adminNote")
    : view.forever ? t("grovnews.status.forever")
    : view.until ? t("grovnews.status.until", { date: date(view.until) })
    : null;
  return (
    <section aria-label={t("grovnews.status.title")} data-grovnews-access={view.kind}
      className="panel mb-5 flex min-w-0 flex-col gap-3 rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">{t("grovnews.status.title")}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--success)/0.14)] px-2 py-0.5 text-[11.5px] font-semibold text-success">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{t("grovnews.status.active")}
          </span>
          {[view.kind, ...view.also].map((k) => (
            <span key={k} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] font-semibold text-muted">
              {t(`grovnews.status.kind.${k}`)}
            </span>
          ))}
        </p>
        {(line || (view.kind === "PAID" && view.priceCents !== null)) && (
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-muted">
            {view.kind === "PAID" && view.priceCents !== null && (
              <span className="tabular-nums text-ink" data-grovnews-access-price>
                {t("grovnews.billing.perMonth", { price: formatMoney(view.priceCents, view.currency, locale) })}
              </span>
            )}
            {view.kind === "PAID" && view.priceCents !== null && line && <span aria-hidden>·</span>}
            {line && <span className="min-w-0">{line}</span>}
          </p>
        )}
      </div>
      {view.kind === "PAID" && (
        <Link href={MANAGE_HREF} data-grovnews-manage
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-raised">
          {t("grovnews.status.manage")}<ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </section>
  );
}
