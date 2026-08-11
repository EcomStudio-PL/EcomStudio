"use client";
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import { makeT } from "./t";

type Dict = Record<string, unknown>;
const I18nContext = createContext<{ locale: Locale; dict: Dict }>({ locale: "pl", dict: {} });

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, dict }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { locale, dict } = useContext(I18nContext);
  const t = useMemo(() => makeT(dict), [dict]);
  return { t, locale };
}
