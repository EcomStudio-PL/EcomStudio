/**
 * "5 min temu" — one implementation, used by the dashboard, the CRM and the
 * mailbox.
 *
 * An operator scanning a list of signups or payments is asking "is this fresh?",
 * and `07.09.2026, 14:03` does not answer that without arithmetic. A relative
 * stamp does. The exact moment stays available in a `title` attribute, because
 * "wczoraj" is the wrong answer when somebody is reconciling a payment.
 *
 * Deliberately not `Intl.RelativeTimeFormat`: it renders "5 minut temu" in
 * Polish where the product says "5 min temu", and the thresholds below (a
 * minute of "teraz", days rather than weeks past a week) are a product
 * decision rather than a locale one.
 */

export type RelativeUnit = "now" | "minutes" | "hours" | "yesterday" | "days" | "date";

export type RelativeParts = {
  unit: RelativeUnit;
  /** How many of the unit — 0 for "now", "yesterday" and "date". */
  value: number;
};

/**
 * Which phrase this timestamp deserves, as data. The caller translates, so
 * this function has no opinion about language and can be tested without one.
 *
 * `now` is the reference point, injected rather than read from the clock: a
 * server render and the browser that hydrates it must agree, and a test needs
 * to be able to say what "now" is.
 */
export function relativeParts(when: Date | string, now: Date = new Date()): RelativeParts {
  const then = typeof when === "string" ? new Date(when) : when;
  const ms = now.getTime() - then.getTime();

  // A timestamp in the future is a clock disagreement, not a prediction; it
  // reads as "now" rather than as a negative number of minutes.
  if (!Number.isFinite(ms) || ms < 60_000) return { unit: "now", value: 0 };

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { unit: "minutes", value: minutes };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };

  // Past a day, calendar days rather than 24-hour blocks: 26 hours ago is
  // "wczoraj" and 30 hours ago can be "2 dni", because an operator reads these
  // as dates, not as durations. Inside the first day the hour count stays —
  // "9 godz. temu" is more precise than "wczoraj" and never wrong.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const days = Math.round((startOfToday - startOfThen) / 86_400_000);

  if (days <= 1) return { unit: "yesterday", value: 0 };
  if (days < 7) return { unit: "days", value: days };
  // Past a week the relative form stops helping — "43 dni temu" is worse than
  // a date for every question anyone asks of it.
  return { unit: "date", value: 0 };
}

/** The i18n key for a set of parts, plus the values it interpolates. */
export function relativeKey(parts: RelativeParts): { key: string; values: Record<string, number> } {
  switch (parts.unit) {
    case "now": return { key: "time.now", values: {} };
    case "minutes": return { key: "time.minutes", values: { n: parts.value } };
    case "hours": return { key: "time.hours", values: { n: parts.value } };
    case "yesterday": return { key: "time.yesterday", values: {} };
    case "days": return { key: "time.days", values: { n: parts.value } };
    case "date": return { key: "time.date", values: {} };
  }
}

/**
 * The finished string. `formatDate` is passed in rather than imported so this
 * module stays free of locale plumbing and the caller keeps one date format.
 */
export function relativeTime(
  when: Date | string,
  t: (key: string, values?: Record<string, string | number>) => string,
  formatAbsolute: (iso: string) => string,
  now: Date = new Date(),
): string {
  const parts = relativeParts(when, now);
  if (parts.unit === "date") {
    return formatAbsolute(typeof when === "string" ? when : when.toISOString());
  }
  const { key, values } = relativeKey(parts);
  return t(key, values);
}
