"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * 7 DNI · 30 DNI · WŁASNY ZAKRES.
 *
 * The range lives in the URL rather than in component state, which is what
 * makes a dashboard shareable: an operator can send "look at this week" as a
 * link, and a refresh does not silently reset the question being asked.
 *
 * `resolveRange` — in lib/newsletter.ts, because a Server Component cannot
 * call a function it imported out of a client module — decides the boundaries
 * for the queries, and the caption below these buttons is formatted from that
 * same result.
 *
 * WHICH IS WHY THE EFFECTIVE WINDOW IS PRINTED UNDER THE BUTTONS. There is one
 * state where the selected button and the measured window genuinely differ:
 * "Własny zakres" is chosen but no dates have been picked yet, or they are
 * backwards. The query has to run against something, so it falls back to 30
 * days — and a picker that highlights "custom" while silently reporting the
 * last month is exactly the kind of quiet lie this module exists to avoid.
 * The caption states the real boundaries at all times, so the control can
 * never claim more than the data behind it.
 */
export function RangePicker({ effective }: {
  /** The window actually queried, already formatted by the server that ran the
   *  query. Passed in rather than recomputed here so the caption cannot drift
   *  from the numbers on the same screen. */
  effective: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();

  // Selection follows the URL, not the resolved range: an operator who clicked
  // "Własny zakres" must keep seeing the date fields while they fill them in.
  const current = params.get("range") === "7d" ? "7d"
    : params.get("range") === "custom" ? "custom" : "30d";

  const go = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key); else query.set(key, value);
    }
    router.push(`?${query.toString()}`);
  };

  const btn = (on: boolean) => cn(
    "rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-colors duration-150",
    on ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink",
  );

  return (
    <div data-range-picker className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn(current === "7d")} data-range="7d"
          onClick={() => go({ range: "7d", from: null, to: null })}>
          {t("newsletter.range.7d")}
        </button>
        <button type="button" className={btn(current === "30d")} data-range="30d"
          onClick={() => go({ range: "30d", from: null, to: null })}>
          {t("newsletter.range.30d")}
        </button>
        <button type="button" className={btn(current === "custom")} data-range="custom"
          onClick={() => go({ range: "custom" })}>
          {t("newsletter.range.custom")}
        </button>

        {current === "custom" && (
          // `flex-wrap` and `min-w-0` matter at 320px: two date inputs plus
          // their labels do not fit on one line on a phone, and a date field
          // that overflows takes the whole page sideways with it.
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              {t("newsletter.range.from")}
              <input type="date" defaultValue={params.get("from") ?? ""}
                onChange={(e) => go({ from: e.target.value })}
                className="h-9 min-w-0 rounded-lg border border-line bg-sunken/50 px-2 text-[12.5px] outline-none focus:border-[rgb(var(--accent)/0.5)]" />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              {t("newsletter.range.to")}
              <input type="date" defaultValue={params.get("to") ?? ""}
                onChange={(e) => go({ to: e.target.value })}
                className="h-9 min-w-0 rounded-lg border border-line bg-sunken/50 px-2 text-[12.5px] outline-none focus:border-[rgb(var(--accent)/0.5)]" />
            </label>
          </span>
        )}
      </div>

      <p className="text-[11.5px] text-faint" data-range-effective>{effective}</p>
    </div>
  );
}
