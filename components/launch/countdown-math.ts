/**
 * THE COUNTDOWN'S ARITHMETIC — pure, so the numbers and the words are tested
 * without a browser (scripts/prelaunch-ui-tests.ts).
 *
 * MINUTES, ROUNDED UP. The page promises a day and a time, not a stopwatch:
 * seconds ticking on a pre-launch page read as pressure, and they would make
 * every render differ from the one before it. Rounding UP is what keeps the
 * display honest at the end — with 40 seconds left it still says "1 minute"
 * rather than "0 0 0" over a page that has not launched yet — and the
 * component removes itself the moment the remainder reaches zero.
 */

export type Remaining = { days: number; hours: number; minutes: number };

export function remainingParts(leftMs: number): Remaining {
  const total = Math.max(0, Math.ceil(leftMs / 60_000));
  return {
    days: Math.floor(total / 1440),
    hours: Math.floor((total % 1440) / 60),
    minutes: total % 60,
  };
}

/**
 * Which plural form a number takes, per CLDR: Polish has three for whole
 * numbers ("1 dzień", "2 dni", "5 dni"; "1 godzina", "2 godziny", "5 godzin"),
 * English and German two. The dictionary carries one word per category for
 * every locale — the categories a language never produces simply repeat a
 * form — so the lookup is the same code in all three.
 */
export type PluralCategory = "one" | "few" | "many" | "other";

const RULES = new Map<string, Intl.PluralRules>();

export function pluralCategory(locale: string, n: number): PluralCategory {
  let rules = RULES.get(locale);
  if (!rules) {
    try { rules = new Intl.PluralRules(locale); } catch { rules = new Intl.PluralRules("pl"); }
    RULES.set(locale, rules);
  }
  const cat = rules.select(n);
  return cat === "one" || cat === "few" || cat === "many" ? cat : "other";
}

export type CountdownUnit = "days" | "hours" | "minutes";

/** The dictionary key of a unit's label for this number. */
export const unitKey = (unit: CountdownUnit, locale: string, n: number) =>
  `prelaunchUi.cd.${unit}.${pluralCategory(locale, n)}`;
