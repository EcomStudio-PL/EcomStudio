"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
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
 *
 * TWO SHAPES, ONE SWITCHER. `flagsOnly` renders the popover as a row of three
 * flags instead of a list of names — the form the mobile drawer's bottom bar
 * asks for, where a 200px-wide list of native language names would be the
 * biggest thing in the menu. It is a different PRESENTATION of the same
 * control: same state, same server action, same `ecs_locale` cookie. The
 * accessible name stays the language's own name in both shapes, because a flag
 * is a picture and a screen reader cannot read a picture.
 *
 * `side="top"` opens it upwards, for the same reason — in a bottom bar there
 * is nothing below to open into.
 */
export function LocaleSwitcher({ align = "right", side = "bottom", flagsOnly = false, size = "sm", pill = false }: {
  align?: "right" | "left";
  side?: "top" | "bottom";
  flagsOnly?: boolean;
  /** `md` is the 44px touch form, matching the drawer's bottom bar. */
  size?: "sm" | "md";
  /**
   * Flag + language code + caret in a bordered pill, for a row where the
   * control has to look pressable next to a segmented toggle. Still compact:
   * "PL" rather than "Polski", so it cannot grow to half the width of a phone.
   */
  pill?: boolean;
}) {
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
        className={cn(
          "flex shrink-0 items-center transition-colors duration-200 hover:bg-raised disabled:opacity-60",
          pill
            ? "h-11 gap-2 rounded-2xl border border-[rgb(var(--line)/0.14)] bg-[rgb(var(--ink)/0.04)] px-3"
            : "justify-center rounded-xl",
          // In a bar of controls the flag needs the same frame as its
          // neighbours, or it reads as a picture that fell into the row.
          !pill && (size === "md"
            ? "h-11 w-11 border border-line bg-[rgb(var(--ink)/0.04)]"
            : "h-10 w-10 lg:h-9 lg:w-9"),
        )}
      >
        <Flag code={locale} size={size === "md" || pill ? 22 : 20} />
        {pill && (
          <>
            <span className="text-[12.5px] font-semibold uppercase leading-none tracking-wide text-ink">{locale}</span>
            <ChevronDown size={14} aria-hidden className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
          </>
        )}
      </button>
      {open && (
        <div role="menu" className={cn(
          "overlay animate-pop absolute z-50 rounded-2xl p-1.5",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "left" ? "left-0" : "right-0",
          flagsOnly ? "flex gap-1" : "w-48",
        )}>
          {LOCALES.map((l) => (
            <button
              key={l}
              role="menuitem"
              type="button"
              aria-label={NAMES[l] ?? l.toUpperCase()}
              title={NAMES[l] ?? l.toUpperCase()}
              onClick={() => { setOpen(false); start(() => setLocaleAction(l)); }}
              className={cn(
                "flex items-center transition-colors duration-200",
                flagsOnly
                  ? cn(
                      "h-10 w-10 shrink-0 justify-center rounded-xl",
                      l === locale
                        ? "bg-accent-soft ring-1 ring-[rgb(var(--accent)/0.45)]"
                        : "hover:bg-raised",
                    )
                  : cn(
                      "min-h-[42px] w-full gap-2.5 rounded-xl px-3 text-left text-sm hover:bg-raised",
                      l === locale ? "font-semibold text-ink" : "text-muted",
                    ),
              )}
            >
              <Flag code={l} size={flagsOnly ? 22 : 20} />
              {!flagsOnly && (NAMES[l] ?? l.toUpperCase())}
              {!flagsOnly && l === locale && (
                <Check size={15} aria-hidden className="ml-auto text-accent" strokeWidth={3} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
