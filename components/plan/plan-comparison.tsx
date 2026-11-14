"use client";
import { Fragment, useId, useState, type ReactNode } from "react";
import { Check, ChevronDown, Clock3, Minus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Gate } from "@/components/home/gate";
import {
  formatCount, formatMoney, formatPerCredit, planCredits, planMonthlyCents, planPerCreditCents,
  seatLabel, type BillingPeriod,
} from "./pricing-model";
import {
  COMPARE_GROUPS, COMPARE_INITIAL_ROWS, featureOn, planPresentation, type FeatureKey,
} from "./pricing-config";
import { featureLabelKey, planCta } from "./plan-cards";
import type { PricingPageData, PricingPlanView } from "./pricing-types";

/**
 * THE COMPARISON — the same truth table as the cards, laid out side by side.
 *
 * A real <table>: a screen reader announces "PRO, Kredyty co miesiąc, 1 200".
 * Folded to the first rows behind a fade; the rest are `hidden`, not clipped,
 * so a keyboard never tabs into a row nobody can see. From 768px the table
 * scrolls inside its own box if it must (first column pinned) and the page
 * never scrolls sideways; on wide screens its plan header row sticks under the
 * top bar.
 *
 * Below 768px (Plany V3) the same cells compare TWO plans side by side —
 * Starter and PRO to begin with, each column with its own plan picker — so
 * nothing is squeezed and nothing scrolls sideways (PhoneComparison).
 */
export function PlanComparison({ plans, period, data, onChangeHint }: {
  plans: PricingPlanView[];
  period: BillingPeriod;
  data: PricingPageData;
  onChangeHint: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const phoneId = useId();
  const total = COMPARE_GROUPS.reduce((n, g) => n + g.rows.length, 0);
  let seen = 0;

  const cell = (plan: PricingPlanView, key: FeatureKey) => {
    if (key === "creditsMonthly") {
      return <span className="font-semibold tabular-nums">{formatCount(planCredits(plan))}</span>;
    }
    if (key === "creditPrice") {
      const unit = planPerCreditCents(plan, period);
      return unit === null ? <Mark state="no" /> : <span className="tabular-nums">{formatPerCredit(unit, plan.currency)}</span>;
    }
    const state = featureOn(key, plan.slug, plan.capabilities);
    if (key === "seats" && state !== "no" && typeof plan.capabilities.workspace_members === "number") {
      return (
        <span className="inline-flex flex-col items-center gap-1">
          <span className="font-medium">{seatLabel(plan.capabilities.workspace_members, t)}</span>
          {state === "soon" && <Soon />}
        </span>
      );
    }
    return <Mark state={state} />;
  };

  return (
    <div>
      <PhoneComparison plans={plans} period={period} data={data} onChangeHint={onChangeHint}
        open={open} listId={phoneId} cell={cell} />
      <div data-compare-scroll
        className="relative hidden overflow-x-auto rounded-[24px] border border-line bg-surface md:block lg:overflow-visible">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[13px] sm:min-w-[680px] sm:text-[14px]">
          <caption className="sr-only">{t("pricing.compare.title")}</caption>
          <thead>
            <tr>
              <th scope="col"
                className="sticky left-0 z-20 w-[132px] bg-surface px-3 py-4 text-left align-bottom sm:w-[34%] sm:px-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted lg:top-[calc(var(--header-h)+8px)] lg:rounded-tl-[24px]">
                {t("pricing.compare.feature")}
              </th>
              {plans.map((plan) => {
                const look = planPresentation(plan.slug);
                const name = look.nameKey ? t(look.nameKey) : plan.name;
                const pro = look.tone === "pro";
                const cta = planCta(plan, period, data, t, name);
                return (
                  <th key={plan.id} scope="col" data-compare-plan={plan.slug}
                    className={cn(
                      "z-10 px-2 py-4 text-center align-bottom sm:px-3 lg:sticky lg:top-[calc(var(--header-h)+8px)]",
                      pro ? "bg-[rgb(var(--accent-soft))]" : "bg-surface",
                      pro && "rounded-t-2xl shadow-[inset_0_3px_0_rgb(var(--accent))]",
                    )}>
                    <span className="block font-display text-[15px] font-bold uppercase tracking-[0.04em] text-ink">{name}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      <span className="whitespace-nowrap font-semibold tabular-nums text-ink">{formatMoney(planMonthlyCents(plan, period), plan.currency)}</span>
                      {" "}{t("pricing.plan.perMonth")}
                    </span>
                    <span className="mt-2.5 block">
                      {cta.kind === "buy" ? (
                        <Gate href={cta.href} signedIn={data.viewer.signedIn}
                          className={cn(
                            "inline-flex h-9 w-full max-w-[150px] items-center justify-center rounded-lg px-3 text-[13px] font-semibold transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--surface))]",
                            pro ? "cta [--accent:var(--accent-strong)]" : "border border-line-strong bg-surface text-ink hover:bg-raised",
                          )}>
                          {t("pricing.compare.choose")}
                        </Gate>
                      ) : (
                        <span className="inline-flex flex-col items-center gap-1">
                          <span className="inline-flex h-9 items-center rounded-lg px-2 text-[12px] font-medium text-muted">{cta.label}</span>
                          {cta.hint === "change" && (
                            <button type="button" onClick={onChangeHint} className="text-[12px] font-medium text-[rgb(var(--accent-strong))] underline-offset-2 hover:underline dark:text-[rgb(var(--accent-glow))]">
                              {t("pricing.plan.changeHint")}
                            </button>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody id={bodyId}>
            {COMPARE_GROUPS.map((group) => {
              const rows = group.rows.map((key) => ({ key, index: seen++ }));
              const visible = rows.filter((r) => open || r.index < COMPARE_INITIAL_ROWS);
              return (
                <Fragment key={group.key}>
                  <tr hidden={visible.length === 0}>
                    <th scope="colgroup" colSpan={plans.length + 1}
                      className="sticky left-0 bg-surface px-4 pb-2 pt-5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                      {t(group.titleKey)}
                    </th>
                  </tr>
                  {rows.map(({ key, index }) => (
                    <tr key={key} data-compare-row={key} hidden={!open && index >= COMPARE_INITIAL_ROWS}>
                      <th scope="row"
                        className="sticky left-0 z-10 border-t border-line bg-surface px-3 py-3 text-left font-medium text-ink shadow-[6px_0_10px_-8px_rgb(0_0_0/0.18)] sm:px-4 sm:shadow-none">
                        {t(featureLabelKey(key))}
                      </th>
                      {plans.map((plan) => {
                        const pro = planPresentation(plan.slug).tone === "pro";
                        return (
                          <td key={plan.id}
                            className={cn(
                              "border-t border-line px-2 py-3 text-center text-ink sm:px-3",
                              pro && "bg-[rgb(var(--accent-soft)/0.6)]",
                            )}>
                            {cell(plan, key)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {/* The fold: a fade over the last visible rows, decorative only. */}
        {!open && (
          <div aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-[24px] bg-gradient-to-b from-transparent to-[rgb(var(--surface))]" />
        )}
      </div>
      {total > COMPARE_INITIAL_ROWS && (
        <div className="mt-4 flex justify-center">
          <button type="button" aria-expanded={open} aria-controls={`${bodyId} ${phoneId}`} onClick={() => setOpen((v) => !v)}
            data-compare-toggle
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-[14px] font-semibold text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]">
            {t(open ? "pricing.compare.showLess" : "pricing.compare.showAll")}
            <ChevronDown size={16} aria-hidden className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Starter vs PRO on a phone to begin with; either side can be any plan. */
const PHONE_DEFAULT: readonly [string, string] = ["starter", "pro"];

/**
 * The two columns' plans after one of them is changed. Picking the plan the
 * other column shows swaps the two — never the same plan twice, and the plan
 * that was pushed out lands where the new one came from.
 */
export function pickPair(pair: readonly [string, string], side: 0 | 1, slug: string): [string, string] {
  const next: [string, string] = [pair[0], pair[1]];
  const other = side === 0 ? 1 : 0;
  if (next[other] === slug) next[other] = next[side];
  next[side] = slug;
  return next;
}

/** The pair a phone opens with: Starter | PRO where both exist, else the first two plans. */
export function initialPair(slugs: readonly string[]): [string, string] {
  const [a, b] = PHONE_DEFAULT;
  if (slugs.includes(a) && slugs.includes(b)) return [a, b];
  const first = slugs[0] ?? "";
  return [first, slugs.find((x) => x !== first) ?? first];
}

/**
 * THE COMPARISON ON A PHONE (< 768px): two plans, two columns, no sideways
 * scroll. The plan header sticks under the top bar (safe area included) at
 * its own height, without a scroll box of its own; each feature's name runs
 * the full width and its two values sit under their plans. The same cells
 * and the same fold as the table.
 */
function PhoneComparison({ plans, period, data, onChangeHint, open, listId, cell }: {
  plans: PricingPlanView[];
  period: BillingPeriod;
  data: PricingPageData;
  onChangeHint: () => void;
  open: boolean;
  listId: string;
  cell: (plan: PricingPlanView, key: FeatureKey) => ReactNode;
}) {
  const { t } = useI18n();
  const [pair, setPair] = useState<[string, string]>(() => initialPair(plans.map((p) => p.slug)));
  const shown = pair.map((slug) => plans.find((p) => p.slug === slug)).filter((p): p is PricingPlanView => Boolean(p));
  if (shown.length < 2 || shown[0].slug === shown[1].slug) return null;
  const nameOf = (plan: PricingPlanView) => {
    const look = planPresentation(plan.slug);
    return look.nameKey ? t(look.nameKey) : plan.name;
  };
  const isPro = (plan: PricingPlanView) => planPresentation(plan.slug).tone === "pro";
  let seen = 0;

  return (
    <div data-compare-phone className="relative md:hidden">
      <div data-compare-phone-head
        className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top,0px)+8px)] z-20 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[0_12px_24px_-20px_rgb(0_0_0/0.45)]">
        {shown.map((plan, side) => {
          const cta = planCta(plan, period, data, t, nameOf(plan));
          const pro = isPro(plan);
          return (
            <div key={side} data-compare-phone-col={plan.slug}
              className={cn("flex min-w-0 flex-col items-stretch gap-1.5 rounded-xl p-1.5 text-center",
                pro && "bg-[rgb(var(--accent-soft))] shadow-[inset_0_2px_0_rgb(var(--accent))]")}>
              <label className="relative block">
                <span className="sr-only">{t(side === 0 ? "pricing.compare.phone.left" : "pricing.compare.phone.right")}</span>
                <select value={plan.slug} data-compare-pick={side}
                  onChange={(e) => setPair((p) => pickPair(p, side === 0 ? 0 : 1, e.target.value))}
                  className="h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-line-strong bg-surface pl-2.5 pr-7 text-center font-display text-[14px] font-bold uppercase tracking-[0.04em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]">
                  {plans.map((p) => <option key={p.slug} value={p.slug}>{nameOf(p)}</option>)}
                </select>
                <ChevronDown size={15} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
              </label>
              <span className="text-[12.5px] leading-tight text-muted [overflow-wrap:normal]">
                <span data-compare-phone-price className="whitespace-nowrap font-semibold tabular-nums text-ink">
                  {formatMoney(planMonthlyCents(plan, period), plan.currency)}
                </span>{" "}
                <span className="whitespace-nowrap">{t("pricing.plan.perMonth")}</span>
              </span>
              {cta.kind === "buy" ? (
                <Gate href={cta.href} signedIn={data.viewer.signedIn}
                  className={cn(
                    "inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--surface))]",
                    pro ? "cta [--accent:var(--accent-strong)]" : "border border-line-strong bg-surface text-ink hover:bg-raised",
                  )}>
                  {t("pricing.compare.choose")}
                </Gate>
              ) : (
                <span className="flex min-h-11 flex-col items-center justify-center gap-0.5">
                  <span className="text-[12px] font-medium leading-tight text-muted">{cta.label}</span>
                  {cta.hint === "change" && (
                    <button type="button" onClick={onChangeHint}
                      className="min-h-11 text-[12px] font-medium text-[rgb(var(--accent-strong))] underline-offset-2 hover:underline dark:text-[rgb(var(--accent-glow))]">
                      {t("pricing.plan.changeHint")}
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div id={listId} data-compare-phone-rows className="relative mt-3">
        {COMPARE_GROUPS.map((group) => {
          const rows = group.rows.map((key) => ({ key, index: seen++ }));
          const visible = rows.filter((r) => open || r.index < COMPARE_INITIAL_ROWS);
          if (visible.length === 0) return null;
          return (
            <section key={group.key} aria-label={t(group.titleKey)} className="mb-3">
              <h3 className="rounded-xl bg-raised px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                {t(group.titleKey)}
              </h3>
              <dl>
                {visible.map(({ key }) => (
                  <div key={key} data-compare-phone-row={key} className="border-b border-line px-1 py-2.5 last:border-b-0">
                    <dt className="text-[13.5px] font-medium leading-snug text-ink">{t(featureLabelKey(key))}</dt>
                    <dd className="mt-1.5 grid grid-cols-2 gap-2 text-[13.5px]">
                      {shown.map((plan, side) => (
                        <span key={side} data-compare-phone-value={plan.slug}
                          className={cn("flex min-h-8 items-center justify-center rounded-lg px-1 text-center text-ink [overflow-wrap:normal]",
                            isPro(plan) && "bg-[rgb(var(--accent-soft)/0.6)]")}>
                          <span className="sr-only">{nameOf(plan)}: </span>
                          {cell(plan, key)}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
        {!open && (
          <div aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-[rgb(var(--bg))]" />
        )}
      </div>
    </div>
  );
}

function Soon() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-line">
      <Clock3 size={11} aria-hidden /> {t("pricing.soon")}
    </span>
  );
}

function Mark({ state }: { state: "yes" | "soon" | "no" }) {
  const { t } = useI18n();
  if (state === "soon") return <Soon />;
  if (state === "yes") {
    return (
      <span className="inline-flex items-center justify-center text-success">
        <Check size={17} strokeWidth={2.5} aria-hidden />
        <span className="sr-only">{t("pricing.compare.yes")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center text-faint">
      <Minus size={16} aria-hidden />
      <span className="sr-only">{t("pricing.compare.no")}</span>
    </span>
  );
}
