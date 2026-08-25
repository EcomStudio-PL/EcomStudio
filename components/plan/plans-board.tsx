"use client";
import { useState } from "react";
import { Check, Crown, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type PlanCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  monthlyCredits: number;
  bonusCredits: number;
  features: string[];
  featured: boolean;
};

/** Visual tiers, in ascending order of commitment. Each step is a real step:
 *  plain → outlined → filled accent → deep gradient. Reading the row left to
 *  right should feel like climbing, not like four copies of one card. */
const TIER: { icon: LucideIcon; wash: string | null; ring: string; badge: "none" | "popular" | "value" }[] = [
  { icon: Sparkles, wash: null, ring: "", badge: "none" },
  { icon: Zap, wash: "radial-gradient(20rem 12rem at 50% -20%, rgb(var(--violet) / 0.18), transparent 70%)", ring: "", badge: "none" },
  {
    icon: Crown,
    wash: "linear-gradient(165deg, rgb(var(--accent) / 0.22), rgb(var(--violet) / 0.10) 55%, transparent)",
    ring: "ring-2 ring-[rgb(var(--accent)/0.6)] shadow-[0_28px_60px_-30px_rgb(var(--accent)/0.85)]",
    badge: "popular",
  },
  {
    icon: Crown,
    wash: "linear-gradient(165deg, rgb(var(--purple) / 0.26), rgb(var(--accent) / 0.12) 60%, transparent)",
    ring: "ring-1 ring-[rgb(var(--purple)/0.55)]",
    badge: "value",
  },
];

/** Roughly how many product shots a credit balance buys, for a plain-language
 *  second line under the credit count. */
const CREDITS_PER_SHOT = 53;

/**
 * PLANS — four visually distinct tiers with a monthly/annual toggle.
 *
 * Annual billing is priced as ten months for twelve, shown as an effective
 * monthly rate with the full monthly price struck through, so the saving is
 * legible without arithmetic. Checkout is not wired yet, so every button
 * states that plainly instead of pretending to sell.
 */
export function PlansBoard({ plans, currentSlug }: { plans: PlanCard[]; currentSlug: string }) {
  const { t, locale } = useI18n();
  const [annual, setAnnual] = useState(false);
  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

  return (
    <div>
      {/* BILLING TOGGLE */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-stretch gap-1 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-sunken/80 p-1">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setAnnual(v)}
              aria-pressed={annual === v}
              className={cn(
                "rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-all duration-200",
                annual === v ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]" : "text-muted hover:text-ink",
              )}
            >
              {t(v ? "plans.annual" : "plans.monthly")}
            </button>
          ))}
        </div>
        {annual && (
          <span className="rounded-full bg-[rgb(var(--success)/0.14)] px-3 py-1 text-[12px] font-semibold text-success">
            {t("plans.annualNote")}
          </span>
        )}
      </div>

      <div className="grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p, i) => {
          const tier = TIER[Math.min(i, TIER.length - 1)];
          const Icon = tier.icon;
          const isCurrent = p.slug === currentSlug;
          const free = p.priceCents === 0;
          // Annual: pay for ten months, get twelve.
          const effective = annual ? Math.round(p.priceCents * 10 / 12) : p.priceCents;
          const shots = Math.floor((p.monthlyCredits + p.bonusCredits) / CREDITS_PER_SHOT);

          return (
            <article
              key={p.id}
              className={cn(
                "panel relative flex flex-col overflow-hidden rounded-2xl p-5 transition-transform duration-200",
                tier.ring,
                tier.badge === "popular" && "xl:-translate-y-2",
              )}
            >
              {tier.wash && (
                <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: tier.wash }} />
              )}

              {/* BADGE */}
              {tier.badge !== "none" && (
                <span className={cn(
                  "relative mb-3 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]",
                  tier.badge === "popular"
                    ? "bg-[rgb(var(--accent))] text-white shadow-[0_8px_20px_-10px_rgb(var(--accent))]"
                    : "bg-[rgb(var(--purple)/0.22)] text-[rgb(var(--purple))]",
                )}>
                  {t(tier.badge === "popular" ? "plans.mostPopular" : "plans.bestValue")}
                </span>
              )}

              <div className="relative flex items-center justify-between gap-2">
                <h3 className="font-display text-[15px] font-bold uppercase tracking-[0.06em]">{p.name}</h3>
                <span aria-hidden className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg",
                  tier.badge === "popular" ? "bg-[rgb(var(--accent)/0.2)] text-accent"
                    : tier.badge === "value" ? "bg-[rgb(var(--purple)/0.2)] text-[rgb(var(--purple))]"
                      : "bg-raised text-muted",
                )}>
                  <Icon size={15} />
                </span>
              </div>
              {p.description && <p className="relative mt-1 text-[12.5px] leading-snug text-muted">{p.description}</p>}

              {/* PRICE */}
              <div className="relative mt-4 flex items-baseline gap-2">
                {annual && !free && (
                  <span className="text-sm font-semibold text-faint line-through">{money(p.priceCents, p.currency)}</span>
                )}
                <span className="font-display text-[2rem] font-semibold leading-none tracking-tight">
                  {money(effective, p.currency)}
                </span>
                {!free && <span className="text-[12px] font-medium text-muted">{t("plans.perMonth")}</span>}
              </div>
              {annual && !free && (
                <p className="relative mt-1 text-[11.5px] text-faint">{t("plans.billedAnnually")}</p>
              )}

              {/* CREDITS */}
              <div className="relative mt-4 rounded-xl bg-[rgb(var(--ink)/0.05)] p-3">
                <p className="text-[13px] font-semibold">
                  {t("plans.creditsMo", { n: new Intl.NumberFormat(locale).format(p.monthlyCredits) })}
                  {p.bonusCredits > 0 && (
                    <span className="text-accent"> +{new Intl.NumberFormat(locale).format(p.bonusCredits)}</span>
                  )}
                </p>
                {shots > 0 && <p className="mt-0.5 text-[11.5px] text-faint">{t("plans.approx", { n: shots })}</p>}
              </div>

              {/* FEATURES */}
              {p.features.length > 0 && (
                <ul className="relative mt-4 space-y-1.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12.5px] leading-snug">
                      <Check size={13} aria-hidden strokeWidth={3}
                        className={cn("mt-0.5 shrink-0", tier.badge === "popular" ? "text-accent" : "text-success")} />
                      <span className="text-muted">{f}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="relative mt-auto pt-5">
                <button
                  disabled
                  className={cn(
                    "h-11 w-full rounded-xl text-sm font-semibold transition-opacity duration-200",
                    isCurrent
                      ? "bg-[rgb(var(--success)/0.14)] text-success ring-1 ring-[rgb(var(--success)/0.4)]"
                      : tier.badge === "popular"
                        ? "cta opacity-60"
                        : "border border-line text-muted opacity-60",
                  )}
                >
                  {isCurrent ? t("plans.current") : t("plans.choose")}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-muted">{t("plans.soon")}</p>
    </div>
  );
}
