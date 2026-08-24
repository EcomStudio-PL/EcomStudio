"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { setLocaleAction } from "@/app/actions/settings";
import { LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

const FLAGS: Record<string, string> = { pl: "🇵🇱", en: "🇬🇧", de: "🇩🇪" };
const NAMES: Record<string, string> = { pl: "Polski", en: "English", de: "Deutsch" };

/** Flag button with a custom (non-native) dropdown. */
export function LocaleSwitcher() {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("settings.language")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-xl lg:h-9 lg:w-9 text-base transition-colors hover:bg-raised disabled:opacity-60"
      >
        <span aria-hidden>{FLAGS[locale] ?? "🌐"}</span>
      </button>
      {open && (
        <div role="menu" className="overlay animate-pop absolute right-0 top-full z-50 mt-2 w-44 rounded-2xl p-1.5">
          {LOCALES.map((l) => (
            <button
              key={l}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); start(() => setLocaleAction(l)); }}
              className={cn(
                "flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm transition-colors hover:bg-raised",
                l === locale ? "font-semibold text-ink" : "text-muted"
              )}
            >
              <span aria-hidden>{FLAGS[l]}</span>
              {NAMES[l] ?? l.toUpperCase()}
              {l === locale && <span aria-hidden className="ml-auto text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
