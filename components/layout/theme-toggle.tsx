"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * LIGHT / DARK — a two-position pill, not a lamp that changes shape.
 *
 * The icon-only button showed the theme you would GET, which meant the sun
 * appeared in dark mode and the moon in light mode: correct, and read by
 * roughly half of people as the opposite. The pill shows both, and marks the
 * one you are in — there is nothing left to infer.
 *
 * "System" is deliberately not a third position: the product supports exactly
 * two themes, and `resolvedTheme` maps any legacy "system" preference onto
 * whichever one is actually showing.
 */
export function ThemeToggle({ size = "sm" }: {
  /** `md` is the 44px touch form the mobile drawer's bottom bar uses, so the
   *  theme pill, the flag button and "Wyloguj się" are one height — and that
   *  height is a target a thumb can actually hit. */
  size?: "sm" | "md";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const md = size === "md";
  // Reserve the pill's own size before mount, so the bar does not jump.
  if (!mounted) return <div className={md ? "h-11 w-[76px]" : "h-9 w-[62px]"} />;
  const dark = resolvedTheme === "dark";

  return (
    <div role="group" aria-label={t("settings.theme")}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-line bg-sunken/50 p-0.5",
        md ? "h-11" : "h-9",
      )}>
      {([["dark", Moon], ["light", Sun]] as const).map(([mode, Icon]) => {
        const active = mode === (dark ? "dark" : "light");
        return (
          <button key={mode} type="button"
            aria-pressed={active}
            aria-label={t(`settings.theme.${mode}`)}
            title={t(`settings.theme.${mode}`)}
            onClick={() => setTheme(mode)}
            className={cn(
              "flex items-center justify-center rounded-full transition-colors duration-200",
              md ? "h-10 w-[36px]" : "h-8 w-[30px]",
              active ? "bg-raised text-ink shadow-e1" : "text-faint hover:text-ink",
            )}>
            <Icon aria-hidden size={md ? 16 : 15} />
          </button>
        );
      })}
    </div>
  );
}
