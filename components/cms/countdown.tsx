"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A CLOCK THAT TELLS THE TRUTH.
 *
 * The deadline is an absolute instant the admin typed — not a duration that
 * starts when the visitor arrives, and not a number that resets itself when
 * it runs out. Two people opening the page from different timezones see the
 * same moment arrive at the same moment.
 *
 * WHEN IT RUNS OUT IT SAYS SO. `onEnded` lets the section decide: show the
 * "offer closed" line the admin wrote, or take itself off the page. What it
 * never does is loop back to 23:59:59 and pretend.
 *
 * NOTHING IS RENDERED ON THE SERVER. A countdown rendered server-side is
 * wrong by however long the response took, and the correction on hydration
 * is a visible jump. The boxes therefore hold their size and show dashes for
 * exactly one frame, which is not a layout shift and not a lie.
 */

export type Remaining = { days: number; hours: number; minutes: number; seconds: number };

export function remainingUntil(deadline: number, now: number): Remaining | null {
  const ms = deadline - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Countdown({ deadline, labels, compact, onEnded, className }: {
  /** ISO 8601 instant. An unparseable value renders nothing at all. */
  deadline: string;
  /** Localized unit names: [days, hours, minutes, seconds]. */
  labels: [string, string, string, string];
  /** The one-line form for a promo bar. */
  compact?: boolean;
  /** Painted instead of the clock once the deadline has passed. */
  onEnded?: React.ReactNode;
  className?: string;
}) {
  const at = Date.parse(deadline);
  const [left, setLeft] = useState<Remaining | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(at)) return;
    setMounted(true);
    const tick = () => setLeft(remainingUntil(at, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [at]);

  if (!Number.isFinite(at)) return null;
  if (mounted && left === null) return onEnded ? <>{onEnded}</> : null;

  const parts: [number | null, string][] = [
    [left?.days ?? null, labels[0]],
    [left?.hours ?? null, labels[1]],
    [left?.minutes ?? null, labels[2]],
    [left?.seconds ?? null, labels[3]],
  ];

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 font-display tabular-nums", className)}
        data-cms-countdown data-compact>
        {parts.map(([value, label], i) => (
          <span key={label} className="inline-flex items-baseline">
            <span className="font-semibold">{value === null ? "--" : pad(value)}</span>
            <span className="ml-0.5 text-[0.75em] opacity-70">{label.slice(0, 1)}</span>
            {i < parts.length - 1 && <span className="mx-1 opacity-40">:</span>}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-stretch justify-center gap-2 sm:gap-3", className)}
      data-cms-countdown>
      {parts.map(([value, label]) => (
        <div key={label}
          className="min-w-[68px] flex-1 basis-0 rounded-2xl border border-line bg-surface/80 px-2 py-3 text-center shadow-e1 sm:min-w-[84px] sm:px-4 sm:py-4">
          <div className="font-display text-[clamp(1.6rem,5vw,2.5rem)] font-semibold leading-none tabular-nums text-ink">
            {value === null ? "--" : pad(value)}
          </div>
          <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint sm:text-[11px]">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}
