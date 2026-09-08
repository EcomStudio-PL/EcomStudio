export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatCredits(n: number) {
  return new Intl.NumberFormat("pl-PL").format(n);
}

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(cents / 100);
}

/** Byte sizes for humans: 812 kB, 3.4 MB. Locale-independent on purpose —
 *  a file size reads the same in every language the app speaks. */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

const intlLocale = (locale: string) =>
  locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB";

/**
 * A moment the business cares about, in the zone the business lives in.
 *
 * The database stores UTC; a deadline read on a Vercel server would otherwise
 * render two hours early for everyone in Poland, which for "blocked until
 * 15:30" is not a cosmetic difference.
 */
export function formatInstant(iso: string, locale: string) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw",
  }).format(new Date(iso));
}

/** The same moment where a table cell has no room: "10.09, 15:30". */
export function formatInstantShort(iso: string, locale: string) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Warsaw",
  }).format(new Date(iso));
}
