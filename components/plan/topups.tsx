"use client";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { Check, Lock, ShieldCheck, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { CreditCoinStack } from "./credit-coin-stack";
import { approxPln, buyCreditsLabel, creditsCheckoutHref, creditsWord, formatCount, formatMoney, formatPerCredit } from "./pricing-model";
import { topupCents, topupMarginalCents } from "@/lib/plans/topup-price";
import { PRICING_PAGE } from "./pricing-config";
import type { PricingPackView, PricingPageData, PricingTierView } from "./pricing-types";

/**
 * DOŁADUJ KREDYTY — one slider (Cennik V2: 20–5000 credits, step 1).
 *
 * The preview is `topupCents` — the SAME pure function the server charges
 * with (lib/plans/topup-price.ts), so the figure here, the server's quote and
 * the Stripe amount are one computation. The server recomputes it, stores it
 * as an order before any payment, and never reads a price from the browser.
 *
 * THE LOCK IS THE SERVER'S. `viewer.topups` is decided by requireActivePaidPlan
 * on the server, and the checkout refuses on its own without an active paid
 * plan; this overlay only explains the refusal before it happens.
 */
export function TopUps({ data, onChoosePlan, recommendedSlot = null }: {
  data: PricingPageData;
  onChoosePlan: () => void;
  /** A tool panel's top-up dialog (Public Tools V1): the smallest buyable pack
   *  that covers what the image is missing, marked as the one to pick. The
   *  cennik passes nothing and looks exactly as before. */
  recommendedSlot?: number | null;
}) {
  const { t } = useI18n();
  const locked = data.viewer.topups !== "allowed";

  return (
    <div>
      <header className="mx-auto max-w-2xl text-center">
        <h2 id="topups-title" className="font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2rem]">
          {t("pricing.topups.title")}
        </h2>
        <p className="mt-2 text-[15px] text-muted">{t("pricing.topups.sub")}</p>
      </header>

      <div className="relative mt-8" data-topups-locked={locked ? data.viewer.topups : undefined}>
        <div inert={locked}
          className={cn(
            data.packs.length > 0 ? "grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:items-start" : "mx-auto max-w-xl",
            locked && "pointer-events-none select-none opacity-50 blur-[1.5px] saturate-[0.6] motion-safe:transition-[filter,opacity]",
          )}>
          {/* Cennik V2: no packs are on offer — the slider is the top-up. */}
          {data.packs.length > 0 && (
            <PackList packs={data.packs} currency={data.currency} recommendedSlot={recommendedSlot} className="order-2 lg:order-1" />
          )}
          <CustomAmount spec={data.topup} fx={data.fx} payments={data.paymentsEnabled}
            initial={recommendedSlot} className="order-1 lg:order-2" />
        </div>
        {locked && <LockOverlay reason={data.viewer.topups} onChoosePlan={onChoosePlan} />}
      </div>

      <p className="mt-5 text-center text-[13px] text-muted">
        {data.paymentsEnabled ? t("pricing.topups.noExpiry") : t("pricing.topups.paymentsOff")}
      </p>
      {data.packs.some((p) => p.savePct !== null) && (
        <p className="mt-1 text-center text-[12px] text-muted">{t("pricing.topups.saveBasis")}</p>
      )}
    </div>
  );
}

/* ── the five packs ────────────────────────────────────────────────────────*/

function PackList({ packs, currency, recommendedSlot = null, className }: {
  packs: PricingPackView[]; currency: string; recommendedSlot?: number | null; className?: string;
}) {
  const { t } = useI18n();
  return (
    <ul className={cn("grid gap-3", className)} data-pack-list>
      {packs.map((p) => {
        const credits = p.slot + p.bonusCredits;
        return (
          <li key={p.slot} data-pack-slot={p.slot} data-best={p.best ? "1" : undefined}
            data-recommended={recommendedSlot === p.slot ? "1" : undefined}
            aria-current={recommendedSlot === p.slot ? "true" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3 sm:gap-4 sm:px-4",
              p.best ? "border-transparent" : "border-line",
              recommendedSlot === p.slot && "ring-2 ring-[rgb(var(--accent))] ring-offset-2 ring-offset-[rgb(var(--surface))]",
            )}
            style={p.best ? BEST_EDGE : undefined}>
            {p.best && (
              <span className="absolute -top-2.5 left-4 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white"
                style={{ backgroundImage: "linear-gradient(120deg, rgb(176 0 172), rgb(112 24 170))" }}>
                {t("pricing.topups.best")}
              </span>
            )}
            <CreditCoinStack level={Math.min(p.level, PRICING_PAGE.coinStackMax)} size={44} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-1.5 font-display text-[1.0625rem] font-semibold leading-tight">
                <span className="tabular-nums">{formatCount(p.slot)}</span>
                <span className="text-[14px] font-medium text-muted">{creditsWord(p.slot, t)}</span>
                {p.bonusCredits > 0 && (
                  <span className="rounded-md bg-[rgb(var(--success)/0.1)] px-1.5 py-0.5 font-body text-[11.5px] font-semibold text-[rgb(11_94_52)] dark:text-success">
                    {t("pricing.topups.bonus", { n: formatCount(p.bonusCredits) })}
                  </span>
                )}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                {p.perCreditCents !== null
                  ? <span className="tabular-nums">{t("pricing.topups.perCredit", { price: formatPerCredit(p.perCreditCents, currency) })}</span>
                  : <span>{t("pricing.topups.soonPrice")}</span>}
                {p.savePct !== null && (
                  <span className="rounded-md bg-[rgb(var(--accent)/0.1)] px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--accent-strong))] dark:text-[rgb(var(--accent-glow))]">
                    {t("pricing.topups.save", { n: p.savePct })}
                  </span>
                )}
              </p>
              {credits !== p.slot && (
                <p className="sr-only">{t("pricing.topups.total", { n: formatCount(credits) })}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span data-pack-price className="font-display text-[1.125rem] font-semibold tabular-nums">
                {p.amountCents !== null ? formatMoney(p.amountCents, currency) : "—"}
              </span>
              {p.href ? (
                <Link href={p.href} data-pack-buy
                  className="inline-flex h-9 items-center rounded-lg px-4 text-[13.5px] font-semibold cta [--accent:var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--surface))]">
                  {t("pricing.topups.buy")}
                </Link>
              ) : (
                <span className="inline-flex h-9 items-center rounded-lg bg-raised px-3 text-[12.5px] font-semibold text-muted">
                  {t("pricing.soon")}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const BEST_EDGE: CSSProperties = {
  background: [
    "linear-gradient(rgb(var(--surface)), rgb(var(--surface))) padding-box",
    "linear-gradient(120deg, rgb(var(--accent-glow)), rgb(var(--accent)) 45%, rgb(var(--violet))) border-box",
  ].join(", "),
  boxShadow: "0 18px 40px -30px rgb(var(--accent) / 0.8)",
};

/* ── the custom amount ─────────────────────────────────────────────────────*/

function CustomAmount({ spec, fx, payments, initial, className }: {
  spec: PricingPageData["topup"]; fx: PricingPageData["fx"]; payments: boolean;
  /** A tool's top-up dialog may open on the amount the image is missing. */
  initial?: number | null; className?: string;
}) {
  const { t } = useI18n();
  const clamp = (n: number) => Math.min(spec.max, Math.max(spec.min, Math.round(n / spec.step) * spec.step));
  const [credits, setCredits] = useState(() => clamp(initial ?? 100));
  const [typed, setTyped] = useState<string | null>(null);
  const amountCents = topupCents(credits);
  const perCreditCents = amountCents / credits;
  const pln = approxPln(amountCents, fx?.rate);
  // The range is on a square-root scale so 20–250 (where the bands change)
  // gets most of its width; every value it lands on is a whole credit.
  const toPos = (c: number) => Math.round(Math.sqrt((c - spec.min) / (spec.max - spec.min)) * 1000);
  const fromPos = (p: number) => clamp(spec.min + ((p / 1000) ** 2) * (spec.max - spec.min));
  const pos = toPos(credits);
  const pct = pos / 10;
  const valueText = useMemo(() => `${formatCount(credits)} ${creditsWord(credits, t)}, ${formatMoney(amountCents, spec.currency)}`,
    [credits, amountCents, t, spec.currency]);
  const href = payments && spec.buyable ? creditsCheckoutHref(credits) : null;

  return (
    <div data-custom-amount className={cn("rounded-[24px] border border-line bg-surface p-5 sm:p-6", className)}
      style={{ boxShadow: "0 30px 70px -50px rgb(var(--accent) / 0.55)" }}>
      <h3 className="font-display text-[1.125rem] font-semibold">{t("pricing.topups.customTitle")}</h3>
      <p className="mt-1 text-[13.5px] text-muted">{t("pricing.topups.customSub")}</p>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="flex items-baseline gap-2">
          <label htmlFor="topup-credits" className="sr-only">{t("pricing.topups.sliderLabel")}</label>
          <input id="topup-credits" data-custom-credits inputMode="numeric" type="number"
            min={spec.min} max={spec.max} step={spec.step}
            value={typed ?? String(credits)}
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= spec.min && n <= spec.max) setCredits(clamp(n));
            }}
            onBlur={() => { setTyped(null); }}
            className="w-[6.5ch] bg-transparent font-display text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums outline-none [appearance:textfield] focus-visible:underline [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
          <span className="text-[15px] font-medium text-muted">{creditsWord(credits, t)}</span>
        </p>
        <p id="topup-tier-unit" className="pb-1 text-[13px] text-muted">
          {t("pricing.topups.perCredit", { price: formatPerCredit(perCreditCents, spec.currency) })}
          <span className="sr-only"> · {t("pricing.topups.marginal", { price: formatPerCredit(topupMarginalCents(credits), spec.currency) })}</span>
        </p>
      </div>

      <div className="mt-5">
        <label htmlFor="topup-tier" className="sr-only">{t("pricing.topups.sliderLabel")}</label>
        <input id="topup-tier" type="range" min={0} max={1000} step={1} value={pos}
          onChange={(e) => { setTyped(null); setCredits(fromPos(Number(e.target.value))); }}
          aria-valuetext={valueText}
          aria-describedby="topup-tier-unit"
          data-tier-slider
          className={RANGE_CLASS}
          style={{
            background: `linear-gradient(90deg, rgb(var(--accent-strong)) 0%, rgb(var(--accent)) ${pct * 0.6}%, rgb(var(--violet)) ${pct}%, rgb(var(--line-strong)) ${pct}%, rgb(var(--line-strong)) 100%)`,
          }} />
        <div aria-hidden className="mt-1.5 flex justify-between text-[12px] font-medium text-muted tabular-nums">
          <span>{formatCount(spec.min)}</span>
          <span>{formatCount(spec.max)}</span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-raised/70 px-4 py-3.5 ring-1 ring-line">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{t("pricing.topups.toPay")}</p>
            {pln && (
              <p data-custom-pln className="mt-1 text-[12px] text-muted">
                {t("pricing.fx.approx", { amount: pln })}
              </p>
            )}
          </div>
          <p data-custom-price className="font-display text-[2rem] font-semibold leading-none tracking-[-0.02em] tabular-nums">
            {formatMoney(amountCents, spec.currency)}
          </p>
        </div>
      </div>

      {href ? (
        <Link href={href} data-custom-buy
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl px-4 text-[15px] font-semibold cta [--accent:var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--surface))]">
          {buyCreditsLabel(credits, t)}
        </Link>
      ) : (
        <button type="button" disabled data-custom-buy
          className="mt-4 flex h-12 w-full cursor-not-allowed items-center justify-center rounded-xl bg-raised px-4 text-[14px] font-semibold text-muted">
          {t("packs.unavailable")}
        </button>
      )}
      {fx && <p className="mt-2 text-center text-[11.5px] text-faint">{t("pricing.fx.note", { date: fx.date })}</p>}

      <ul className="mt-4 grid gap-1.5 text-[13px] text-muted sm:grid-cols-3 sm:gap-2">
        <li className="flex items-center gap-1.5"><Zap size={14} aria-hidden className="shrink-0 text-accent" />{t("pricing.topups.check.instant")}</li>
        <li className="flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden className="shrink-0 text-accent" />{t("pricing.topups.check.secure")}</li>
        <li className="flex items-center gap-1.5"><Check size={14} aria-hidden className="shrink-0 text-accent" />{t("pricing.topups.check.noExpiry")}</li>
      </ul>
    </div>
  );
}

const RANGE_CLASS = cn(
  "relative h-2.5 w-full cursor-pointer appearance-none rounded-full outline-none",
  "focus-visible:ring-4 focus-visible:ring-[rgb(var(--accent)/0.25)]",
  "[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-[rgb(var(--accent))] [&::-webkit-slider-thumb]:bg-white",
  "[&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgb(0_0_0/0.28),0_0_0_5px_rgb(var(--accent)/0.18)]",
  "[&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full",
  "[&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-[rgb(var(--accent))] [&::-moz-range-thumb]:bg-white",
  "[&::-moz-range-thumb]:shadow-[0_2px_10px_rgb(0_0_0/0.28),0_0_0_5px_rgb(var(--accent)/0.18)]",
  "[&::-moz-range-track]:bg-transparent",
);

/* ── the lock ──────────────────────────────────────────────────────────────*/

function LockOverlay({ reason, onChoosePlan }: { reason: PricingPageData["viewer"]["topups"]; onChoosePlan: () => void }) {
  const { t } = useI18n();
  const failed = reason === "check_failed";
  // A subscription exists but is not active right now (past_due, a lapsed
  // period): choosing a plan would be a second subscription, which the
  // checkout refuses — the way back is the subscription settings.
  const inactive = reason === "plan_inactive";
  return (
    <div data-topups-lock className="absolute inset-0 z-10 flex items-start justify-center p-4 pt-16 sm:items-center sm:pt-4">
      <div role="note" className="w-full max-w-sm rounded-3xl border border-line bg-surface/95 p-6 text-center shadow-[0_30px_80px_-30px_rgb(0_0_0/0.45)] backdrop-blur">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-white"
          style={{ backgroundImage: "linear-gradient(140deg, rgb(176 0 172), rgb(112 24 170))" }}>
          <Lock size={20} aria-hidden />
        </span>
        <p className="mt-4 font-display text-[1.125rem] font-semibold leading-snug">
          {t(failed ? "pricing.topups.locked.checkFailed" : inactive ? "pricing.topups.locked.inactiveTitle" : "pricing.topups.locked.title")}
        </p>
        {!failed && (
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            {t(inactive ? "pricing.topups.locked.inactiveSub" : "pricing.topups.locked.sub")}
          </p>
        )}
        {inactive ? (
          <Link href="/settings?tab=subscriptions" data-topups-manage className={LOCK_CTA}>
            {t("pricing.topups.locked.inactiveCta")}
          </Link>
        ) : !failed && (
          <button type="button" onClick={onChoosePlan} data-topups-choose className={LOCK_CTA}>
            {t("pricing.topups.locked.cta")}
          </button>
        )}
      </div>
    </div>
  );
}

const LOCK_CTA = "mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-[15px] font-semibold cta [--accent:var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--surface))]";
