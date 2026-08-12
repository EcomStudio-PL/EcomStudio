"use client";
import { cn } from "@/lib/utils";

/**
 * ACTION BAR — the primary action stays reachable with a thumb.
 *
 * On phones the generate/save action would otherwise sit far below the fold
 * after a long form, so it docks above the bottom navigation as a floating
 * summary: what it will do, what it costs, and the button itself. On desktop
 * it collapses back into the page flow, where the sticky right rail already
 * does this job.
 */
export function ActionBar({ summary, children, className, note }: {
  /** Left-hand summary (cost, credits, selection count). */
  summary?: React.ReactNode;
  children: React.ReactNode;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "dock fixed inset-x-3 bottom-[calc(var(--dock-h)+0.75rem+env(safe-area-inset-bottom))] z-30 rounded-2xl p-3",
        "lg:static lg:inset-auto lg:rounded-2xl lg:p-4 lg:shadow-e2",
        className
      )}
    >
      {summary && <div className="mb-2.5 flex items-center justify-between gap-3 text-sm">{summary}</div>}
      {children}
      {note && <div className="mt-2 text-center text-xs">{note}</div>}
    </div>
  );
}
