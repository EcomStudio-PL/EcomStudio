import type { HealthCheck } from "@/lib/services/admin-health";
import { Badge } from "@/components/ui/badge";
import { formatWarsaw } from "@/lib/server/event-context";

/**
 * Renders what readSystemHealth() found, and nothing it did not.
 *
 * Three states, three tones, and a timestamp under every one that has one —
 * "połączono" without a date is a claim, "połączono · 12.09, 14:03" is a fact.
 * An unchecked row is grey and says so; it never borrows green.
 */
export function HealthGrid({ checks, labels }: {
  checks: HealthCheck[];
  /** Translated words for the three states plus "never" — the component takes
   *  them as props so it stays a server component with no i18n hook. */
  labels: { ok: string; fail: string; unknown: string; never: string };
}) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {checks.map((check) => (
        <li
          key={check.key}
          className="flex items-center justify-between gap-3 rounded-xl bg-raised px-3.5 py-2.5"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium capitalize text-ink">
              {check.label}
            </span>
            <span className="block truncate text-[11px] text-faint">
              {check.checkedAt ? formatWarsaw(new Date(check.checkedAt)) : labels.never}
              {check.detail ? ` · ${check.detail}` : ""}
            </span>
          </span>
          <Badge
            dot
            tone={check.state === "ok" ? "success" : check.state === "fail" ? "danger" : "neutral"}
          >
            {check.state === "ok" ? labels.ok : check.state === "fail" ? labels.fail : labels.unknown}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
