import { cn } from "@/lib/utils";

/**
 * PAGE HEADER — the editorial top of every screen: a tracked overline, a
 * large display headline and a single line of purpose, with the page action
 * aligned to the baseline. On phones the action drops to its own row at full
 * width so it stays a comfortable thumb target.
 */
export function PageHeader({ title, sub, action, overline, className }: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  overline?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 sm:mb-7", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          {overline && <p className="overline mb-2">{overline}</p>}
          <h1 className="display-lg">{title}</h1>
          {sub && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{sub}</p>}
        </div>
        {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
      </div>
    </div>
  );
}
