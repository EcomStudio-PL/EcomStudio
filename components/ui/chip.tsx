"use client";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * CHIP — the app's pill vocabulary in one place: filters, product pickers,
 * category selectors. Selected chips carry the brand gradient; unselected
 * ones stay on the inset plane so a row of them reads as a track of options
 * rather than a row of buttons competing with the page CTA.
 */
export function Chip({ active, children, icon: Icon, count, className, ...props }: {
  active?: boolean;
  icon?: LucideIcon;
  count?: number;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-[40px] max-w-[16rem] shrink-0 items-center gap-1.5 rounded-full px-4 py-2",
        "text-[13px] font-semibold transition-all duration-150",
        active
          ? "cta"
          : "plate text-muted hover:border-[rgb(var(--accent)/0.35)] hover:text-ink",
        className
      )}
      {...props}
    >
      {Icon && <Icon size={13} aria-hidden className="shrink-0" />}
      <span className="truncate">{children}</span>
      {typeof count === "number" && (
        <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-white/20" : "bg-[rgb(var(--faint)/0.18)]")}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Horizontally scrollable chip row — the mobile-first filter pattern.
 *  Never wraps into three ragged lines on a phone. */
export function ChipRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <div className="flex w-max min-w-full items-center gap-2 pb-0.5 sm:w-auto sm:flex-wrap">
        {children}
      </div>
    </div>
  );
}
