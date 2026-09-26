"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/lib/notify";
import { setGrovNewsRenewalAction } from "@/app/actions/grovnews-billing";
import { BillingPortalButton } from "@/components/plan/billing-portal-button";
import { formatMoney, formatWarsawDate, type GrovNewsState } from "@/lib/grovnews-billing";

/**
 * GROVNEWS IN THE CUSTOMER'S SETTINGS — status, price, next billing, cancel at
 * the end of the period (or resume), the existing Billing Portal, and the
 * launch bonus with the personal discount code.
 *
 * Everything shown comes from grovnews_my_state(), which answers for the
 * signed-in user only. Cancelling acts on the SESSION's own subscription —
 * there is no id in this component to change. Nothing here grants anything:
 * access follows the signed webhook.
 */
export function GrovNewsBillingCard({ state, onSale }: { state: GrovNewsState; onSale: boolean }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [cancelAtEnd, setCancelAtEnd] = useState(state.paid?.cancelAtPeriodEnd ?? false);
  const paid = state.paid?.live ? state.paid : null;
  const date = (iso: string | null) => (iso ? formatWarsawDate(iso, locale) : "—");

  const renewal = (cancel: boolean) => start(async () => {
    let res;
    try {
      res = await setGrovNewsRenewalAction(cancel);
    } catch {
      notify.error(t("common.error"));
      return;
    }
    if (!res.ok) { notify.error(t("common.error")); return; }
    setCancelAtEnd(res.cancelAtPeriodEnd);
    setConfirming(false);
    notify.success(t(res.cancelAtPeriodEnd ? "grovnews.billing.cancelled" : "grovnews.billing.resumed"));
  });

  const sourceLabel = (source: string) =>
    source === "LAUNCH_BONUS" ? t("grovnews.billing.sourceLaunch")
      : source === "PROMO" ? t("grovnews.billing.sourcePromo") : t("grovnews.billing.sourceAdmin");

  return (
    <div className="space-y-4 text-[13px]" data-grovnews-billing>
      <div className="flex flex-wrap items-center gap-2">
        <span className={state.access
          ? "rounded-full bg-[rgb(var(--success)/0.14)] px-2.5 py-1 text-[12px] font-semibold text-success"
          : "rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-muted"}>
          {state.access ? t("grovnews.billing.accessOn") : t("grovnews.billing.accessOff")}
        </span>
        {paid && <span className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted">{t("grovnews.billing.sourcePaid")}</span>}
        {state.sources.map((s) => (
          <span key={s} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted">{sourceLabel(s)}</span>
        ))}
      </div>

      {paid && (
        <div className="rounded-xl bg-[rgb(var(--ink)/0.05)] px-3.5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold text-ink">GrovNews Premium</span>
            {paid.priceCents !== null && (
              <span className="tabular-nums text-ink">{t("grovnews.billing.perMonth", { price: formatMoney(paid.priceCents, paid.currency, locale) })}</span>
            )}
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {paid.status === "past_due" ? t("grovnews.billing.pastDue")
              : cancelAtEnd ? t("grovnews.billing.endsOn", { date: date(paid.paidThrough ?? paid.currentPeriodEnd) })
              : t("grovnews.billing.nextBilling", { date: date(paid.currentPeriodEnd) })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {cancelAtEnd ? (
              <button type="button" disabled={pending} onClick={() => renewal(false)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-70">
                {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}{t("grovnews.billing.resume")}
              </button>
            ) : confirming ? (
              <>
                <button type="button" disabled={pending} onClick={() => renewal(true)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--danger)/0.12)] px-4 text-[13.5px] font-semibold text-danger disabled:opacity-70">
                  {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}{t("grovnews.billing.cancelConfirm")}
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirming(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-[13px] font-semibold text-muted hover:text-ink">
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-line px-4 text-[13.5px] font-semibold text-muted transition-colors hover:text-ink">
                {t("grovnews.billing.cancel")}
              </button>
            )}
            <BillingPortalButton />
          </div>
          {confirming && <p className="mt-2 text-[12px] text-faint">{t("grovnews.billing.cancelHint", { date: date(paid.currentPeriodEnd) })}</p>}
        </div>
      )}

      {!paid && onSale && state.offer.available && state.offer.priceCents !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[rgb(var(--ink)/0.05)] px-3.5 py-3">
          <span className="text-ink">{t("grovnews.premiumPrice", { price: formatMoney(state.offer.priceCents, state.offer.currency, locale) })}</span>
          <Link href="/checkout?kind=grovnews" className="cta inline-flex h-10 items-center justify-center rounded-xl px-4 text-[13.5px] font-semibold">
            {t("grovnews.activate")}
          </Link>
        </div>
      )}

      {state.launch && (state.launch.accessGranted || state.launch.code || state.launch.codeRedeemed) && (
        <LaunchBlock state={state} />
      )}
    </div>
  );
}

function LaunchBlock({ state }: { state: GrovNewsState }) {
  const { t, locale } = useI18n();
  const launch = state.launch;
  if (!launch) return null;
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notify.success(t("grovnews.billing.copied"));
    } catch {
      notify.error(t("common.error"));
    }
  };
  const discount = launch.discountType && launch.discountValue !== null
    ? launch.discountType === "PERCENT" ? `−${launch.discountValue}%` : `−${formatMoney(launch.discountValue, "PLN", locale)}`
    : null;
  return (
    <div className="rounded-xl border border-line px-3.5 py-3">
      <p className="font-semibold text-ink">{t("grovnews.billing.launchTitle")}</p>
      <ul className="mt-2 space-y-1.5 text-[12.5px] text-muted">
        <li className="flex items-start gap-2"><Check size={14} aria-hidden className="mt-0.5 shrink-0 text-success" />{t("grovnews.billing.launchCredits")}</li>
        {launch.accessGranted && (
          <li className="flex items-start gap-2"><Check size={14} aria-hidden className="mt-0.5 shrink-0 text-success" />
            {launch.forever || !launch.accessUntil
              ? t("grovnews.billing.launchForever")
              : t("grovnews.billing.launchUntil", { date: formatWarsawDate(launch.accessUntil, locale) })}
          </li>
        )}
        {launch.code && (
          <li className="flex min-w-0 flex-wrap items-center gap-2">
            <Check size={14} aria-hidden className="shrink-0 text-success" />
            <span>{t("grovnews.billing.launchCode")}</span>
            <span className="break-all font-mono font-semibold text-ink">{launch.code}</span>
            <button type="button" onClick={() => copy(launch.code ?? "")} aria-label={t("grovnews.billing.copy")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink">
              <Copy size={14} aria-hidden />
            </button>
          </li>
        )}
        {launch.code && discount && (
          <li className="pl-6 text-[12px] text-faint">
            {t(launch.discountDuration === "REPEATING" ? "grovnews.billing.codeTermsMonths" : "grovnews.billing.codeTermsOnce", {
              discount, plans: launch.plans.join(", "), n: launch.discountMonths ?? 1,
              date: launch.codeExpiresAt ? formatWarsawDate(launch.codeExpiresAt, locale) : "—",
            })}
          </li>
        )}
        {launch.codeRedeemed && <li className="pl-6 text-[12px] text-faint">{t("grovnews.billing.codeUsed")}</li>}
      </ul>
    </div>
  );
}
