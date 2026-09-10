"use client";
import { useMemo, useState } from "react";
import { Check, Crown, FileText, Minus, Rocket, ShieldCheck, Sparkles, Star, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Diamond } from "@/components/layout/credits-control";
import { cn } from "@/lib/utils";

/**
 * CENNIK — plans, the comparison, the credit packs and a custom amount, on
 * one page, because that is the order the questions arrive in: which plan,
 * how do they differ, and what if I just need credits this once.
 *
 * EVERY NUMBER ON THIS PAGE COMES FROM THE DATABASE. The plan prices and
 * capabilities are `subscription_plans` rows; the packs are `credit_packages`
 * rows; the custom slider prices by interpolating the real pack ladder rather
 * than inventing a rate card. There is no struck-through "old price" anywhere
 * because GrovBase does not store one, and a discount off a price that never
 * existed is a lie told in a currency.
 *
 * Checkout is not wired — no payment provider is connected — so every buy
 * button is disabled and says so. The layout is the finished one; the
 * transaction is the part that is honestly missing.
 */

export type PlanCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  monthlyCredits: number;
  bonusCredits: number;
  /** The capability bag as stored: {workspace_members, priority_queue, …}. */
  capabilities: Record<string, unknown>;
  featured: boolean;
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
};

/** Annual billing is ten months for twelve — the shipped convention, and the
 *  only annual rule the data models. The badge shows what that really is. */
const ANNUAL_MONTHS_PAID = 10;
const ANNUAL_PCT = Math.round((1 - ANNUAL_MONTHS_PAID / 12) * 100);

/** A visual step per tier so the row reads as a climb, not four copies. */
const TIER_ICON: LucideIcon[] = [Sparkles, Zap, Crown, Rocket];
const TIER_NOTE = ["plans.freeNote", "plans.paidNote", "plans.topNote", "plans.maxNote"];

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const flag = (v: unknown): boolean => v === true;

/**
 * "2 osób" is wrong in Polish and the app is Polish first, so the seat count
 * picks its own form: 1 → osoba, 2-4 → osoby, 5+ → osób — minus the 12-14
 * exception, which is the case every naive plural rule gets wrong.
 */
function seatLabel(
  seats: number,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (seats < 0) return t("plans.unlimited");
  if (seats === 1) return t("plans.seatsOne");
  const last = seats % 10;
  const teen = seats % 100 >= 12 && seats % 100 <= 14;
  return last >= 2 && last <= 4 && !teen
    ? t("plans.seatsFew", { n: seats })
    : t("plans.seats", { n: seats });
}

export function PricingBoard({ plans, packs, currentSlug }: {
  plans: PlanCard[]; packs: PackCard[]; currentSlug: string;
}) {
  const { t, locale } = useI18n();
  const [annual, setAnnual] = useState(false);

  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const money = (cents: number, currency: string, digits = 0) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: digits }).format(cents / 100);

  return (
    <div className="space-y-6">
      <PlanSection plans={plans} currentSlug={currentSlug} annual={annual} setAnnual={setAnnual}
        t={t} n={n} money={money} />
      <ComparisonSection plans={plans} t={t} n={n} />
      {packs.length > 0 && <TopUpSection packs={packs} t={t} n={n} money={money} />}
    </div>
  );
}

/* ── 1. PLANS ─────────────────────────────────────────────────────────────*/

function PlanSection({ plans, currentSlug, annual, setAnnual, t, n, money }: {
  plans: PlanCard[]; currentSlug: string; annual: boolean; setAnnual: (v: boolean) => void;
  t: (k: string, v?: Record<string, string | number>) => string;
  n: (v: number) => string;
  money: (cents: number, currency: string, digits?: number) => string;
}) {
  return (
    <section data-pricing-plans>
      {/* The toggle is centred above the row, as one control: the word, then
          the two states, then what the annual one is worth. */}
      <div className="mb-5 flex justify-center">
        <div className="flex items-center gap-1 rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.9))] bg-sunken/80 p-1">
          <span className="px-3 text-[12.5px] font-medium text-muted">{t("plans.billing")}</span>
          {([false, true] as const).map((v) => (
            <button key={String(v)} type="button" onClick={() => setAnnual(v)}
              aria-pressed={annual === v} data-billing={v ? "annual" : "monthly"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[13px] font-semibold transition-all duration-200",
                annual === v ? "bg-[rgb(var(--accent))] text-white shadow-[0_8px_20px_-10px_rgb(var(--accent))]" : "text-muted hover:text-ink",
              )}>
              {t(v ? "plans.annual" : "plans.monthly")}
              {v && (
                <span className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10.5px] font-bold",
                  annual ? "bg-white/20 text-white" : "bg-[rgb(var(--success)/0.16)] text-success",
                )}>
                  {t("plans.annualOff", { n: ANNUAL_PCT })}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} index={i} annual={annual}
            isCurrent={p.slug === currentSlug} t={t} n={n} money={money} />
        ))}
      </div>
    </section>
  );
}

function PlanColumn({ plan: p, index, annual, isCurrent, t, n, money }: {
  plan: PlanCard; index: number; annual: boolean; isCurrent: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
  n: (v: number) => string;
  money: (cents: number, currency: string, digits?: number) => string;
}) {
  const Icon = TIER_ICON[Math.min(index, TIER_ICON.length - 1)];
  const free = p.priceCents === 0;
  const effective = annual ? Math.round(p.priceCents * ANNUAL_MONTHS_PAID / 12) : p.priceCents;
  const total = p.monthlyCredits + p.bonusCredits;
  // What a credit costs on this plan — the number that actually compares two
  // plans, and it is division, not marketing.
  const perCredit = total > 0 && effective > 0 ? (effective / 100 / total).toFixed(2) : null;
  const rows = planRows(p, t, n);

  return (
    <article data-plan={p.slug} className={cn(
      "panel relative flex flex-col overflow-hidden rounded-2xl p-5",
      p.featured && "ring-2 ring-[rgb(var(--accent)/0.6)] shadow-[0_28px_60px_-30px_rgb(var(--accent)/0.85)] xl:-translate-y-1.5",
    )}>
      {p.featured && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(165deg, rgb(var(--accent) / 0.20), rgb(var(--violet) / 0.09) 55%, transparent)" }} />
          <span data-plan-badge
            className="relative mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-[rgb(var(--accent))] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white">
            <Star size={10} className="fill-current" aria-hidden />
            {t("plans.mostPopular")}
          </span>
        </>
      )}

      <div className="relative flex items-center justify-between gap-2">
        <h3 className="font-display text-[15px] font-bold uppercase tracking-[0.06em]">{p.name}</h3>
        <span aria-hidden className={cn("flex h-8 w-8 items-center justify-center rounded-lg",
          p.featured ? "bg-[rgb(var(--accent)/0.2)] text-accent" : "bg-raised text-muted")}>
          <Icon size={15} />
        </span>
      </div>
      {p.description && (
        <p className="relative mt-1 text-[12px] leading-snug text-muted">{p.description}</p>
      )}

      <div className="relative mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-[2rem] font-semibold leading-none tracking-tight">
          {money(effective, p.currency)}
        </span>
        {!free && <span className="text-[12px] font-medium text-muted">{t("plans.perMonth")}</span>}
        {annual && !free && (
          <span className="text-[13px] font-semibold text-faint line-through">{money(p.priceCents, p.currency)}</span>
        )}
      </div>
      {perCredit && (
        <p className="relative mt-1 text-[11.5px] text-faint">{t("plans.perCredit", { n: perCredit })}</p>
      )}
      {annual && !free && (
        <p className="relative mt-0.5 text-[11.5px] text-faint">{t("plans.billedAnnually")}</p>
      )}

      <div className="relative mt-4">
        <button disabled data-plan-cta className={cn(
          "h-11 w-full rounded-xl text-sm font-semibold opacity-70",
          isCurrent
            ? "bg-[rgb(var(--success)/0.14)] text-success ring-1 ring-[rgb(var(--success)/0.4)]"
            : p.featured ? "cta" : "border border-line text-muted",
        )}>
          {isCurrent ? t("plans.current") : t("plans.choose")}
        </button>
      </div>

      <ul className="relative mt-4 space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2 text-[12.5px] leading-snug">
            {r.on
              ? <Check size={13} aria-hidden strokeWidth={3}
                  className={cn("mt-0.5 shrink-0", p.featured ? "text-accent" : "text-success")} />
              : <Minus size={13} aria-hidden strokeWidth={3} className="mt-0.5 shrink-0 text-faint" />}
            <span className={r.on ? "text-ink/85" : "text-faint"}>
              {r.label}
              {r.detail && <span className="block text-[11px] text-faint">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {/* The quiet closing line the reference puts in a tinted box. It says
          who the tier is FOR — never a repeat of the descriptor above or of a
          row already in the list. */}
      <div className="relative mt-auto pt-4">
        <p className="rounded-xl bg-[rgb(var(--ink)/0.05)] px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
          {t(TIER_NOTE[Math.min(index, TIER_NOTE.length - 1)])}
        </p>
      </div>
    </article>
  );
}

/** The capability list for one plan — read from the row, never assumed. */
function planRows(p: PlanCard, t: (k: string, v?: Record<string, string | number>) => string, n: (v: number) => string) {
  const seats = num(p.capabilities.workspace_members);
  return [
    {
      label: t("plans.creditsMo", { n: n(p.monthlyCredits) }),
      detail: p.bonusCredits > 0 ? `+${n(p.bonusCredits)}` : null,
      on: p.monthlyCredits > 0,
    },
    { label: t("plans.row.imageTools"), detail: null, on: true },
    {
      label: t("plans.row.seats"),
      detail: seats === null ? null : seatLabel(seats, t),
      on: seats !== null && (seats < 0 || seats > 1),
    },
    { label: t("plans.row.priority"), detail: null, on: flag(p.capabilities.priority_queue) },
    { label: t("plans.row.operator"), detail: null, on: flag(p.capabilities.operator_mode) },
  ];
}

/* ── 2. COMPARISON ────────────────────────────────────────────────────────*/

function ComparisonSection({ plans, t, n }: {
  plans: PlanCard[];
  t: (k: string, v?: Record<string, string | number>) => string;
  n: (v: number) => string;
}) {
  const rows = useMemo(() => [
    {
      key: "credits",
      label: t("plans.row.credits"),
      icon: Diamond,
      cell: (p: PlanCard) => n(p.monthlyCredits + p.bonusCredits),
    },
    {
      key: "seats", label: t("plans.row.seats"), icon: Users,
      cell: (p: PlanCard) => {
        const s = num(p.capabilities.workspace_members);
        return s === null ? "—" : seatLabel(s, t);
      },
    },
    { key: "imageTools", label: t("plans.row.imageTools"), icon: Sparkles, cell: () => true },
    { key: "priority", label: t("plans.row.priority"), icon: Zap, cell: (p: PlanCard) => flag(p.capabilities.priority_queue) },
    { key: "operator", label: t("plans.row.operator"), icon: ShieldCheck, cell: (p: PlanCard) => flag(p.capabilities.operator_mode) },
    // No video backend exists on any plan; the row says so rather than
    // showing four ticks for something nobody can run.
    { key: "video", label: t("plans.row.video"), icon: FileText, cell: () => t("features.badgeSoon") },
  ], [t, n]);

  return (
    <section data-pricing-compare className="panel rounded-2xl p-4 sm:p-5">
      <h2 className="font-display text-[16px] font-semibold tracking-tight">{t("plans.compareTitle")}</h2>
      {/* The TABLE scrolls, never the page: a four-column comparison cannot
          fit 360px, and a page that slides sideways is broken, not responsive. */}
      <div className="thin-scroll mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[38%] py-2 pr-3 text-left font-semibold text-muted">
                {t("plans.compareFeature")}
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className={cn(
                  "px-2 py-2 text-center font-semibold",
                  p.featured && "bg-[rgb(var(--accent)/0.08)]",
                )}>
                  <span className="block text-[13px] font-bold uppercase tracking-[0.05em]">{p.name}</span>
                  <span className="block text-[11px] font-medium text-faint">
                    {p.priceCents === 0 ? "0 zł" : `${Math.round(p.priceCents / 100)} zł`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-0">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                  <span className="flex items-center gap-2 text-muted">
                    <r.icon size={13} aria-hidden className="shrink-0 text-faint" />
                    {r.label}
                  </span>
                </th>
                {plans.map((p) => {
                  const v = r.cell(p);
                  return (
                    <td key={p.id} className={cn(
                      "px-2 py-2.5 text-center tabular-nums",
                      p.featured && "bg-[rgb(var(--accent)/0.06)]",
                    )}>
                      {v === true
                        ? <Check size={14} aria-hidden strokeWidth={3} className="mx-auto text-success" />
                        : v === false
                          ? <Minus size={14} aria-hidden strokeWidth={3} className="mx-auto text-faint" />
                          : <span className="text-ink/85">{v}</span>}
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

function TopUpSection({ packs, t, n, money }: {
  packs: PackCard[];
  t: (k: string, v?: Record<string, string | number>) => string;
  n: (v: number) => string;
  money: (cents: number, currency: string, digits?: number) => string;
}) {
  // Largest first, the way a top-up list is read — you arrive knowing roughly
  // how much you need and scan down to it.
  const ladder = useMemo(
    () => [...packs].sort((a, b) => (b.credits + b.bonusCredits) - (a.credits + a.bonusCredits)),
    [packs],
  );
  // The reference rate: the smallest pack. Every "-N%" on this page is measured
  // against it and says so, because GrovBase stores no former price to discount.
  const base = useMemo(() => {
    const smallest = [...packs].sort((a, b) => (a.credits + a.bonusCredits) - (b.credits + b.bonusCredits))[0];
    return smallest ? smallest.priceCents / (smallest.credits + smallest.bonusCredits) : 0;
  }, [packs]);
  const currency = packs[0]?.currency ?? "PLN";

  return (
    <section data-pricing-topup className="panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.16)] text-accent">
            <Diamond size={13} />
          </span>
          {t("packs.topUpTitle")}
        </h2>
        <p className="text-[12.5px] text-muted">{t("packs.topUpSub")}</p>
      </div>

      <div className="mt-4 grid gap-3.5 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* LEFT — the fixed packs, one row each. */}
        <ul className="space-y-2">
          {ladder.map((p) => {
            const total = p.credits + p.bonusCredits;
            const per = p.priceCents / total;
            const off = base > 0 ? Math.round((1 - per / base) * 100) : 0;
            return (
              // A grid, not a flex row: at 360px an icon, a two-line label, a
              // price and a button do not share one line, and the label was
              // breaking mid-word to make room. The button drops to its own
              // row on a phone and rejoins the line from `sm`.
              <li key={p.id} data-pack={p.id} className={cn(
                "relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border p-3",
                "sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
                p.featured
                  ? "border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.07)]"
                  : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-[rgb(var(--surface)/0.5)]",
              )}>
                {p.featured && (
                  <span className="absolute -top-2 left-3 rounded-md bg-[rgb(var(--success))] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
                    {t("packs.bestValue")}
                  </span>
                )}
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.14)] text-accent">
                  <Diamond size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold [overflow-wrap:normal]">
                    {n(p.credits)}&nbsp;{t("packs.customCredits")}
                    {p.bonusCredits > 0 && <span className="text-success"> +{n(p.bonusCredits)}</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
                    <span>{t("packs.perCredit", { n: (per / 100).toFixed(2) })}</span>
                    {off > 0 && (
                      <span className="rounded-md bg-[rgb(var(--success)/0.16)] px-1.5 py-0.5 font-semibold text-success">
                        {t("packs.save", { n: off })}
                      </span>
                    )}
                  </p>
                </div>
                <p className="shrink-0 font-display text-[17px] font-semibold tracking-tight">
                  {money(p.priceCents, p.currency)}
                </p>
                <button disabled data-pack-buy className={cn(
                  "col-span-3 h-9 shrink-0 rounded-lg px-3.5 text-[12.5px] font-semibold opacity-70 sm:col-span-1",
                  p.featured ? "cta" : "border border-line text-muted",
                )}>
                  {t("packs.buy")}
                </button>
              </li>
            );
          })}
          <li className="flex items-center gap-2 pt-1 text-[11.5px] text-faint">
            <Diamond size={11} />
            {t("packs.noExpiry")}
          </li>
          <li className="text-[11px] leading-relaxed text-faint">{t("packs.saveBasis")}</li>
        </ul>

        {/* RIGHT — any amount, priced off the same ladder. */}
        <CustomAmount packs={packs} base={base} currency={currency} t={t} n={n} money={money} />
      </div>
    </section>
  );
}

/**
 * Any number of credits between the smallest and the largest pack.
 *
 * The price is INTERPOLATED ALONG THE REAL PACK LADDER — between the two packs
 * that bracket the chosen amount — so the curve a customer sees on the slider
 * is the same curve the fixed packs are on. Nothing here is a made-up rate.
 */
function CustomAmount({ packs, base, currency, t, n, money }: {
  packs: PackCard[]; base: number; currency: string;
  t: (k: string, v?: Record<string, string | number>) => string;
  n: (v: number) => string;
  money: (cents: number, currency: string, digits?: number) => string;
}) {
  const ladder = useMemo(
    () => [...packs]
      .map((p) => ({ credits: p.credits + p.bonusCredits, cents: p.priceCents }))
      .sort((a, b) => a.credits - b.credits),
    [packs],
  );
  const min = ladder[0]?.credits ?? 0;
  const max = ladder[ladder.length - 1]?.credits ?? 0;
  const step = Math.max(50, Math.round((max - min) / 100 / 50) * 50);
  const [credits, setCredits] = useState(() => {
    // Open on the featured pack when there is one — the amount most people take.
    const featured = packs.find((p) => p.featured);
    return featured ? featured.credits + featured.bonusCredits : Math.round((min + max) / 2);
  });

  const cents = useMemo(() => priceFor(credits, ladder), [credits, ladder]);
  const per = credits > 0 ? cents / credits : 0;
  const off = base > 0 && per > 0 ? Math.round((1 - per / base) * 100) : 0;

  if (max <= min) return null;

  return (
    <div data-pricing-custom className="flex flex-col rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-[rgb(var(--surface)/0.5)] p-4">
      <p className="text-[13.5px] font-semibold">{t("packs.customTitle")}</p>
      <p className="mt-0.5 text-[11.5px] text-muted">{t("packs.customSub")}</p>

      <p className="mt-4 flex flex-wrap items-baseline gap-2">
        <span data-custom-credits className="font-display text-[2.1rem] font-semibold leading-none tracking-tight text-accent tabular-nums">
          {n(credits)}
        </span>
        <span className="text-[13px] font-medium text-muted">{t("packs.customCredits")}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
        <span>{t("packs.perCredit", { n: (per / 100).toFixed(2) })}</span>
        {off > 0 && (
          <span className="rounded-md bg-[rgb(var(--success)/0.16)] px-1.5 py-0.5 font-semibold text-success">
            {t("packs.save", { n: off })}
          </span>
        )}
      </p>

      <label htmlFor="custom-credits" className="sr-only">{t("packs.customTitle")}</label>
      <input
        id="custom-credits" type="range" min={min} max={max} step={step} value={credits}
        onChange={(e) => setCredits(Number(e.target.value))}
        data-custom-slider
        className="mt-4 h-9 w-full cursor-pointer accent-[rgb(var(--accent))]"
      />
      <div className="flex items-center justify-between text-[11px] text-faint tabular-nums">
        <span className="flex items-center gap-1"><Diamond size={10} />{n(min)}</span>
        <span className="flex items-center gap-1">{n(max)}<Diamond size={10} /></span>
      </div>
      <p className="mt-2 text-center text-[11px] text-faint">{t("packs.suggested", { n: n(credits) })}</p>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[rgb(var(--ink)/0.06)] px-3 py-2.5">
        <span className="text-[12.5px] font-medium text-muted">{t("packs.toPay")}</span>
        <span data-custom-price className="font-display text-[19px] font-semibold tracking-tight">
          {money(cents, currency)}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5 text-[11.5px] text-muted">
        {[t("packs.instant"), t("packs.secure"), t("packs.invoice")].map((line) => (
          <li key={line} className="flex items-center gap-1.5">
            <Check size={11} aria-hidden strokeWidth={3} className="shrink-0 text-success" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-3">
        <button disabled data-custom-buy
          className="cta h-11 w-full rounded-xl text-sm font-semibold opacity-70">
          {t("packs.buyN", { n: n(credits) })}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-faint">{t("packs.soon")}</p>
      </div>
    </div>
  );
}

/**
 * The price of an arbitrary credit amount, read off the real pack ladder:
 * linear interpolation between the two packs that bracket it, clamped to the
 * ends. Rounded to whole złoty so the figure looks like a price.
 */
function priceFor(credits: number, ladder: { credits: number; cents: number }[]): number {
  if (ladder.length === 0) return 0;
  if (credits <= ladder[0].credits) return ladder[0].cents;
  const last = ladder[ladder.length - 1];
  if (credits >= last.credits) return last.cents;
  for (let i = 1; i < ladder.length; i += 1) {
    const lo = ladder[i - 1];
    const hi = ladder[i];
    if (credits <= hi.credits) {
      const ratio = (credits - lo.credits) / (hi.credits - lo.credits);
      return Math.round((lo.cents + (hi.cents - lo.cents) * ratio) / 100) * 100;
    }
  }
  return last.cents;
}
