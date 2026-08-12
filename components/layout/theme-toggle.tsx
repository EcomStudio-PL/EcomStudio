"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

/** Icon-only light/dark toggle. "System" is intentionally not offered —
 *  the product supports exactly two themes; resolvedTheme maps any legacy
 *  "system" preference to whichever theme is currently active. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-11 w-11 lg:h-9 lg:w-9" />;
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label={t("settings.theme")}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="flex h-11 w-11 items-center justify-center rounded-xl lg:h-9 lg:w-9 text-muted transition-colors hover:bg-raised hover:text-ink"
    >
      {dark ? <Sun aria-hidden size={17} /> : <Moon aria-hidden size={17} />}
    </button>
  );
}
