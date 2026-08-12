import { cn } from "@/lib/utils";

/** Compact metric card: fits a 2-column grid on a 375px screen without
 *  turning the dashboard into a wall of oversized tiles. */
export function Stat({ label, value, hint, accent }: {
  label: string; value: string | number; hint?: string; accent?: boolean;
}) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-0.5 font-display text-xl font-semibold tracking-tight sm:text-2xl", accent && "text-accent")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
