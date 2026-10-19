/**
 * THE LAUNCH PAGE'S VALUE TOKENS — and the rule that a token is never shown.
 *
 * The pre-launch copy names numbers nobody may invent: the launch date, the
 * credits a confirmed signup starts with (X), the credits a confirmed referral
 * earns (Y), the early-access head start and the standard signup credits the
 * offer is compared with. The admin writes them into a sentence as tokens —
 * "Startujemy {date} – zapisz się i odbierz {credits} darmowych kredytów." —
 * and the VALUES live in the private campaign settings, each with its own
 * approval switch.
 *
 * A token whose value is not approved does not render as "{credits}", as an
 * empty gap or as a zero: the WHOLE LINE is dropped, and the copy offers a
 * variant without that token instead (`pickVariant`). That is the only way
 * "never show a raw placeholder" and "never publish an unapproved promise" can
 * both hold for text an admin is free to edit.
 *
 * Pure and dependency-free: the server page, the auth dialog's perks and the
 * tests all resolve lines through this one function.
 */

export const LAUNCH_TOKENS = ["date", "credits", "referral", "hours", "standard"] as const;
export type LaunchToken = (typeof LAUNCH_TOKENS)[number];

/** What each token resolves to. Absent / null = not approved → the line hides. */
export type LaunchTokenValues = Partial<Record<LaunchToken, string | number | null>>;

const TOKEN_RE = /\{(date|credits|referral|hours|standard)\}/g;

/** The tokens a piece of copy uses (deduplicated, in order of appearance). */
export function tokensIn(text: string): LaunchToken[] {
  const out: LaunchToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[1] as LaunchToken;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function present(value: string | number | null | undefined): value is string | number {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return value.trim().length > 0;
}

/**
 * The line with every token replaced, or null when the line is empty or ANY of
 * its tokens has no approved value. Numbers are formatted for the locale
 * ("1 000" in Polish), so a value never reaches the page unformatted.
 */
export function resolveLine(text: string | null | undefined, values: LaunchTokenValues, locale = "pl"): string | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let missing = false;
  const out = text.replace(TOKEN_RE, (_whole, name: string) => {
    const value = values[name as LaunchToken];
    if (!present(value)) { missing = true; return ""; }
    return typeof value === "number" ? formatCount(value, locale) : value.trim();
  });
  return missing ? null : out;
}

/** The first variant that resolves completely, or null when none does. */
export function pickVariant(
  variants: readonly (string | null | undefined)[], values: LaunchTokenValues, locale = "pl",
): string | null {
  for (const text of variants) {
    const line = resolveLine(text, values, locale);
    if (line !== null) return line;
  }
  return null;
}

const NUMBER_LOCALE: Record<string, string> = { pl: "pl-PL", en: "en-GB", de: "de-DE" };

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] ?? "pl-PL", { maximumFractionDigits: 0 })
    .format(Math.round(value));
}

/** The launch instant as the page says it — always in Europe/Warsaw, the
 *  time zone the brief fixes the launch in, whatever the visitor's clock.
 *  The year is shown only when it is not the current Warsaw year, and the
 *  time only when it is not midnight. Null for an unparsable value. */
export function formatLaunchDate(iso: string | null | undefined, locale: string, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const tag = NUMBER_LOCALE[locale] ?? "pl-PL";
  const zone = "Europe/Warsaw";
  const parts = (at: number) => Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const at = parts(ms);
  const sameYear = at.year === parts(now).year;
  const midnight = at.hour === "00" && at.minute === "00";
  return new Intl.DateTimeFormat(tag, {
    timeZone: zone,
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(midnight ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }),
  }).format(new Date(ms));
}
