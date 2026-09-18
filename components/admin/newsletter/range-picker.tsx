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
 * `resolveRange` is exported and used by the SERVER page, so the boundaries
 * the query runs against are the same ones this control claims to have set.
 * A picker whose label and query disagree is worse than no picker.
 */

const DAY = 86_400_000;

export type ResolvedRange = { key: "7d" | "30d" | "custom"; since: string; until: string };

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  now = Date.now(),
): ResolvedRange {
  if (params.range === "custom") {
    const from = Date.parse(params.from ?? "");
    const to = Date.parse(params.to ?? "");
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      // The `to` date is inclusive: somebody picking 1–7 September means the
      // whole of the 7th, not up to its first second.
      return { key: "custom", since: new Date(from).toISOString(), until: new Date(to + DAY - 1).toISOString() };
    }
  }
  const days = params.range === "7d" ? 7 : 30;
  return {
    key: days === 7 ? "7d" : "30d",
    since: new Date(now - days * DAY).toISOString(),
    until: new Date(now).toISOString(),
  };
}

export function RangePicker() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
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
    <div data-range-picker className="flex flex-wrap items-center gap-2">
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
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            {t("newsletter.range.from")}
            <input type="date" defaultValue={params.get("from") ?? ""}
              onChange={(e) => go({ from: e.target.value })}
              className="h-9 rounded-lg border border-line bg-sunken/50 px-2 text-[12.5px] outline-none focus:border-[rgb(var(--accent)/0.5)]" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            {t("newsletter.range.to")}
            <input type="date" defaultValue={params.get("to") ?? ""}
              onChange={(e) => go({ to: e.target.value })}
              className="h-9 rounded-lg border border-line bg-sunken/50 px-2 text-[12.5px] outline-none focus:border-[rgb(var(--accent)/0.5)]" />
          </label>
        </span>
      )}
    </div>
  );
}
