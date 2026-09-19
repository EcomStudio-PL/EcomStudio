"use client";
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import { makeT } from "./t";

type Dict = Record<string, unknown>;
const I18nContext = createContext<{ locale: Locale; dict: Dict }>({ locale: "pl", dict: {} });

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, dict }}>{children}</I18nContext.Provider>;
}

/**
 * ADDS namespaces to whatever the layout above already sent.
 *
 * The root layout serialises what the public pages need; the signed-in app and
 * /admin each add their own share from inside their own layout, so a visitor
 * reading the terms of service never downloads the CRM's labels
 * (lib/i18n/scopes.ts). The merge is by namespace — the unit the scopes are
 * built from — and the child wins, so a scope can override as well as extend.
 *
 * Nothing here is a fallback: a namespace that reaches no scope renders through
 * humanizeKey, which is why scripts/i18n-scope-tests.ts re-derives the lists
 * from the import graph instead of trusting anyone to maintain them.
 */
export function I18nScope({ dict, children }: { dict: Dict; children: React.ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo(
    () => ({ locale: parent.locale, dict: { ...parent.dict, ...dict } }),
    [parent.locale, parent.dict, dict],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { locale, dict } = useContext(I18nContext);
  const t = useMemo(() => makeT(dict), [dict]);
  return { t, locale };
}
