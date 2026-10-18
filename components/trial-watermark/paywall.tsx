"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, Loader2, Lock, Settings } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { trialPlanSelectedAction } from "@/app/actions/trial-watermark";
import type { TrialPaywallPlan } from "@/lib/trial-watermark/types";
import { planPresentation, type FeatureKey } from "@/components/plan/pricing-config";
import { featureLabelKey } from "@/components/plan/plan-cards";
import { formatCount, formatMoney, isFewForm } from "@/components/plan/pricing-model";
import { availableLine, highlightedPlanIds, orderPlans, safeHref, underADay } from "./model";

/**
 * THE PAYWALL — "Odblokuj zdjęcie bez znaku wodnego".
 *
 * The customer's own watermarked picture, the two sentences of the brief, and
 * the plans as /plany sells them: names through planPresentation (Agency reads
 * "Business"), prices and credits from the catalogue rows the server handed
 * over. Nothing here is a price, a feature list or a discount of its own.
 *
 * Three ways the plan buttons give way to something else:
 *   · a purchase is being confirmed (`pending`) — buying again could bill
 *     twice, so the buttons become a waiting line and "Sprawdź ponownie";
 *   · a subscription exists but is not active (`hasLiveSubscription`) — a
 *     second plan would be refused by the checkout; the way back is the
 *     subscription settings;
 *   · a plan the checkout cannot sell right now — its button opens /plan.
 */
export function TrialPaywall({ preview, paywallId, assetId, daysLeft, expiresAt, plans, hasLiveSubscription, pending, onCheckAgain }: {
  /** The watermarked picture this paywall is about. */
  preview: string | null;
  /** From trialPaywallAction; null when the paywall was not minted (then plans link to /plan). */
  paywallId: string | null;
  assetId: string;
  daysLeft: number | null;
  /** The item's exact expiry, when the card carried one — sharper than `daysLeft`. */
  expiresAt: string | null;
  plans: TrialPaywallPlan[];
  hasLiveSubscription: boolean;
  pending: boolean;
  /** "Sprawdź ponownie" while a purchase is pending. */
  onCheckAgain: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [choosing, setChoosing] = useState<string | null>(null);
  const ordered = orderPlans(plans);
  const highlighted = highlightedPlanIds(plans);
  const lastDay = underADay(expiresAt, daysLeft);
  const buttons = !pending && !hasLiveSubscription;

  async function choose(plan: TrialPaywallPlan) {
    if (choosing) return;
    // A plan checkout cannot sell right now, or a paywall the server never
    // minted: the cennik is the honest next step, not a dead button.
    if (!paywallId || !plan.payable || !safeHref(plan.checkoutHref)) { router.push("/plan#plany"); return; }
    setChoosing(plan.id);
    try {
      const res = await trialPlanSelectedAction({ paywallId, assetId, planId: plan.id });
      const href = res.ok ? safeHref(res.href) : null;
      if (href) { router.push(href); return; }
      // The plan is no longer sold (deactivated since the paywall opened):
      // the cennik shows what is.
      if (!res.ok && res.error === "invalid") { router.push("/plan#plany"); return; }
      toast.error(t("genv3.wm.err.generic"));
    } catch {
      toast.error(t("genv3.wm.err.generic"));
    }
    setChoosing(null);
  }

  return (
    <div data-trial-paywall className="space-y-4">
      <div className="flex flex-col gap-4 pr-8 sm:flex-row sm:items-center sm:gap-5">
        {preview && (
          <div className="flex shrink-0 justify-center overflow-hidden rounded-2xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))] sm:w-44">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" data-trial-paywall-preview
              className="max-h-[26dvh] w-auto max-w-full object-contain sm:max-h-48" />
          </div>
        )}
        <div className="min-w-0">
          <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-white"
            style={{ backgroundImage: "linear-gradient(140deg, rgb(176 0 172), rgb(112 24 170))" }}>
            <Lock size={16} aria-hidden />
          </span>
          <h2 className="font-display text-[1.125rem] font-semibold leading-snug sm:text-[1.25rem]">{t("genv3.wm.paywallTitle")}</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{t("genv3.wm.paywallBody")}</p>
          <p className={cn("mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold", lastDay ? "text-warning" : "text-faint")}
            data-trial-days>
            <Clock size={12} aria-hidden />
            {availableLine(t, daysLeft)}
          </p>
          {lastDay && (
            <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-snug text-warning" data-trial-last-day>
              <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
              {t("genv3.wm.lastDay")}
            </p>
          )}
        </div>
      </div>

      {ordered.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {ordered.map((plan) => {
            const look = planPresentation(plan.slug);
            const Icon = look.icon;
            const lit = highlighted.has(plan.id);
            const name = plan.nameKey ? t(plan.nameKey) : look.nameKey ? t(look.nameKey) : plan.name;
            const credits = plan.monthlyCredits;
            return (
              // On a phone the highlighted plan leads, as on /plany's phone order.
              <div key={plan.id} data-trial-plan={plan.slug} data-highlighted={lit || undefined}
                className={cn("flex min-w-0 flex-col rounded-2xl p-3.5", lit && "order-first sm:order-none",
                  lit ? "border-2 border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.07)]"
                    : "border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.6))] bg-[rgb(var(--surface)/0.6)]")}>
                <span className="flex items-center gap-1.5">
                  <Icon size={14} aria-hidden className={lit ? "text-accent" : "text-muted"} />
                  <span className="truncate text-[13px] font-bold">{name}</span>
                  {lit && (
                    <span className="ml-auto shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white">
                      {t(look.badgeKey)}
                    </span>
                  )}
                </span>
                <span className="metric mt-2 text-[1.375rem] leading-none text-ink">
                  {formatMoney(plan.priceCents, plan.currency)}
                  <span className="ml-1 text-[12px] font-medium text-muted">{t("genv3.wm.perMonth")}</span>
                </span>
                <span className="mt-1 text-[12px] text-muted">
                  {t(isFewForm(credits) ? "genv3.wm.creditsMonthlyFew" : "genv3.wm.creditsMonthly", { n: formatCount(credits) })}
                </span>
                {/* What the plan includes today, in /plany's own words (its card highlights). */}
                {plan.capabilities.length > 0 && (
                  <ul className="mt-2 space-y-1" data-trial-plan-features>
                    {plan.capabilities.map((k) => {
                      const label = featureLabelKey(k as FeatureKey);
                      return label ? (
                        <li key={k} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted">
                          <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-accent" />
                          {t(label)}
                        </li>
                      ) : null;
                    })}
                  </ul>
                )}
                <span aria-hidden className="flex-1" />
                {buttons && (
                  <button type="button" onClick={() => void choose(plan)} disabled={!!choosing} data-trial-choose={plan.slug}
                    aria-label={`${t("genv3.wm.choosePlan")} — ${name}`}
                    className={cn("mt-3 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition-colors",
                      lit ? "cta [--accent:var(--accent-strong)]" : "border border-line-strong text-ink hover:bg-raised",
                      choosing && choosing !== plan.id && "opacity-50")}>
                    {choosing === plan.id && <Loader2 size={13} className="animate-spin" aria-hidden />}
                    {t("genv3.wm.choosePlan")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending ? (
        <div data-trial-pending className="rounded-xl border border-line bg-sunken/50 p-3.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
            {t("genv3.wm.pendingTitle")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.pendingBody")}</p>
          <button type="button" onClick={onCheckAgain} data-trial-check-again
            className="plate mt-3 inline-flex h-10 items-center justify-center rounded-xl px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-raised">
            {t("genv3.wm.checkAgain")}
          </button>
        </div>
      ) : hasLiveSubscription ? (
        <div data-trial-inactive className="rounded-xl border border-line bg-sunken/50 p-3.5">
          <p className="text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.inactiveBody")}</p>
          <Link href="/settings?tab=subscriptions" data-trial-manage
            className="cta mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold [--accent:var(--accent-strong)] sm:w-auto sm:px-5">
            <Settings size={14} aria-hidden />
            {t("genv3.wm.manage")}
          </Link>
        </div>
      ) : ordered.length === 0 && (
        <Link href="/plan#plany" data-trial-see-plans
          className="cta inline-flex h-10 w-full items-center justify-center rounded-xl text-[13px] font-semibold [--accent:var(--accent-strong)]">
          {t("genv3.wm.seePlans")}
        </Link>
      )}
    </div>
  );
}
