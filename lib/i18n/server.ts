import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import { SCOPES, type Scope } from "./scopes";
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

/**
 * The slice of the dictionary a layout hands to the CLIENT.
 *
 * getDictionary() stays whole and is what server components translate with —
 * a server render resolves its strings and ships the result, never the source.
 * A client provider is different: every namespace it receives is serialised
 * into the HTML of every page under it. The root layout used to pass the lot,
 * so a visitor on the landing page downloaded all 87 namespaces, the newsletter
 * builder's and the CRM's among them.
 *
 * `scope` picks only what that surface renders. The lists are derived from the
 * import graph and re-checked by scripts/i18n-scope-tests.ts, because a missing
 * namespace does not throw — it quietly prints a humanised key instead of
 * Polish.
 */
export async function getScopedDictionary(scope: Scope): Promise<{ locale: Locale; dict: Record<string, unknown> }> {
  const { locale, dict } = await getDictionary();
  const source = dict as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const ns of SCOPES[scope]) {
    if (Object.hasOwn(source, ns)) out[ns] = source[ns];
  }
  return { locale, dict: out };
}
