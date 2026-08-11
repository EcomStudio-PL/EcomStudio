"use client";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { setLocaleAction } from "@/app/actions/settings";
import { LOCALES } from "@/lib/i18n/config";

export function LocaleSwitcher() {
  const { locale } = useI18n();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Language"
      value={locale}
      disabled={pending}
      onChange={(e) => start(() => setLocaleAction(e.target.value))}
      className="h-8 rounded-lg border border-line bg-surface px-2 text-xs uppercase text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>{l.toUpperCase()}</option>
      ))}
    </select>
  );
}
