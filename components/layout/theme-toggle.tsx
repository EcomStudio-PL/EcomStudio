"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-24" />;
  return (
    <select
      aria-label={t("settings.theme")}
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
    >
      <option value="light">{t("settings.themes.light")}</option>
      <option value="dark">{t("settings.themes.dark")}</option>
      <option value="system">{t("settings.themes.system")}</option>
    </select>
  );
}
