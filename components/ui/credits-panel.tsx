"use client";
import Link from "next/link";
import { ArrowUpRight, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { cn } from "@/lib/utils";

/**
 * TWOJE KREDYTY — the wallet card in a generator's right rail: the balance
 * as the hero number over a neon wash, the traffic-light meter from the UX
 * spec, and the plan with its upgrade path. At zero the top-up link becomes
 * the card's primary action instead of a silent dead end.
 */
export function CreditsPanel({ credits, plan, className }: {
  credits: number;
  plan?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const level = creditLevel(credits);
  return (
    <div className={cn("panel relative overflow-hidden rounded-2xl", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-14 h-44 w-64"
        style={{ background: "radial-gradient(16rem 10rem at 70% 30%, rgb(var(--accent) / 0.30), transparent 70%)" }}
      />
      <svg aria-hidden viewBox="0 0 120 60" className="pointer-events-none absolute -bottom-1 right-2 h-16 w-32 opacity-70">
        <defs>
          <linearGradient id="cp-wave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgb(201 0 207)" stopOpacity="0" />
            <stop offset="0.5" stopColor="rgb(var(--accent))" />
            <stop offset="1" stopColor="rgb(255 61 218)" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <path d="M0 48 C 24 46 30 20 52 24 S 86 52 120 18" fill="none" stroke="url(#cp-wave)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M0 56 C 28 56 38 34 60 36 S 92 58 120 34" fill="none" stroke="url(#cp-wave)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      </svg>

      <div className="relative p-4 sm:p-5">
        <p className="overline">{t("studio.yourCredits")}</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="metric text-[2rem] leading-none text-ink">
              {new Intl.NumberFormat("pl-PL").format(credits)}
            </p>
            <p className="mt-1 text-[11px] font-medium text-faint">{t("creditsPanel.unit")}</p>
          </div>
          <span aria-hidden className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent">
            <Zap size={16} />
          </span>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div
            className={cn("h-full rounded-full transition-all", CREDIT_METER_CLASS[level])}
            style={{ width: `${Math.max(3, Math.min(100, (credits / CREDIT_REFERENCE) * 100))}%` }}
          />
        </div>
        {(level === "critical" || level === "empty") && (
          <p className="mt-2 text-[11px] font-medium text-danger">{t("creditsPanel.low")}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {plan && (
            <span className="min-w-0 truncate text-xs font-semibold text-muted">
              {plan} <span className="font-medium text-faint">· {t("nav.plan")}</span>
            </span>
          )}
          {level === "empty" || level === "critical" ? (
            <Link href="/credits" className="cta inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold">
              {t("creditsPanel.buy")}
            </Link>
          ) : (
            <Link href="/plan" className="inline-flex items-center gap-1 text-xs font-semibold text-accent transition-opacity hover:opacity-75">
              {t("creditsPanel.upgrade")} <ArrowUpRight size={12} aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
