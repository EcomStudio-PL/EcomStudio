"use client";
import { useCallback, useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck, Check, Clapperboard, Headphones, ImageIcon, ShieldCheck, Star, UserCog, Users, X, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Diamond } from "@/components/layout/credits-control";
import { cn } from "@/lib/utils";
import type { PlanCapabilities } from "@/lib/plans/capabilities";
import { annualBillingAvailable, annualSavingPct } from "@/lib/plans/pricing";
import { CreditCoinStack } from "./credit-coin-stack";
import {
  PRICING_PAGE, planPresentation, serviceLevel, type PlanTone,
} from "./pricing-config";
import {
  annualSavingCents, clampCredits, coinLevel, creditMultiple, creditsCheckoutHref, customQuote,
  customRange, formatCount, formatMoney, formatMultiple, formatPerCredit, initialBillingPeriod,
  isPaidPlan, nextStepHint, packCheckoutHref, packLadder, packQuote, planCheckoutHref,
  planMonthlyCents, planPerCreditCents, referenceRate, seatLabel, sliderMarks,
  type BillingPeriod,
} from "./pricing-model";

/**
 * CENNIK — three paid plans, the comparison, the credit packs and a custom
 * amount, in the order the questions arrive: which plan, how do they differ,
 * and what if I just need credits this once.
 *
 * EVERY NUMBER ON THIS PAGE IS A DATABASE ROW. Plan prices, credits and
 * capabilities are `subscription_plans`; the packs are `credit_packages`; the
 * custom amount is priced by `priceForCredits` — the function the checkout
 * charges with (components/plan/pricing-model.ts). Looks and words live in
 * components/plan/pricing-config.ts; money never does.
 *
 * CHECKOUT IS UNCHANGED. A buy button navigates to /checkout with an INTENT —
 * a plan id + period, a pack id, or a number of credits — byte-for-byte the
 * URLs this page has always sent; /checkout prices it on the server. Every
 * button is gated by `paymentsEnabled` (both Stripe secrets present) and by
 * whether the row is mapped to a Stripe price, so nothing here offers a sale
 * the till would refuse.
 *
 * THE FREE TIER IS NOT A CARD. It is the absence of a subscription, never for
 * sale; a customer on it reads one quiet line above the cards instead.
 */

export type PlanCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** The YEARLY total as stored. 0 means this plan has no annual price and
   *  annual billing is not on offer — see lib/plans/pricing.ts. */
  annualPriceCents: number;
  currency: string;
  monthlyCredits: number;
  bonusCredits: number;
  /** The capability bag as stored: {workspace_members, priority_queue, …}. */
  capabilities: PlanCapabilities;
  featured: boolean;
  /** Whether a Stripe Price exists for each period. A plan with no price
   *  cannot be sold, however enabled payments are — the checkout would refuse
   *  it at the till, so the button says so here instead. */
  monthlyMapped: boolean;
  annualMapped: boolean;
};

export type PackCard = {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  priceCents: number;
  currency: string;
  featured: boolean;
  badge: string | null;
  /** Whether this pack is mapped to a Stripe Price. */
  mapped: boolean;
};

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * ONE PLACE WHERE A BUY BUTTON BECOMES A NAVIGATION — to /checkout, in the
 * same app. The URL carries an intent, never a price; /checkout prices it
 * before it renders and bounces back to /plan?checkout=<reason> on a refusal.
 */
function useCheckout() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = useCallback((href: string) => {
    start(() => { router.push(href); });
  }, [router]);
  return { pending, go };
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const flag = (v: unknown): boolean => v === true;

/* ── tones: one accent family per plan, drawn from the theme tokens ───────*/

const TONE_TILE: Record<PlanTone, CSSProperties> = {
  // Cool and calm — a safe start.
  starter: { background: "rgb(var(--info) / 0.12)", color: "rgb(var(--info))", boxShadow: "inset 0 0 0 1px rgb(var(--info) / 0.22)" },
  pro: {
    backgroundImage: "linear-gradient(135deg, rgb(var(--accent-strong)), rgb(var(--accent)) 55%, rgb(var(--accent-glow)))",
    color: "#fff",
    boxShadow: "0 8px 20px -10px rgb(var(--accent) / 0.9)",
  },
  // Prestige: deep indigo with a gold mark — the price anchor.
  business: {
    backgroundImage: "linear-gradient(140deg, rgb(var(--indigo) / 0.95), rgb(var(--purple) / 0.75))",
    color: "rgb(var(--caution))",
    boxShadow: "0 8px 20px -12px rgb(var(--indigo) / 0.9), inset 0 0 0 1px rgb(255 255 255 / 0.12)",
  },
  neutral: { background: "rgb(var(--raised))", color: "rgb(var(--muted))" },
};

/** PRO: a magenta → violet gradient frame around an opaque card, soft glow. */
const PRO_CARD: CSSProperties = {
  border: "1.5px solid transparent",
  background: [
    "linear-gradient(168deg, rgb(var(--accent) / 0.13), rgb(var(--violet) / 0.05) 42%, transparent 70%) padding-box",
    "linear-gradient(rgb(var(--surface)), rgb(var(--surface))) padding-box",
    "linear-gradient(140deg, rgb(var(--accent-glow)), rgb(var(--accent)) 45%, rgb(var(--violet))) border-box",
  ].join(", "),
  boxShadow: "0 34px 80px -42px rgb(var(--accent) / 0.85), 0 14px 30px -24px rgb(var(--violet) / 0.6)",
};

/** BUSINESS: the standard panel with an indigo wash and edge. */
const BUSINESS_WASH: CSSProperties = {
  background: "linear-gradient(165deg, rgb(var(--indigo) / 0.11), rgb(var(--indigo) / 0.025) 45%, transparent 72%)",
  boxShadow: "inset 0 0 0 1px rgb(var(--indigo) / 0.28)",
};

/** A small chip: success text on a light success tint (AA in both themes). */
const SAVE_CHIP = "rounded-md bg-[rgb(var(--success)/0.1)] px-1.5 py-0.5 text-[11.5px] font-semibold text-success tabular-nums";

export function PricingBoard({ plans, packs, currentSlug, paymentsEnabled = false }: {
  plans: PlanCard[]; packs: PackCard[]; currentSlug: string;
  /** Whether this deployment can actually take a payment. Server-decided. */
  paymentsEnabled?: boolean;
}) {
  const { t } = useI18n();

  const paid = useMemo(() => plans.filter(isPaidPlan), [plans]);
  const free = useMemo(() => plans.find((p) => !isPaidPlan(p)) ?? null, [plans]);

  // ANNUAL BILLING IS DATA, NOT A COEFFICIENT. The control appears only when
  // every paid plan carries a real `annual_price_cents`; until then the page
  // quotes monthly prices and says nothing about a year. `period` defaults to
  // the config's preference ONLY when annual is really on offer, and `active`
  // — not `period` — drives every figure, so a stale state can never quote a
  // yearly price that does not exist.
  const annualAvailable = useMemo(() => annualBillingAvailable(plans), [plans]);
  const annualPct = useMemo(() => annualSavingPct(plans), [plans]);
  const [period, setPeriod] = useState<BillingPeriod>(
    () => initialBillingPeriod(PRICING_PAGE.defaultBillingPeriod, annualAvailable),
  );
  const active: BillingPeriod = annualAvailable ? period : "monthly";

  const onPaidPlan = paid.some((p) => p.slug === currentSlug);
  const reference = paid.find((p) => p.slug === PRICING_PAGE.benefitReferenceSlug);

  return (
    <div className="space-y-8 sm:space-y-10">
      <section data-pricing-plans>
        {(annualAvailable || (!onPaidPlan && free)) && (
          <div className="mb-7 flex flex-col items-center gap-3 sm:mb-9">
            {annualAvailable && (
              <BillingToggle period={active} onChange={setPeriod} annualPct={annualPct} t={t} />
            )}
            {/* The free tier, said once and quietly — not sold as a card. */}
            {!onPaidPlan && free && (
              <p data-current-free
                className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.2))] bg-[rgb(var(--surface)/0.7)] px-3.5 py-1.5 text-center text-[13px] text-muted">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--success))]" />
                {t("plans.currentFree", { name: free.name, n: formatCount(free.monthlyCredits + free.bonusCredits) })}
              </p>
            )}
          </div>
        )}

        {/* Three columns from lg. The rows are a SUBGRID, so name, price, CTA,
            features and the closing box line up across all three cards. Below
            lg the cards stack, featured first. */}
        <div className="mx-auto grid max-w-xl gap-5 lg:max-w-none lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_1fr_auto] lg:gap-x-5 lg:gap-y-0 lg:pt-4">
          {paid.map((p) => (
            <PlanColumn key={p.id} plan={p} period={active} isCurrent={p.slug === currentSlug}
              paymentsEnabled={paymentsEnabled} reference={p.featured ? reference : undefined} t={t} />
          ))}
        </div>
      </section>

      <ComparisonSection plans={paid} period={active} t={t} />

      {packs.length > 0 && (
        <TopUpSection packs={packs} paymentsEnabled={paymentsEnabled} t={t} />
      )}
    </div>
  );
}

/* ── billing period ───────────────────────────────────────────────────────*/

function BillingToggle({ period, onChange, annualPct, t }: {
  period: BillingPeriod; onChange: (p: BillingPeriod) => void; annualPct: number; t: T;
}) {
  return (
    <div role="group" aria-label={t("plans.billing")} data-billing-toggle
      className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.2))] bg-sunken/80 p-1">
      {(["monthly", "annual"] as const).map((v) => {
        const on = period === v;
        return (
          <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={on} data-billing={v}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition-all duration-200",
              on ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]" : "text-muted hover:text-ink",
            )}>
            {t(v === "annual" ? "plans.annual" : "plans.monthly")}
            {v === "annual" && annualPct > 0 && (
              // The SMALLEST real saving across the paid plans — one badge sits
              // above three columns and must not overstate any of them.
              <span className={SAVE_CHIP}>{t("plans.annualOff", { n: annualPct })}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── 1. PLAN CARDS ────────────────────────────────────────────────────────*/

function PlanColumn({ plan: p, period, isCurrent, paymentsEnabled, reference, t }: {
  plan: PlanCard; period: BillingPeriod; isCurrent: boolean; paymentsEnabled: boolean;
  /** The plan the featured card's "N× more credits" line compares against. */
  reference: PlanCard | undefined;
  t: T;
}) {
  const view = planPresentation(p.slug);
  const Icon = view.icon;
  const NoteIcon = view.noteIcon;
  const name = view.nameKey ? t(view.nameKey) : p.name;
  const annual = period === "annual";
  const monthly = planMonthlyCents(p, period);
  const perCredit = planPerCreditCents(p, period);
  const multiple = p.featured ? creditMultiple(p, reference) : null;
  const saving = annual && p.featured ? annualSavingCents(p) : null;
  const { pending, go } = useCheckout();
  // Payable = this deployment can charge AND this period has a Stripe price.
  const payable = paymentsEnabled && (annual ? p.annualMapped : p.monthlyMapped);
  const canBuy = payable && !isCurrent;
  const featured = p.featured;
  const tone = featured ? "pro" : view.tone;

  return (
    <article data-plan={p.slug} data-featured={featured || undefined}
      className={cn(
        "relative flex flex-col rounded-2xl p-5 sm:p-6 lg:row-span-5 lg:grid lg:grid-rows-subgrid",
        featured
          ? "order-first pt-7 transition-transform duration-300 sm:pt-8 lg:order-none lg:-translate-y-3 motion-safe:lg:hover:-translate-y-4"
          : "panel panel-interactive",
      )}
      style={featured ? PRO_CARD : undefined}>
      {tone === "business" && (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={BUSINESS_WASH} />
      )}
      {featured && (
        <span data-plan-badge
          className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-[rgb(var(--accent-strong))] px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_8px_18px_-8px_rgb(var(--accent)/0.9)] ring-[3px] ring-[rgb(var(--bg))]">
          <Star size={11} className="fill-current" aria-hidden />
          {t("plans.mostPopular")}
        </span>
      )}

      {/* 1 — name, mark, audience */}
      <header className="relative">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.14em] sm:text-base">{name}</h2>
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={TONE_TILE[tone]}>
            <Icon size={18} strokeWidth={2.2} />
          </span>
        </div>
        <p className="mt-1.5 text-[13.5px] leading-snug text-muted">{t(view.taglineKey)}</p>
      </header>

      {/* 2 — price */}
      <div className="relative mt-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* Keyed by period: switching billing re-mounts the figure, which
              fades in (and simply appears under reduced motion). */}
          <span key={`${p.id}-${period}`} data-plan-price
            className="metric animate-fade text-[2.5rem] leading-none sm:text-[2.75rem]">
            {formatMoney(monthly, p.currency)}
          </span>
          <span className="text-[14px] font-medium text-muted">{t("plans.perMonth")}</span>
          {annual && monthly < p.priceCents && (
            <s className="text-[15px] font-medium text-muted">{formatMoney(p.priceCents, p.currency)}</s>
          )}
        </div>
        {perCredit !== null && (
          <p className="mt-2 text-[13px] text-muted">
            {t("plans.perCreditApprox", { price: formatPerCredit(perCredit, p.currency) })}
          </p>
        )}
        {annual && p.annualPriceCents > 0 && (
          <p className="mt-0.5 text-[13px] text-muted">
            {t("plans.billedYearly", { price: formatMoney(p.annualPriceCents, p.currency) })}
          </p>
        )}
        {(multiple !== null || saving !== null) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {multiple !== null && reference && (
              <span data-plan-benefit
                className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--accent)/0.1)] px-2.5 py-1 text-[12px] font-semibold text-[rgb(var(--accent-strong))] ring-1 ring-[rgb(var(--accent)/0.22)] dark:text-accent">
                <Zap size={12} aria-hidden className="shrink-0" />
                {t("plans.moreCredits", {
                  n: formatMultiple(multiple),
                  plan: planPresentation(reference.slug).nameKey ? t(planPresentation(reference.slug).nameKey!) : reference.name,
                })}
              </span>
            )}
            {saving !== null && (
              <span className={cn(SAVE_CHIP, "rounded-full px-2.5 py-1")}>
                {t("plans.saveYearly", { price: formatMoney(saving, p.currency) })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 3 — CTA. PRO's is the page's only filled gradient button. */}
      <div className="relative mt-5">
        <button type="button"
          disabled={!canBuy || pending}
          onClick={() => go(planCheckoutHref(p.id, period))}
          data-plan-cta
          className={cn(
            "h-12 w-full rounded-xl text-[14.5px] font-semibold transition-all duration-200",
            isCurrent
              ? "bg-[rgb(var(--success)/0.12)] text-success ring-1 ring-[rgb(var(--success)/0.4)]"
              : featured
                ? "cta"
                : tone === "business"
                  ? "border border-[rgb(var(--indigo)/0.45)] bg-[rgb(var(--indigo)/0.08)] text-ink hover:border-[rgb(var(--indigo)/0.7)] hover:bg-[rgb(var(--indigo)/0.14)]"
                  : "border border-line-strong bg-surface/60 text-ink hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised",
            (!canBuy || pending) && !isCurrent && "cursor-not-allowed opacity-60",
          )}>
          {isCurrent
            ? t("plans.current")
            : pending ? t("packs.redirecting")
              : !payable ? t("packs.unavailable")
                : t("plans.choose")}
        </button>
      </div>

      {/* 4 — what is in it */}
      <ul className="relative mt-6 space-y-3">
        {planFeatures(p, t).map((r) => (
          <li key={r.key} data-feature={r.key} data-on={r.on || undefined}
            className="flex items-start gap-2.5 text-[13.5px] leading-snug">
            <span aria-hidden className={cn(
              "mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
              r.on
                ? featured ? "bg-[rgb(var(--accent)/0.14)] text-[rgb(var(--accent-strong))] dark:text-accent" : "bg-[rgb(var(--success)/0.12)] text-success"
                : "bg-[rgb(var(--ink)/0.06)] text-muted",
            )}>
              {r.on ? <Check size={11} strokeWidth={3.2} /> : <X size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className={cn("block", r.on ? "font-medium text-ink" : "text-muted")}>
                <span className="sr-only">{r.on ? "✓ " : "✕ "}</span>
                {r.label}
              </span>
              {r.detail && <span className="mt-0.5 block text-[12px] text-muted">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {/* 5 — who it is for */}
      <div className="relative mt-6">
        <div className={cn(
          "flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-[12.5px] leading-relaxed",
          featured
            ? "bg-[rgb(var(--accent)/0.08)] text-ink/85 ring-1 ring-[rgb(var(--accent)/0.18)]"
            : "bg-[rgb(var(--ink)/0.045)] text-muted",
        )}>
          <p>{t(view.noteKey)}</p>
          <span aria-hidden className="shrink-0" style={{ color: featured ? "rgb(var(--caution))" : tone === "business" ? "rgb(var(--caution))" : "rgb(var(--info))" }}>
            <NoteIcon size={17} strokeWidth={2.1} />
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * The capability list for one plan — read from the row (and the service
 * levels in pricing-config.ts), never assumed. Every card lists the same rows,
 * so ✓ and ✕ compare like with like.
 */
function planFeatures(p: PlanCard, t: T) {
  const seats = num(p.capabilities.workspace_members);
  const service = serviceLevel(p.slug);
  return [
    {
      key: "credits",
      label: t("plans.creditsPerMonth", { n: formatCount(p.monthlyCredits + p.bonusCredits) }),
      detail: p.bonusCredits > 0
        ? t("plans.detail.bonus", { n: formatCount(p.bonusCredits) })
        : t("plans.detail.renews"),
      on: p.monthlyCredits + p.bonusCredits > 0,
    },
    { key: "imageTools", label: t("plans.row.imageTools"), detail: t("plans.detail.imageTools"), on: true },
    {
      key: "seats",
      label: t("plans.row.seats"),
      detail: seats === null ? null : seatLabel(seats, t),
      on: seats !== null && (seats < 0 || seats > 1),
    },
    { key: "priority", label: t("plans.row.priority"), detail: null, on: flag(p.capabilities.priority_queue) },
    { key: "operator", label: t("plans.row.operator"), detail: null, on: flag(p.capabilities.operator_mode) },
    {
      key: "dedicatedSupport",
      label: t("plans.row.dedicatedSupport"),
      detail: null,
      on: service?.supportKey === "plans.support.dedicated",
    },
  ];
}

/* ── 2. COMPARISON ────────────────────────────────────────────────────────*/

type Cell = boolean | string;

function ComparisonSection({ plans, period, t }: { plans: PlanCard[]; period: BillingPeriod; t: T }) {
  const rows = useMemo<{ key: string; label: string; icon: LucideIcon | "diamond"; cell: (p: PlanCard) => Cell }[]>(() => [
    {
      key: "credits", label: t("plans.row.credits"), icon: "diamond",
      cell: (p) => formatCount(p.monthlyCredits + p.bonusCredits),
    },
    {
      key: "seats", label: t("plans.row.seats"), icon: Users,
      cell: (p) => {
        const s = num(p.capabilities.workspace_members);
        return s === null ? "—" : seatLabel(s, t);
      },
    },
    { key: "imageTools", label: t("plans.row.imageTools"), icon: ImageIcon, cell: () => true },
    // No video backend exists on any plan; the row says so rather than
    // showing ticks for something nobody can run.
    { key: "video", label: t("plans.row.video"), icon: Clapperboard, cell: () => t("features.badgeSoon") },
    { key: "priority", label: t("plans.row.priority"), icon: Zap, cell: (p) => flag(p.capabilities.priority_queue) },
    { key: "operator", label: t("plans.row.operator"), icon: UserCog, cell: (p) => flag(p.capabilities.operator_mode) },
    {
      key: "support", label: t("plans.row.support"), icon: Headphones,
      cell: (p) => {
        const s = serviceLevel(p.slug);
        return s ? t(s.supportKey) : "—";
      },
    },
    {
      key: "commercial", label: t("plans.row.commercial"), icon: BadgeCheck,
      cell: (p) => serviceLevel(p.slug)?.commercialUse ?? false,
    },
  ], [t]);

  if (plans.length === 0) return null;
  const last = rows.length - 1;

  return (
    <section data-pricing-compare className="panel rounded-2xl p-4 sm:p-6">
      <h2 className="font-display text-[20px] font-semibold tracking-tight sm:text-[22px]">{t("plans.compareTitle")}</h2>
      {/* The TABLE scrolls, never the page: on a phone the first column stays
          put while the plan columns slide under it (sticky only where the
          table can actually scroll, so the desktop panel's light is not
          painted over). `contain: paint` keeps the wide table out of the
          page's own overflow measurement. */}
      <div className="thin-scroll -mx-4 mt-4 overflow-x-auto px-4 [contain:paint] sm:mx-0 sm:px-0">
        <table className="w-full min-w-[580px] border-separate border-spacing-0 text-[13.5px]">
          <thead>
            <tr>
              <th scope="col"
                className="w-[30%] py-3 pr-3 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-[rgb(var(--surface))]">
                {t("plans.compareFeature")}
              </th>
              {plans.map((p) => {
                const view = planPresentation(p.slug);
                return (
                  <th key={p.id} scope="col" data-compare-plan={p.slug}
                    className={cn(
                      "px-3 py-3 text-center align-bottom",
                      p.featured && "rounded-t-xl border-x-[1.5px] border-t-[1.5px] border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.08)]",
                    )}>
                    <span className="block font-display text-[14px] font-bold uppercase tracking-[0.12em]">
                      {view.nameKey ? t(view.nameKey) : p.name}
                    </span>
                    <span key={`${p.id}-${period}`} className="animate-fade mt-0.5 block text-[12.5px] font-medium text-muted tabular-nums">
                      {formatMoney(planMonthlyCents(p, period), p.currency)} {t("plans.perMonth")}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-compare-row={r.key} className="group">
                <th scope="row"
                  className={cn(
                    "py-3 pr-3 text-left font-medium max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-[rgb(var(--surface))]",
                    "border-t border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.9))]",
                  )}>
                  <span className="flex items-center gap-2.5 text-ink/90">
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--ink)/0.05)] text-muted">
                      {r.icon === "diamond" ? <Diamond size={8} /> : <r.icon size={14} />}
                    </span>
                    {r.label}
                  </span>
                </th>
                {plans.map((p) => {
                  const v = r.cell(p);
                  return (
                    <td key={p.id}
                      className={cn(
                        "border-t border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.9))] px-3 py-3 text-center tabular-nums transition-colors group-hover:bg-[rgb(var(--ink)/0.025)]",
                        p.featured && "border-x-[1.5px] border-x-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.06)] group-hover:bg-[rgb(var(--accent)/0.09)]",
                        p.featured && i === last && "rounded-b-xl border-b-[1.5px] border-b-[rgb(var(--accent)/0.55)]",
                      )}>
                      {v === true
                        ? <span className="inline-flex items-center justify-center"><Check size={16} strokeWidth={3} aria-hidden className="text-success" /><span className="sr-only">✓</span></span>
                        : v === false
                          ? <span className="inline-flex items-center justify-center"><X size={15} strokeWidth={2.6} aria-hidden className="text-muted" /><span className="sr-only">✕</span></span>
                          : <span className={cn("font-medium", r.key === "video" ? "text-muted" : "text-ink")}>{v}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── 3. CREDIT PACKS + CUSTOM AMOUNT ──────────────────────────────────────*/

function TopUpSection({ packs, paymentsEnabled, t }: { packs: PackCard[]; paymentsEnabled: boolean; t: T }) {
  const { pending, go } = useCheckout();
  const ladder = useMemo(() => packLadder(packs), [packs]);
  const rate = useMemo(() => referenceRate(ladder), [ladder]);
  const currency = packs[0]?.currency ?? "PLN";

  // Largest first, the way a top-up list is read; the coin stack grows with
  // the pack's rank among them.
  const byTotal = useMemo(
    () => [...packs].sort((a, b) => (a.credits + a.bonusCredits) - (b.credits + b.bonusCredits)),
    [packs],
  );
  const ladderDesc = useMemo(() => [...byTotal].reverse(), [byTotal]);
  // BEST VALUE is a fact, not a pick: the pack with the lowest price per
  // credit (ties → the larger one).
  const bestId = useMemo(() => {
    let best: PackCard | null = null;
    for (const p of byTotal) {
      const per = p.priceCents / (p.credits + p.bonusCredits);
      if (!best || per <= best.priceCents / (best.credits + best.bonusCredits)) best = p;
    }
    return best?.id ?? null;
  }, [byTotal]);

  return (
    <section data-pricing-topup className="panel rounded-2xl p-4 sm:p-6">
      <header className="flex items-center gap-3.5">
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.1)] ring-1 ring-[rgb(var(--accent)/0.22)]">
          <CreditCoinStack level={3} size={34} />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[20px] font-semibold tracking-tight sm:text-[22px]">{t("packs.topUpTitle")}</h2>
          <p className="text-[13.5px] text-muted">{t("packs.topUpSub")}</p>
        </div>
      </header>

      <div className="mt-6 grid gap-5 [&>*]:min-w-0 lg:grid-cols-2 lg:gap-6">
        {/* LEFT — the fixed packs, largest first. */}
        <div>
          <ul className="space-y-3">
            {ladderDesc.map((p) => {
              const q = packQuote(p, rate);
              const best = p.id === bestId;
              const level = coinLevel(byTotal.indexOf(p), byTotal.length, PRICING_PAGE.coinStackMax);
              const disabled = !paymentsEnabled || !p.mapped || pending;
              return (
                // A grid, not a flex row: at 360px the coins, a two-line label,
                // the price and the button do not share one line — the button
                // drops to its own row on a phone and rejoins from `sm`.
                <li key={p.id} data-pack={p.id} data-best={best || undefined}
                  className={cn(
                    "relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-3 rounded-xl border p-3.5 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:p-4",
                    best
                      ? "border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.06)] shadow-[0_16px_36px_-26px_rgb(var(--accent)/0.9)]"
                      : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.1))] bg-[rgb(var(--surface)/0.6)] hover:border-[rgb(var(--accent)/0.3)]",
                  )}>
                  {best && (
                    <span data-best-badge
                      className="absolute -top-2.5 left-4 rounded-md bg-[rgb(var(--accent-strong))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_6px_14px_-6px_rgb(var(--accent)/0.9)]">
                      {t("packs.bestValue")}
                    </span>
                  )}
                  <CreditCoinStack level={level} size={44} />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-tight">
                      {formatCount(p.credits)}&nbsp;{t("packs.customCredits")}
                      {p.bonusCredits > 0 && (
                        <span className="ml-1 font-semibold text-success">+{formatCount(p.bonusCredits)}</span>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                      <span>{t("packs.perCreditApprox", { price: formatPerCredit(q.perCredit, p.currency) })}</span>
                      {q.offPct > 0 && <span className={SAVE_CHIP}>{t("packs.save", { n: q.offPct })}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    {q.referenceCents !== null && (
                      <s data-pack-reference className="block text-[12.5px] text-muted tabular-nums">
                        {formatMoney(q.referenceCents, p.currency)}
                      </s>
                    )}
                    <p data-pack-price className="metric text-[20px] leading-tight">{formatMoney(p.priceCents, p.currency)}</p>
                  </div>
                  <button type="button"
                    disabled={disabled}
                    onClick={() => go(packCheckoutHref(p.id))}
                    data-pack-buy
                    className={cn(
                      "col-span-3 h-10 shrink-0 rounded-xl px-4 text-[13.5px] font-semibold transition-all duration-200 sm:col-span-1",
                      best ? "cta" : "border border-line-strong bg-surface/60 text-ink hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised",
                      disabled && "cursor-not-allowed opacity-60",
                    )}>
                    {pending ? t("packs.redirecting")
                      : !paymentsEnabled || !p.mapped ? t("packs.unavailable")
                        : t("packs.buy")}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
            <ShieldCheck size={16} aria-hidden className="mt-px shrink-0 text-success" />
            {t("packs.noExpiry")}
          </p>
          {rate > 0 && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              {t("packs.referenceBasis", { price: formatPerCredit(rate, currency) })}
            </p>
          )}
        </div>

        {/* RIGHT — any amount, priced off the same ladder the checkout uses. */}
        <CustomAmount packs={packs} currency={currency} paymentsEnabled={paymentsEnabled} t={t} />
      </div>
    </section>
  );
}

/** Thumb diameter of the custom slider — the marks are placed against it. */
const THUMB = 22;

const RANGE_CLASS = cn(
  "relative h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none",
  "focus-visible:ring-4 focus-visible:ring-[rgb(var(--accent)/0.22)]",
  "[&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-[rgb(var(--accent))] [&::-webkit-slider-thumb]:bg-white",
  "[&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgb(0_0_0/0.28),0_0_0_4px_rgb(var(--accent)/0.16)] [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110",
  "[&::-moz-range-thumb]:h-[16px] [&::-moz-range-thumb]:w-[16px] [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full",
  "[&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-[rgb(var(--accent))] [&::-moz-range-thumb]:bg-white",
  "[&::-moz-range-thumb]:shadow-[0_2px_10px_rgb(0_0_0/0.28),0_0_0_4px_rgb(var(--accent)/0.16)]",
  "[&::-moz-range-track]:bg-transparent",
);

/**
 * Any number of credits within the rate card's range.
 *
 * THE SAME RATE CARD THE SERVER CHARGES AGAINST: `customQuote` calls
 * `priceForCredits`, which `validateCustomCredits` on the server uses for the
 * Stripe amount. The slider steps in the server's step; the number field
 * accepts any whole number in range — the server accepts exactly those too.
 */
function CustomAmount({ packs, currency, paymentsEnabled, t }: {
  packs: PackCard[]; currency: string; paymentsEnabled: boolean; t: T;
}) {
  const ladder = useMemo(() => packLadder(packs), [packs]);
  const range = useMemo(() => customRange(ladder), [ladder]);
  const marks = useMemo(() => sliderMarks(ladder), [ladder]);
  const min = range?.min ?? 0;
  const max = range?.max ?? 0;
  const step = range?.step ?? 50;

  const [credits, setCredits] = useState(() => {
    // Open on the featured pack when there is one — the amount most people take.
    const featured = packs.find((p) => p.featured);
    const start = featured ? featured.credits + featured.bonusCredits : Math.round((min + max) / 2);
    return range ? clampCredits(start, range, min) : start;
  });
  const [draft, setDraft] = useState<string | null>(null);

  const { pending, go } = useCheckout();
  const quote = useMemo(() => customQuote(credits, ladder), [credits, ladder]);
  const hint = useMemo(() => nextStepHint(credits, ladder), [credits, ladder]);

  if (!range || max <= min) return null;

  const fill = ((credits - min) / (max - min)) * 100;
  const commit = (raw: string) => {
    const next = clampCredits(Number(raw.replace(/\s/g, "")), range, credits);
    setCredits(next);
    setDraft(null);
  };

  return (
    <div data-pricing-custom
      className="flex flex-col rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.1))] bg-[rgb(var(--surface)/0.6)] p-4 sm:p-5">
      <h3 className="font-display text-[17px] font-semibold tracking-tight">{t("packs.customTitle")}</h3>
      <p className="mt-0.5 text-[13px] text-muted">{t("packs.customSub")}</p>

      <div className="mt-4 rounded-xl bg-[rgb(var(--accent)/0.07)] px-4 py-3.5 ring-1 ring-[rgb(var(--accent)/0.18)]">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span data-custom-credits className="metric text-[2.5rem] leading-none text-[rgb(var(--accent-strong))] dark:text-accent">
            {formatCount(credits)}
          </span>
          <span className="text-[14px] font-medium text-muted">{t("packs.customCredits")}</span>
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span>{t("packs.perCreditApprox", { price: formatPerCredit(quote.perCredit, currency) })}</span>
          {quote.offPct > 0 && <span className={SAVE_CHIP}>{t("packs.save", { n: quote.offPct })}</span>}
        </p>
      </div>

      {/* The slider: gradient fill up to the thumb, ticks at the rate card's
          real points (the packs), min and max at the ends. */}
      <div className="mt-6">
        <div className="relative">
          <input
            id="custom-credits" type="range" min={min} max={max} step={step} value={credits}
            onChange={(e) => { setCredits(Number(e.target.value)); setDraft(null); }}
            aria-label={t("packs.customTitle")}
            aria-valuetext={`${formatCount(credits)} ${t("packs.customCredits")} — ${formatMoney(quote.cents, currency)}`}
            data-custom-slider
            className={RANGE_CLASS}
            style={{
              background: `linear-gradient(90deg, rgb(var(--accent-strong)), rgb(var(--accent)) 60%, rgb(var(--accent-glow))) 0 0 / ${fill}% 100% no-repeat, rgb(var(--ink) / 0.12)`,
            }}
          />
          <div aria-hidden className="pointer-events-none relative mt-2 h-2">
            {marks.filter((m) => m.at > min && m.at < max).map((m) => (
              <span key={m.at} data-slider-mark={m.at}
                className={cn("absolute top-0 h-2 w-[2px] -translate-x-1/2 rounded-full",
                  credits >= m.at ? "bg-[rgb(var(--accent)/0.75)]" : "bg-[rgb(var(--ink)/0.22)]")}
                style={{ left: `calc(${m.pct}% + ${THUMB / 2 - (m.pct / 100) * THUMB}px)` }} />
            ))}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between text-[12px] text-muted tabular-nums">
          <span className="flex items-center gap-1.5"><Diamond size={7} />{formatCount(min)}</span>
          <span className="flex items-center gap-1.5">{formatCount(max)}<Diamond size={7} /></span>
        </div>
      </div>

      {/* Typing a number is the second way in — any whole number in range. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="custom-credits-input" className="text-[13px] font-medium text-muted">{t("packs.customInput")}</label>
        <input id="custom-credits-input" type="number" inputMode="numeric" min={min} max={max} step={1}
          value={draft ?? String(credits)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (Number.isInteger(n) && n >= min && n <= max) setCredits(n);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
          data-custom-input
          className="h-10 w-28 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.2))] bg-sunken/70 px-3 text-[14px] font-semibold tabular-nums text-ink outline-none transition focus:border-[rgb(var(--accent)/0.55)] focus:bg-surface focus:ring-4 focus:ring-[rgb(var(--accent)/0.14)]"
        />
        <span className="text-[12px] text-muted">{t("packs.customRange", { min: formatCount(min), max: formatCount(max) })}</span>
      </div>

      {/* The next real step up the rate card, computed — not a tier table. */}
      <div className="mt-3 min-h-[2.25rem]">
        {hint ? (
          <p data-next-step className="flex items-start gap-2 text-[13px] leading-snug text-ink/85">
            <Zap size={13} aria-hidden className="mt-[3px] shrink-0 text-[rgb(var(--accent-strong))] dark:text-accent" />
            <span className="min-w-0 flex-1">
              {t("packs.nextStep", { n: formatCount(hint.add), pct: t("packs.save", { n: hint.offPct }) })}
            </span>
            <button type="button" onClick={() => { setCredits(hint.at); setDraft(null); }}
              className="-my-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[12.5px] font-semibold text-[rgb(var(--accent-strong))] underline-offset-2 hover:underline dark:text-accent">
              {t("packs.nextStepAction")}
            </button>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Check size={13} aria-hidden className="shrink-0 text-success" />
            {t("packs.atBest")}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-[rgb(var(--ink)/0.05)] px-4 py-3.5">
        <span className="pb-1 text-[13.5px] font-medium text-muted">{t("packs.toPay")}</span>
        <span className="text-right">
          {quote.referenceCents !== null && (
            <s data-custom-reference className="block text-[13px] text-muted tabular-nums">
              {formatMoney(quote.referenceCents, currency)}
            </s>
          )}
          <span data-custom-price className="metric block text-[1.75rem] leading-none">
            {formatMoney(quote.cents, currency)}
          </span>
        </span>
      </div>

      <ul className="mt-4 space-y-2 text-[13px] text-muted">
        {[t("packs.instant"), t("packs.secure"), t("packs.invoice")].map((line) => (
          <li key={line} className="flex items-center gap-2">
            <Check size={14} aria-hidden strokeWidth={3} className="shrink-0 text-success" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-5">
        {/* A custom amount needs NO Stripe price — the line item is built
            server-side from the same rate card this panel reads — so the only
            question is whether this deployment can charge at all. */}
        <button type="button"
          disabled={!paymentsEnabled || pending}
          onClick={() => go(creditsCheckoutHref(credits))}
          data-custom-buy
          className={cn(
            "cta h-12 w-full rounded-xl text-[15px] font-semibold",
            (!paymentsEnabled || pending) && "cursor-not-allowed opacity-60",
          )}>
          {pending ? t("packs.redirecting")
            : !paymentsEnabled ? t("packs.unavailable")
              : t("packs.buyN", { n: formatCount(credits) })}
        </button>
        {!paymentsEnabled && (
          <p className="mt-2 text-center text-[12px] text-muted">{t("packs.soon")}</p>
        )}
      </div>
    </div>
  );
}
