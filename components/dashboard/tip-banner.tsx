"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lightbulb, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * WSKAZÓWKA — the dashboard's single nudge (the UX spec allows exactly one
 * visible at a time, always dismissible, never a modal). Dismissal is
 * remembered per tip id in localStorage so the banner does not nag; a new
 * tip id shows again.
 */
export function TipBanner({ id, text, ctaLabel, ctaHref }: {
  id: string;
  text: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const storageKey = `ecs-tip-${id}`;

  useEffect(() => {
    try { setVisible(localStorage.getItem(storageKey) !== "1"); }
    catch { setVisible(true); }
  }, [storageKey]);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(storageKey, "1"); } catch { /* private mode */ }
  }

  return (
    /* A HINT, not a billboard. The full-bleed magenta gradient version drew
       more attention than the categories it was pointing at, so on a phone it
       is now a quiet tinted card with a text action — the accent survives as
       a tint and an icon rather than as a wall of brand colour. */
    <div className="animate-rise relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.28)] bg-[rgb(var(--accent)/0.07)] px-3 py-2.5 sm:px-4">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent">
        <Lightbulb size={15} />
      </span>
      <div className="min-w-0 flex-1">
        {/* The title is a fixed two-word label: it wraps rather than losing
            half of itself to an ellipsis on a 320px screen. */}
        <p className="text-[12.5px] font-semibold leading-tight text-ink">{t("dashboard.tipTitle")}</p>
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{text}</p>
      </div>
      <Link href={ctaHref}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-accent transition-colors duration-200 hover:bg-[rgb(var(--accent)/0.12)]">
        {ctaLabel}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-faint transition-colors duration-200 hover:bg-raised hover:text-ink"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
