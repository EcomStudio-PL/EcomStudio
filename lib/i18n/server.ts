import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import pl from "./dictionaries/pl.json";
import en from "./dictionaries/en.json";
import de from "./dictionaries/de.json";

export type Dictionary = typeof pl;
const dictionaries: Record<Locale, Dictionary> = { pl, en: en as Dictionary, de: de as Dictionary };

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function getDictionary(): Promise<{ locale: Locale; dict: Dictionary }> {
  const locale = await getLocale();
  return { locale, dict: dictionaries[locale] };
}
