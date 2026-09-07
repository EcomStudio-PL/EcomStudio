import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Delta, KpiWindow } from "@/lib/services/admin-dashboard";
import { cn } from "@/lib/utils";

/**
 * One business number, and — only when there is an honest one — how it moved.
 *
 * `deltaAgainst` returns null for growth out of zero, so this component never
 * has to decide whether "+100%" is a fair description of the first customer of
 * the week. No delta simply means no line.
 */
export function KpiCard({ label, value, window, hint, emphasis }: {
  label: string;
  value: string;
  window?: KpiWindow;
  /** The comparison's own words, e.g. "vs poprzednie 7 dni". */
  hint?: string;
  /** Money reads louder than counts. */
  emphasis?: boolean;
}) {
  return (
    <div className="panel min-w-0 rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="overline text-[9.5px]">{label}</p>
      <p className={cn(
        "metric mt-1.5 truncate",
        emphasis ? "text-[1.65rem] text-accent2 sm:text-[1.9rem]" : "text-[1.5rem] sm:text-[1.7rem]",
      )}>
        {value}
      </p>
      {window?.delta ? <DeltaLine delta={window.delta} hint={hint} /> : null}
    </div>
  );
}

function DeltaLine({ delta, hint }: { delta: NonNullable<Delta>; hint?: string }) {
  const up = delta.direction === "up";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium">
      <span className={cn(
        "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap",
        up ? "text-success" : "text-danger",
      )}>
        <Icon size={12} aria-hidden />
        {delta.percent}%
      </span>
      {hint && <span className="truncate text-faint">{hint}</span>}
    </p>
  );
}

/**
 * The revenue chart. One chart, not five — an operator reads the shape and the
 * peak, and the exact figure is in the tooltip.
 *
 * Bars rather than a line: the data is daily takings, which is a set of
 * discrete amounts, and a line between two days implies a value at noon that
 * nobody measured.
 */
export function RevenueChart({ data, format, empty }: {
  data: { day: string; revenueCents: number }[];
  format: (cents: number) => string;
  empty: string;
}) {
  const max = Math.max(...data.map((d) => d.revenueCents), 1);
  const total = data.reduce((s, d) => s + d.revenueCents, 0);
  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl bg-raised/40 text-sm text-muted">
        {empty}
      </div>
    );
  }
  // Three dates under the chart rather than a label per bar: at 390px a
  // ninety-day chart has 4px columns, and "09" clipped to "0." is worse than
  // no label at all. The exact day is in each bar's tooltip.
  const dayLabel = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}`;
  const marks = [data[0], data[Math.floor((data.length - 1) / 2)], data[data.length - 1]];
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]">
        {data.map((d) => (
          <div
            key={d.day}
            // Full-height column: a percentage height only means anything
            // against a parent that has one, and `items-end` alone would
            // shrink each column to its content.
            className="group flex h-full min-w-0 flex-1 items-end"
            title={`${dayLabel(d.day)}: ${format(d.revenueCents)}`}
          >
            <div
              className="w-full rounded-sm bg-accent2/70 transition-colors group-hover:bg-accent2"
              style={{ height: `${Math.max((d.revenueCents / max) * 100, 2)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        {marks.map((d, i) => <span key={`${d.day}-${i}`}>{dayLabel(d.day)}</span>)}
      </div>
    </div>
  );
}
