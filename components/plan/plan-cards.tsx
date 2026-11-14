"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Check, Clock3, Crown, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Gate } from "@/components/home/gate";
import { Diamond } from "@/components/layout/credits-control";
import {
  annualSavingCents, approxPln, creditsWord, formatCount, formatMoney, formatPerCredit, isFewForm, planCheckoutHref,
  planCredits, planMonthlyCents, planPerCreditCents, seatLabel, type BillingPeriod,
} from "./pricing-model";
import { planPresentation, type FeatureKey, type PlanTone } from "./pricing-config";
import { defaultPlanCard, planCardConfig, resolveCard, type ResolvedGroup, type ResolvedLine } from "./card-features";
import type { PricingPageData, PricingPlanView } from "./pricing-types";

/**
 * THE THREE PLAN CARDS.
 *
 * Every figure on a card is a catalogue row (price, credits) or a division of
 * two real numbers (price per credit, images per month at a named model's real
 * price). The feature lines are the admin's document (card-features.ts, 0179;
 * the code default until one is saved), and every line bound to a feature
 * shows `featureOn` — the same truth table the comparison reads — so a card
 * cannot claim what the table denies. Anything that is planned but not
 * running carries "Wkrótce", never a ✓.
 *
 * PLANY V3 layout: on a phone one column (PRO first); from 768px two columns;
 * four in a row only where the cards get ≥ 280px each (the list's own width
 * ≥ 1180px, on a ≥ 1280px screen — /plan with its sidebar stays 2 × 2 longer).
 * Each wide card is a subgrid of five rows (header, credits, price, button,
 * features), so a row's prices and buttons share one line whatever wraps.
 */

type Theme = {
  card: string;
  style: CSSProperties;
  name: string;
  sub: string;
  badge: string;
  icon: string;
  iconStyle?: CSSProperties;
  box: string;
  cta: string;
  check: string;
  soon: string;
  group: string;
  highlight: string;
  divider: string;
};

/**
 * STARTER — calm, cool slate-blue on the page's own surface; neutral button.
 * PRO — the saturated GrovBase gradient, light text, a glow, the strongest
 *   button (white on magenta). The gradient's stops are fixed and dark enough
 *   that white text keeps ≥ 4.5:1 in both themes.
 * BUSINESS — deep navy/indigo with a violet edge and a small gold accent;
 *   premium, but a calmer button than PRO.
 */
const STARTER: Theme = {
  card: "border text-ink",
  style: {
    background: "linear-gradient(172deg, rgb(var(--info) / 0.10), rgb(var(--surface)) 46%) rgb(var(--surface))",
    borderColor: "rgb(var(--info) / 0.24)",
    boxShadow: "0 22px 50px -38px rgb(var(--info) / 0.55)",
  },
  name: "text-ink",
  sub: "text-muted",
  badge: "bg-[rgb(var(--info)/0.12)] text-[rgb(29_78_216)] ring-1 ring-[rgb(var(--info)/0.22)] dark:text-[rgb(var(--info))]",
  icon: "text-[rgb(var(--info))]",
  iconStyle: { background: "rgb(var(--info) / 0.12)", boxShadow: "inset 0 0 0 1px rgb(var(--info) / 0.22)" },
  box: "bg-[rgb(var(--info)/0.07)] ring-1 ring-[rgb(var(--info)/0.16)]",
  cta: "border border-line-strong bg-surface text-ink hover:bg-raised",
  check: "text-[rgb(var(--info))]",
  soon: "bg-raised text-muted ring-1 ring-line",
  group: "text-muted",
  highlight: "",
  divider: "border-line",
};

const THEMES: Record<PlanTone, Theme> = {
  starter: STARTER,
  // A slug the config does not know is drawn like Starter: calm and neutral.
  neutral: STARTER,
  pro: {
    card: "text-white",
    style: {
      backgroundImage: [
        "radial-gradient(120% 70% at 50% 0%, rgb(255 255 255 / 0.14), transparent 60%)",
        "linear-gradient(162deg, rgb(176 0 172) 0%, rgb(138 18 182) 48%, rgb(92 34 196) 100%)",
      ].join(", "),
      boxShadow: "0 40px 90px -38px rgb(176 0 172 / 0.85), 0 18px 40px -26px rgb(92 34 196 / 0.7), inset 0 0 0 1px rgb(255 255 255 / 0.16)",
    },
    name: "text-white",
    sub: "text-white/95",
    badge: "bg-white text-[rgb(140_0_140)] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.45)]",
    icon: "text-white",
    iconStyle: { background: "rgb(255 255 255 / 0.16)", boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.28)" },
    box: "bg-white/[0.12] ring-1 ring-white/20",
    cta: "bg-white text-[rgb(140_0_140)] shadow-[0_14px_30px_-14px_rgb(0_0_0/0.55)] hover:bg-white/95",
    check: "text-white",
    soon: "bg-white/15 text-white ring-1 ring-white/25",
    group: "text-white/90",
    highlight: "rounded-2xl bg-white/[0.1] p-4 ring-1 ring-white/15",
    divider: "border-white/15",
  },
  business: {
    card: "text-white",
    style: {
      background: "radial-gradient(90% 60% at 100% 0%, rgb(124 58 237 / 0.28), transparent 60%), linear-gradient(165deg, #231c52 0%, #16123a 52%, #0e0b26 100%)",
      border: "1px solid rgb(167 139 250 / 0.32)",
      boxShadow: "0 30px 70px -40px rgb(49 30 120 / 0.9)",
    },
    name: "text-white",
    sub: "text-[rgb(212_206_242)]",
    badge: "bg-[rgb(232_195_106/0.14)] text-[rgb(240_206_122)] ring-1 ring-[rgb(232_195_106/0.4)]",
    icon: "text-[rgb(240_206_122)]",
    iconStyle: { background: "rgb(232 195 106 / 0.12)", boxShadow: "inset 0 0 0 1px rgb(232 195 106 / 0.35)" },
    box: "bg-white/[0.06] ring-1 ring-white/10",
    cta: "bg-white/[0.1] text-white ring-1 ring-white/30 hover:bg-white/[0.16]",
    check: "text-[rgb(196_181_253)]",
    soon: "bg-white/10 text-white/85 ring-1 ring-white/15",
    group: "text-[rgb(190_182_228)]",
    highlight: "",
    divider: "border-white/10",
  },
};

const FEATURE_LABEL: Record<FeatureKey, string> = {
  creditsMonthly: "pricing.feat.creditsMonthly",
  creditPrice: "pricing.feat.creditPrice",
  noExpiry: "pricing.feat.noExpiry",
  topups: "pricing.feat.topups",
  allTools: "pricing.feat.allTools",
  customPrompts: "pricing.feat.customPrompts",
  video: "pricing.feat.video",
  quality: "pricing.feat.quality",
  library: "pricing.feat.library",
  seats: "pricing.feat.seats",
  priority: "pricing.feat.priority",
  operator: "pricing.feat.operator",
  supportEmail: "pricing.feat.supportEmail",
  supportDedicated: "pricing.feat.supportDedicated",
  commercial: "pricing.feat.commercial",
};
export const featureLabelKey = (key: FeatureKey) => FEATURE_LABEL[key];

/** The CTA a plan card offers this viewer, decided from server facts only. */
export type PlanCta =
  | { kind: "buy"; href: string; label: string }
  | { kind: "disabled"; label: string; hint?: "change" };

export function planCta(
  plan: PricingPlanView, period: BillingPeriod, data: PricingPageData,
  t: (k: string, v?: Record<string, string | number>) => string, name: string,
): PlanCta {
  if (data.viewer.currentSlug === plan.slug) return { kind: "disabled", label: t("pricing.plan.current") };
  // One live subscription per workspace — the checkout refuses a second, so
  // the button does not pretend otherwise.
  if (data.viewer.hasLiveSubscription) return { kind: "disabled", label: t("pricing.plan.hasPlan"), hint: "change" };
  if (!plan.payable[period]) return { kind: "disabled", label: t("pricing.plan.unavailable") };
  return { kind: "buy", href: planCheckoutHref(plan.id, period), label: t("pricing.plan.choose", { name }) };
}

export function PlanCards({ plans, period, data, order, layout, onChangeHint }: {
  plans: PricingPlanView[];
  period: BillingPeriod;
  data: PricingPageData;
  order: readonly string[];
  layout: "phone" | "wide";
  onChangeHint: () => void;
}) {
  const ranked = [...plans].sort((a, b) => rank(order, a.slug) - rank(order, b.slug));
  const cards = ranked.map((plan) => (
    <PlanCard key={plan.id} plan={plan} period={period} data={data} layout={layout} onChangeHint={onChangeHint} />
  ));
  if (layout === "phone") {
    return <div data-plan-cards="phone" className="mx-auto grid max-w-[440px] gap-5 md:hidden">{cards}</div>;
  }
  return (
    // The list measures itself (a size container): four columns need room for
    // four ≥ 280px cards, not merely a wide window.
    <div data-plan-cards="wide" className="hidden [container-type:inline-size] md:block">
      <div data-plan-grid
        className="mx-auto grid max-w-[1040px] grid-cols-2 gap-5 xl:[@container(min-width:1180px)]:max-w-none xl:[@container(min-width:1180px)]:grid-cols-4 xl:[@container(min-width:1290px)]:gap-6">
        {cards}
      </div>
    </div>
  );
}

const rank = (order: readonly string[], slug: string) => {
  const i = order.indexOf(slug);
  return i < 0 ? order.length : i;
};

function PlanCard({ plan, period, data, layout, onChangeHint }: {
  plan: PricingPlanView; period: BillingPeriod; data: PricingPageData; layout: "phone" | "wide";
  onChangeHint: () => void;
}) {
  const { t } = useI18n();
  const look = planPresentation(plan.slug);
  const theme = THEMES[look.tone];
  const Icon = look.icon;
  const name = look.nameKey ? t(look.nameKey) : plan.name;
  const isPro = look.tone === "pro";
  const credits = planCredits(plan);
  const monthly = planMonthlyCents(plan, period);
  const perCredit = planPerCreditCents(plan, period);
  const saving = period === "annual" ? annualSavingCents(plan) : null;
  const cta = planCta(plan, period, data, t, name);
  const groups = useCardGroups(plan, data);
  const cost = data.imageCost;
  // "≈ 171 zdjęć", but "≈ 42 zdjęcia" — the noun follows the number.
  const approx = (size: "2k" | "4k", n: number) =>
    t(`pricing.plan.approx${size}${isFewForm(n) ? "Few" : ""}`, { n: formatCount(n) });

  const ctaClass = cn(
    "flex h-12 w-full items-center justify-center rounded-xl px-4 text-[15px] font-semibold transition-[background-color,box-shadow,transform] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    isPro ? "focus-visible:ring-white focus-visible:ring-offset-[rgb(150_10_170)]"
      : look.tone === "business" ? "focus-visible:ring-[rgb(240_206_122)] focus-visible:ring-offset-[#16123a]"
      : "focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-[rgb(var(--surface))]",
    theme.cta,
  );

  return (
    <article data-plan-card={plan.slug} data-layout={layout} data-tone={look.tone}
      aria-labelledby={`plan-${layout}-${plan.slug}`}
      className={cn(
        "relative rounded-[28px] p-6 sm:p-7",
        // Wide: five rows shared with the other cards in the row (subgrid).
        layout === "wide" ? "row-span-5 grid grid-rows-subgrid gap-y-0" : "flex flex-col",
        // PRO stands out of a row of four; its content stays on the shared lines
        // (-16px margin + 44px padding = the others' 28px).
        isPro && layout === "wide" && "xl:[@container(min-width:1180px)]:-my-4 xl:[@container(min-width:1180px)]:py-11",
        theme.card,
      )}
      style={theme.style}>
      {/* A. HEADER — icon, badge, the name large and uppercase, the audience. */}
      <div data-plan-head>
        <div className="flex items-center justify-between gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", theme.icon)} style={theme.iconStyle}>
            <Icon size={19} aria-hidden />
          </span>
          <span data-plan-badge className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-right text-[10.5px] font-bold uppercase tracking-[0.12em]",
            theme.badge,
          )}>
            {isPro && <Crown size={11} aria-hidden className="shrink-0" />}
            {t(look.badgeKey)}
          </span>
        </div>
        <h3 id={`plan-${layout}-${plan.slug}`}
          className={cn("mt-5 font-display text-[1.625rem] font-bold uppercase leading-none tracking-[0.03em]", theme.name)}>
          {name}
        </h3>
        <p className={cn("mt-2 text-[14px] leading-snug", theme.sub)}>{t(look.taglineKey)}</p>
      </div>

      {/* B. CREDITS — what the month buys, then what that is in images. */}
      <div data-plan-credits className={cn("mt-5 rounded-2xl px-4 py-3.5", theme.box)}>
        <p className="flex flex-wrap items-baseline gap-x-1.5 font-display text-[1.1875rem] font-semibold leading-tight [overflow-wrap:normal]">
          <span className="self-center"><Diamond size={10} /></span>
          <span className="whitespace-nowrap tabular-nums">{formatCount(credits)}</span>
          <span className="whitespace-nowrap">{creditsWord(credits, t)}</span>
          <span className={cn("whitespace-nowrap text-[14px] font-medium", theme.sub)}>{t("pricing.plan.perMonth")}</span>
        </p>
        {cost ? (
          <ul className={cn("mt-1.5 space-y-0.5 text-[13.5px] leading-snug", theme.sub)}>
            {cost.k2 !== null && <li data-approx="2k">{approx("2k", Math.floor(credits / cost.k2))}</li>}
            {cost.k4 !== null && <li data-approx="4k">{approx("4k", Math.floor(credits / cost.k4))}</li>}
          </ul>
        ) : (
          <p className={cn("mt-1.5 text-[13px] leading-snug", theme.sub)}>{t("pricing.plan.costVisible")}</p>
        )}
      </div>

      {/* C. PRICE — the catalogue row, to the cent. An amount is never broken
          ("$109.9 / 0"): it does not wrap, it shrinks with a narrow card
          (cqi of this box — the size container is here, not on the card:
          containment on the card would switch its subgrid off), and only
          "/ mies." may drop below it. Text around amounts breaks at spaces
          only (the page's overflow-wrap:anywhere is off here). */}
      <div data-plan-pricebox className="mt-5 min-w-0 [container-type:inline-size]">
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 [overflow-wrap:normal]">
          <span data-plan-price
            className="whitespace-nowrap font-display text-[clamp(2rem,19cqi,2.75rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            {formatMoney(monthly, plan.currency)}
          </span>
          <span className={cn("whitespace-nowrap text-[15px] font-medium", theme.sub)}>{t("pricing.plan.perMonth")}</span>
        </p>
        {data.fx && plan.currency.toUpperCase() === "USD" && (
          <p data-plan-pln className={cn("mt-1 text-[12.5px] [overflow-wrap:normal]", theme.sub)}>
            {t("pricing.fx.approx", { amount: approxPln(period === "annual" && plan.annualPriceCents > 0 ? plan.annualPriceCents : monthly, data.fx.rate) ?? "" })}
            {period === "annual" && plan.annualPriceCents > 0 ? ` ${t("pricing.fx.perYear")}` : ""}
          </p>
        )}
        <p data-plan-billing className={cn("mt-2 min-h-[1.25rem] text-[13px] [overflow-wrap:normal]", theme.sub)}>
          {period === "annual" && plan.annualPriceCents > 0
            ? t("pricing.plan.billedYearly", { price: formatMoney(plan.annualPriceCents, plan.currency) })
              + (saving ? ` · ${t("pricing.plan.saveYearly", { price: formatMoney(saving, plan.currency) })}` : "")
            : perCredit !== null ? t("pricing.plan.perCredit", { price: formatPerCredit(perCredit, plan.currency) }) : ""}
        </p>
      </div>

      {/* D. CTA — full width. A visitor is asked to sign in first, with the
          order kept as the destination; the checkout re-prices after login. */}
      <div className="mt-5">
        {cta.kind === "buy" ? (
          <Gate href={cta.href} signedIn={data.viewer.signedIn} className={ctaClass}>
            {cta.label}
          </Gate>
        ) : (
          <button type="button" disabled aria-disabled className={cn(ctaClass, "cursor-not-allowed opacity-70")}>
            {cta.label}
          </button>
        )}
        {cta.kind === "disabled" && cta.hint === "change" && (
          <button type="button" onClick={onChangeHint}
            className={cn("mt-2 w-full text-center text-[13px] font-medium underline-offset-2 hover:underline", theme.sub)}>
            {t("pricing.plan.changeHint")}
          </button>
        )}
      </div>

      {/* E. WHAT IS IN IT — the admin's groups for this plan (or the code
          default). A group with nothing left to show leaves no trace. */}
      <div data-plan-features>
        {groups.map((group, i) => (
          <div key={group.id} data-card-group={group.id}
            className={cn(
              group.id === "highlights" ? cn("mt-6", theme.highlight)
                : i === 0 ? "mt-6" : cn("mt-5 border-t pt-4", theme.divider),
            )}>
            <p className={cn("text-[11px] font-bold uppercase tracking-[0.14em]", theme.group)}>{group.title}</p>
            <ul className="mt-2.5 space-y-2">
              {group.lines.map((line) => <FeatureLine key={line.id} line={line} theme={theme} />)}
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}

/** The groups this card shows. Any surprise in the document → the code default. */
function useCardGroups(plan: PricingPlanView, data: PricingPageData): ResolvedGroup[] {
  const { t, locale } = useI18n();
  const facts = {
    slug: plan.slug,
    caps: plan.capabilities,
    locale,
    t,
    values: {
      ...(typeof plan.capabilities.workspace_members === "number" ? { seats: seatLabel(plan.capabilities.workspace_members, t) } : {}),
      credits: formatCount(planCredits(plan)),
    },
    featureLabel: (f: FeatureKey) => t(FEATURE_LABEL[f]),
  };
  try {
    return resolveCard(planCardConfig(data.cards, plan.slug), facts);
  } catch {
    return resolveCard(defaultPlanCard(plan.slug), facts);
  }
}

function FeatureLine({ line, theme }: { line: ResolvedLine; theme: Theme }) {
  const { t } = useI18n();
  const { state } = line;
  return (
    <li data-line={line.id} data-feature={line.feature} data-state={state}
      className={cn("flex items-start gap-2.5 text-[14px] leading-snug", state === "no" && "opacity-75")}>
      {state === "yes"
        ? <Check size={16} strokeWidth={2.5} aria-hidden className={cn("mt-[1px] shrink-0", theme.check)} />
        : state === "soon"
          ? <Clock3 size={16} aria-hidden className={cn("mt-[1px] shrink-0 opacity-80", theme.check)} />
          : <X size={16} strokeWidth={2.5} aria-hidden className="mt-[1px] shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1">
        {line.text}
        {line.suffix && <span className="font-semibold"> · {line.suffix}</span>}
        {state === "no" && <span className="sr-only"> — {t("pricing.card.unavailable")}</span>}
      </span>
      {state === "soon" && (
        <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold", theme.soon)}>
          {t("pricing.soon")}
        </span>
      )}
    </li>
  );
}
