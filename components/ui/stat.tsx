import { cn } from "@/lib/utils";

/** Compact metric card: fits a 2-column grid on a 375px screen without
 *  turning the dashboard into a wall of oversized tiles. */
export function Stat({ label, value, hint, accent, accent2 }: {
  label: string; value: string | number; hint?: string; accent?: boolean; accent2?: boolean;
}) {
  return (
    <div className="glass rounded-2xl px-4 py-3 transition-transform duration-150 hover:-translate-y-0.5">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-0.5 truncate font-display text-xl font-semibold tracking-tight sm:text-2xl", accent && "text-accent", accent2 && "text-accent2")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-accent">{hint}</p>}
    </div>
  );
}
