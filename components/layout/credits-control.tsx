"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel } from "@/lib/credit-level";
import { cn } from "@/lib/utils";

/**
 * CREDITS — ONE control, not three chips: a diamond, the balance and a "+"
 * that buys more, sharing a single pill, a single border and a single hover
 * state. The tone follows the balance (green → amber → red) so an empty
 * wallet is visible before the user hits a wall.
 */
export function CreditsControl({ credits, compact = false }: { credits: number; compact?: boolean }) {
  const { t, locale } = useI18n();
  const level = creditLevel(credits);
  const tone = {
    ok: "border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.12)] text-success",
    low: "border-[rgb(var(--warning)/0.45)] bg-[rgb(var(--warning)/0.14)] text-warning",
    critical: "border-[rgb(var(--danger)/0.45)] bg-[rgb(var(--danger)/0.14)] text-danger",
    empty: "border-[rgb(var(--danger)/0.55)] bg-[rgb(var(--danger)/0.18)] text-danger",
  }[level];
  const title = level === "critical" || level === "empty" ? t("creditsPanel.low") : t("nav.credits");

  return (
    <div className={cn(
      "inline-flex shrink-0 items-stretch overflow-hidden rounded-full border transition-colors duration-200",
      compact ? "h-8" : "h-9",
      tone,
    )}>
      <Link
        href="/credits"
        title={title}
        aria-label={`${title}: ${credits}`}
        className={cn(
          "inline-flex items-center gap-1.5 font-bold transition-colors duration-200 hover:bg-current/10",
          compact ? "pl-2 pr-1.5 text-[12px]" : "pl-2.5 pr-2 text-[13px]",
        )}
      >
        <Diamond />
        <span className="tabular-nums">{new Intl.NumberFormat(locale).format(credits)}</span>
      </Link>
      <Link
        href="/credits"
        aria-label={t("creditsPanel.buy")}
        title={t("creditsPanel.buy")}
        className={cn(
          "flex items-center justify-center border-l border-current/25 transition-colors duration-200 hover:bg-current/15",
          compact ? "w-7" : "w-8",
        )}
      >
        <Plus size={13} aria-hidden strokeWidth={2.8} />
      </Link>
    </div>
  );
}

/** The credit glyph — a diamond, matching the in-app cost badges. */
export function Diamond({ size = 9 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rotate-45 rounded-[2px] bg-current"
      style={{ width: size, height: size }}
    />
  );
}
