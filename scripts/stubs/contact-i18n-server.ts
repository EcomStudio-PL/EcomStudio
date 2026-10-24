/** Test stub for lib/i18n/server (Kontakt suite): the shipped dictionaries,
 *  no cookies, no editor overrides from a database. */
import pl from "../../lib/i18n/dictionaries/pl.json";
import en from "../../lib/i18n/dictionaries/en.json";
import de from "../../lib/i18n/dictionaries/de.json";

const DICTS = { pl, en, de } as const;
type L = keyof typeof DICTS;

export async function getLocale(): Promise<L> { return "pl"; }
export async function getDictionary() { return { locale: "pl" as const, dict: pl }; }
export async function getDictionaryFor(locale: L) { return DICTS[locale] ?? pl; }
export async function getScopedDictionary() { return { locale: "pl" as const, dict: pl }; }
