import { relativeTime } from "@/lib/relative-time";
import { formatDate } from "@/lib/utils";

/**
 * A timestamp an operator can read at a glance, with the exact moment one
 * hover away.
 *
 * Rendered on the server from a stamp the server already holds, so there is no
 * hydration mismatch to guard against and no client clock in the answer. It
 * does mean the phrase ages until the next render — acceptable for a list that
 * is re-fetched on navigation, and the `title` is always exact.
 */
export function RelativeTime({ at, locale, t, className }: {
  /** ISO string, as it comes out of Postgres. */
  at: string;
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  className?: string;
}) {
  const absolute = formatDate(at, locale);
  return (
    <time dateTime={at} title={absolute} className={className}>
      {relativeTime(at, t, () => absolute)}
    </time>
  );
}
