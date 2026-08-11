export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatCredits(n: number) {
  return new Intl.NumberFormat("pl-PL").format(n);
}

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(cents / 100);
}

export function formatDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
