"use client";
import { Check, Flame, Package, Rocket, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Diamond } from "@/components/layout/credits-control";
import { cn } from "@/lib/utils";

export type CreditPack = {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  priceCents: number;
  currency: string;
  featured: boolean;
  badge: string | null;
};

/** Four steps of scale, each visually heavier than the last: small → standard
 *  → popular (accent) → power (deep gradient). The progression is the point;
 *  four identical cards tell the buyer nothing. */
const TIER: { key: string; icon: LucideIcon; wash: string | null; ring: string }[] = [
  { key: "small", icon: Sparkles, wash: null, ring: "" },
  { key: "standard", icon: Package, wash: "radial-gradient(18rem 10rem at 50% -20%, rgb(var(--violet) / 0.16), transparent 72%)", ring: "" },
  {
    key: "popular", icon: Rocket,
    wash: "linear-gradient(165deg, rgb(var(--accent) / 0.20), rgb(var(--violet) / 0.08) 60%, transparent)",
    ring: "ring-2 ring-[rgb(var(--accent)/0.55)] shadow-[0_24px_54px_-30px_rgb(var(--accent)/0.8)]",
  },
  {
    key: "power", icon: Flame,
    wash: "linear-gradient(165deg, rgb(var(--purple) / 0.24), rgb(var(--accent) / 0.10) 62%, transparent)",
    ring: "ring-1 ring-[rgb(var(--purple)/0.5)]",
  },
];

export function CreditPacks({ packs }: { packs: CreditPack[] }) {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

  return (
    <div className="grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
      {packs.map((p, i) => {
        const tier = TIER[Math.min(i, TIER.length - 1)];
        const Icon = tier.icon;
        const total = p.credits + p.bonusCredits;
        const perCredit = (p.priceCents / 100 / total).toFixed(2);
        return (
          <article key={p.id} className={cn("panel relative flex flex-col overflow-hidden rounded-2xl p-5", tier.ring)}>
            {tier.wash && <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: tier.wash }} />}

            <div className="relative flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{t(`packs.tier.${tier.key}`)}</p>
              <span aria-hidden className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                tier.key === "popular" ? "bg-[rgb(var(--accent)/0.2)] text-accent"
                  : tier.key === "power" ? "bg-[rgb(var(--purple)/0.2)] text-[rgb(var(--purple))]"
                    : "bg-raised text-muted",
              )}>
                <Icon size={15} />
              </span>
            </div>

            <p className="relative mt-3 text-sm font-semibold">{p.name}</p>

            <p className="relative mt-2 flex items-center gap-2 font-display text-[2.1rem] font-semibold leading-none tracking-tight text-accent">
              <Diamond size={13} />
              {n(p.credits)}
            </p>
            {p.bonusCredits > 0 && (
              <p className="relative mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded-full bg-[rgb(var(--success)/0.14)] px-2 py-0.5 font-semibold text-success">
                  {t("packs.bonus", { n: n(p.bonusCredits) })}
                </span>
                <span className="text-faint">{t("packs.total", { n: n(total) })}</span>
              </p>
            )}

            <div className="relative mt-4 rounded-xl bg-[rgb(var(--ink)/0.05)] p-3">
              <p className="font-display text-lg font-semibold tracking-tight">{money(p.priceCents, p.currency)}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-faint">
                <Check size={11} aria-hidden strokeWidth={3} className="text-success" />
                {t("packs.perCredit", { n: perCredit })}
              </p>
            </div>

            <div className="relative mt-auto pt-4">
              <button disabled className={cn(
                "h-11 w-full rounded-xl text-sm font-semibold opacity-60",
                tier.key === "popular" ? "cta" : "border border-line text-muted",
              )}>
                {t("packs.buy")}
              </button>
              <p className="mt-1.5 text-center text-[11px] text-faint">{t("packs.soon")}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
