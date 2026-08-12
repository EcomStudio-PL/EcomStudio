"use client";
import { cn } from "@/lib/utils";

export type SegmentOption = {
  value: string;
  label: string;
  /** Small suffix shown under/after the label — a price, a hint. */
  meta?: string;
  disabled?: boolean;
};

/**
 * SEGMENTED CONTROL — one choice out of a few, presented as a single inset
 * track with a lifted selected segment. Replaces rows of independent
 * bordered buttons, which read as five separate decisions instead of one.
 * Buttons stay real buttons with aria-pressed, so nothing about the existing
 * behaviour changes.
 */
export function Segmented({ options, value, onChange, label, className, size = "md" }: {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex w-full items-stretch gap-1 rounded-xl bg-sunken/80 p-1",
        "border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))]",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-w-0 flex-1 basis-0 rounded-lg text-center font-semibold transition-all duration-150",
              size === "sm" ? "px-2 py-1.5 text-[11px]" : "px-2.5 py-2 text-xs",
              active
                ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]"
                : "text-muted hover:bg-surface/50 hover:text-ink",
              o.disabled && "cursor-not-allowed opacity-40"
            )}
          >
            <span className="block truncate">{o.label}</span>
            {o.meta && (
              <span className={cn("mt-0.5 block truncate text-[10px] font-medium tabular-nums",
                active ? "text-accent" : "text-faint")}>
                {o.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
