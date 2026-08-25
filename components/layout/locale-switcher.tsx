"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { setLocaleAction } from "@/app/actions/settings";
import { LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { Flag } from "./flag";

const NAMES: Record<string, string> = { pl: "Polski", en: "English", de: "Deutsch" };

/**
 * LANGUAGE — the trigger is the flag and nothing else: no "PL" label, no
 * caret. The popover lists every language as flag + native name with a
 * checkmark on the active one.
 */
export function LocaleSwitcher({ align = "right" }: { align?: "right" | "left" }) {
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
        title={NAMES[locale] ?? locale}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-200 hover:bg-raised disabled:opacity-60 lg:h-9 lg:w-9"
      >
        <Flag code={locale} size={20} />
      </button>
      {open && (
        <div role="menu" className={cn(
          "overlay animate-pop absolute top-full z-50 mt-2 w-48 rounded-2xl p-1.5",
          align === "left" ? "left-0" : "right-0",
        )}>
          {LOCALES.map((l) => (
            <button
              key={l}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); start(() => setLocaleAction(l)); }}
              className={cn(
                "flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm transition-colors duration-200 hover:bg-raised",
                l === locale ? "font-semibold text-ink" : "text-muted",
              )}
            >
              <Flag code={l} size={20} />
              {NAMES[l] ?? l.toUpperCase()}
              {l === locale && <Check size={15} aria-hidden className="ml-auto text-accent" strokeWidth={3} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
