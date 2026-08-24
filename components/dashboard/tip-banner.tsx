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
    <div className="animate-rise relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.30)] bg-[linear-gradient(100deg,rgb(var(--accent)/0.16),rgb(var(--indigo)/0.10)_60%,transparent)] px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-16 h-40 w-56"
        style={{ background: "radial-gradient(14rem 8rem at 30% 30%, rgb(var(--accent) / 0.22), transparent 70%)" }}
      />
      <div className="relative flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden className="brand-gradient mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow-e2">
          <Lightbulb size={15} />
        </span>
        <p className="min-w-0 text-[13px] leading-relaxed text-ink">
          <span className="mr-1.5 font-semibold">{t("dashboard.tipTitle")}</span>
          <span className="text-muted">{text}</span>
        </p>
      </div>
      <div className="relative flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
        <Link href={ctaHref} className="cta inline-flex h-9 items-center rounded-xl px-4 text-xs font-semibold">
          {ctaLabel}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.close")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
