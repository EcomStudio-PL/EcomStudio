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
    /* The reference treats the nudge as a full-width magenta bar with the
       action as a solid light button on the right — not a tinted card. */
    <div className="animate-rise relative flex flex-col gap-3 overflow-hidden rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5
      bg-[linear-gradient(100deg,rgb(var(--accent-strong)),rgb(var(--accent))_46%,rgb(var(--violet))_100%)]
      shadow-[0_16px_40px_-22px_rgb(var(--accent)/0.9),inset_0_1px_0_rgb(255_255_255/0.2)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-16 h-44 w-64"
        style={{ background: "radial-gradient(16rem 9rem at 60% 40%, rgb(255 255 255 / 0.18), transparent 70%)" }}
      />
      <div className="relative flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white ring-1 ring-white/25">
          <Lightbulb size={16} />
        </span>
        <p className="min-w-0 text-[13px] leading-relaxed text-white">
          <span className="block font-semibold">{t("dashboard.tipTitle")}</span>
          <span className="block text-white/80">{text}</span>
        </p>
      </div>
      <div className="relative flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
        <Link href={ctaHref}
          className="inline-flex h-9 items-center rounded-xl bg-white px-4 text-xs font-bold text-[rgb(var(--accent-strong))] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.5)] transition-transform hover:-translate-y-px">
          {ctaLabel}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.close")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
