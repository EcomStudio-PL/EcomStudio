"use client";
import { cn } from "@/lib/utils";

/**
 * ACTION BAR — what the tool will do, what it costs, and the button.
 *
 * IT SITS IN THE PAGE, NOT ON TOP OF IT. This used to be `position: fixed`
 * below `lg`, floating above the bottom navigation so the button stayed under
 * a thumb. The cost of that was the whole rest of the screen: on a phone and on
 * a tablet the card rode the scroll, covering the settings it belongs under and
 * the head of the results below it, and there was no way to read the last
 * option in a list because the panel was parked over it.
 *
 * Retusz and the Moda tools never did this — their footer is a plain flow
 * sibling that arrives after the settings card and stays where it was put — and
 * that is now the one shape every tool uses. A seller scrolls to the button
 * once, the same way they scroll to it on a desktop, and nothing is hidden
 * behind anything.
 *
 * The desktop arrangement is unchanged: the settings rail is `lg:sticky`, so on
 * a wide screen this is already in view without needing to float.
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
      data-action-bar
      className={cn(
        "panel relative z-20 shrink-0 rounded-2xl p-3 lg:p-4 lg:shadow-e2",
        className
      )}
    >
      {summary && <div className="mb-2.5 flex items-center justify-between gap-3 text-sm">{summary}</div>}
      {children}
      {note && <div className="mt-2 text-center text-xs">{note}</div>}
    </div>
  );
}
