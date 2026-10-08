"use client";
import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { initialBillingPeriod, type BillingPeriod } from "./pricing-model";
import { CARD_ORDER, CARD_ORDER_PHONE, PRICING_PAGE } from "./pricing-config";
import { CheckoutNotice } from "./checkout-notice";
import { PremiereBanner } from "./premiere-banner";
import { PlanCards } from "./plan-cards";
import { PlanComparison } from "./plan-comparison";
import { TopUps } from "./topups";
import { PricingFaq } from "./pricing-faq";
import type { PricingPageData } from "./pricing-types";

const A = PRICING_PAGE.anchors;

/**
 * CENNIK — the one pricing page, rendered at /plany (public) and /plan (in the
 * app) from the same server data. Order: premiere (only while it runs), the
 * heading with the period pill, the three plans, the comparison, the top-ups,
 * the FAQ. One spacing token between sections, one container width.
 */
export function PricingPage({ data, notice }: { data: PricingPageData; notice: string | null }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<BillingPeriod>(
    () => initialBillingPeriod(PRICING_PAGE.defaultBillingPeriod, data.annual.onSale),
  );
  const [faq, setFaq] = useState<string | null>(null);

  // Scroll to a section under the sticky top bar (its scroll-margin), then
  // move focus there so a keyboard user continues from where they landed.
  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, []);
  const toChange = useCallback(() => { setFaq("change"); go(A.faq); }, [go]);
  const toPlans = useCallback(() => go(A.plans), [go]);

  const plans = data.plans;
  const showAnnual = data.annual.onSale || PRICING_PAGE.annualWhenUnavailable === "disabled";
  const section = "scroll-mt-[calc(var(--header-h)+24px)] outline-none";

  return (
    <div data-pricing-page
      className="mx-auto flex w-full max-w-[1100px] flex-col gap-[var(--pricing-gap)] pb-6 [--pricing-gap:56px] sm:[--pricing-gap:72px] lg:[--pricing-gap:96px]">
      <div className="flex flex-col gap-8 sm:gap-10">
        {data.premiere && (
          <PremiereBanner endsAt={data.premiere.endsAt} endsAtMs={data.premiere.endsAtMs}
            serverNow={data.premiere.serverNow} endsAtLabel={data.premiere.endsAtLabel} />
        )}

        {/* The heading: what to do, in one sentence, and the period pill. */}
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h1 id="pricing-title" className="font-display text-[2rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[2.5rem]">
              {t("pricing.title")}
            </h1>
            <p className="mt-2.5 text-[15.5px] leading-relaxed text-muted">{t("pricing.sub")}</p>
          </div>
          <div data-period-pill
            className="grid w-full grid-cols-[1fr_1fr_auto] items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-[0_10px_30px_-24px_rgb(var(--accent)/0.6)] sm:inline-grid sm:w-auto">
            <button type="button" aria-pressed={period === "monthly"} onClick={() => setPeriod("monthly")}
              className={segment(period === "monthly")}>
              {t("pricing.period.monthly")}
            </button>
            {showAnnual ? (
              <button type="button" aria-pressed={period === "annual"}
                disabled={!data.annual.onSale}
                title={data.annual.onSale ? undefined : t("pricing.period.annualSoonHint")}
                onClick={() => data.annual.onSale && setPeriod("annual")}
                className={cn(segment(period === "annual"), "relative", !data.annual.onSale && "cursor-not-allowed text-faint hover:bg-transparent")}>
                {t("pricing.period.annual")}
                {data.annual.onSale && data.annual.savingPct > 0 && (
                  <span className="ml-1.5 rounded-full bg-[rgb(var(--success)/0.14)] px-1.5 py-0.5 text-[11px] font-bold text-[rgb(11_94_52)] dark:text-success">
                    {t("pricing.period.annualSave", { n: data.annual.savingPct })}
                  </span>
                )}
                {!data.annual.onSale && (
                  <span className="pointer-events-none absolute -top-2 right-0 rounded-full bg-raised px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted ring-1 ring-line">
                    {t("pricing.period.annualSoon")}
                  </span>
                )}
              </button>
            ) : <span />}
            <a href={`#${A.topups}`} onClick={(e) => { e.preventDefault(); go(A.topups); }} data-buy-credits
              className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-full border-l border-line px-2.5 text-[12px] font-semibold min-[360px]:px-3 min-[360px]:text-[13px] text-[rgb(var(--accent-strong))] transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] dark:text-[rgb(var(--accent-glow))] sm:px-4 sm:text-[14px]">
              <Plus size={14} strokeWidth={2.75} aria-hidden />
              {t("pricing.buyCredits")}
            </a>
          </div>
        </header>
        {notice && <CheckoutNotice status={notice} />}

        {/* THE PLANS. PRO first on a phone, in the middle on wide screens —
            two lists so the reading and focus order match what is drawn. */}
        <section id={A.plans} tabIndex={-1} aria-labelledby="pricing-title" className={cn(section, "pt-2 lg:pt-4")}>
          <PlanCards plans={plans} period={period} data={data} order={CARD_ORDER_PHONE} layout="phone" onChangeHint={toChange} />
          <PlanCards plans={plans} period={period} data={data} order={CARD_ORDER} layout="wide" onChangeHint={toChange} />
          <div className="mx-auto mt-8 max-w-2xl space-y-1.5 text-center text-[13px] leading-relaxed text-muted lg:mt-10">
            {data.imageCost && (
              <p data-cost-basis>{t("pricing.plan.approxBasis", {
                model: data.imageCost.model,
                k2: data.imageCost.k2 ?? "—",
                k4: data.imageCost.k4 ?? "—",
              })}</p>
            )}
            {data.free && <p data-free-note>{t("pricing.free", { name: data.free.name })}</p>}
            {!data.paymentsEnabled && <p>{t("plans.soon")}</p>}
          </div>
        </section>
      </div>

      <section id={A.compare} tabIndex={-1} aria-labelledby="compare-title" className={section}>
        <h2 id="compare-title" className="mb-6 text-center font-display text-[1.75rem] font-semibold tracking-[-0.02em] sm:text-[2rem]">
          {t("pricing.compare.title")}
        </h2>
        <PlanComparison plans={orderBy(plans, CARD_ORDER)} period={period} data={data} onChangeHint={toChange} />
      </section>

      <section id={A.topups} tabIndex={-1} aria-labelledby="topups-title" className={section}>
        <TopUps data={data} onChoosePlan={toPlans} />
      </section>

      <section id={A.faq} tabIndex={-1} className={cn(section, "mx-auto w-full max-w-[700px]")}>
        <PricingFaq premiere={Boolean(data.premiere)} open={faq} onOpen={setFaq} />
      </section>
    </div>
  );
}

const segment = (active: boolean) => cn(
  "flex h-10 items-center justify-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold transition-colors min-[360px]:px-3 min-[360px]:text-[13px] sm:px-4 sm:text-[14px]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]",
  active ? "bg-ink text-bg shadow-sm" : "text-muted hover:bg-raised hover:text-ink",
);

function orderBy<T extends { slug: string }>(items: T[], order: readonly string[]): T[] {
  const at = (s: string) => { const i = order.indexOf(s); return i < 0 ? order.length : i; };
  return [...items].sort((a, b) => at(a.slug) - at(b.slug));
}
