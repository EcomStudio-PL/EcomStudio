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
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Reserve the pill's own size before mount, so the bar does not jump.
  if (!mounted) return <div className="h-9 w-[62px]" />;
  const dark = resolvedTheme === "dark";

  return (
    <div role="group" aria-label={t("settings.theme")}
      className="inline-flex h-9 shrink-0 items-center rounded-full border border-line bg-sunken/50 p-0.5">
      {([["dark", Moon], ["light", Sun]] as const).map(([mode, Icon]) => {
        const active = mode === (dark ? "dark" : "light");
        return (
          <button key={mode} type="button"
            aria-pressed={active}
            aria-label={t(`settings.theme.${mode}`)}
            title={t(`settings.theme.${mode}`)}
            onClick={() => setTheme(mode)}
            className={cn(
              "flex h-8 w-[30px] items-center justify-center rounded-full transition-colors duration-200",
              active ? "bg-raised text-ink shadow-e1" : "text-faint hover:text-ink",
            )}>
            <Icon aria-hidden size={15} />
          </button>
        );
      })}
    </div>
  );
}
