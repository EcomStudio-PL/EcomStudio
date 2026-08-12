import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * SECTION HEADER — the editorial device that gives the app its rhythm:
 * a tracked overline, a display-weight title, an optional one-line purpose,
 * and the section's action on the right. Used at page level and inside
 * panels so every block of content announces itself the same way.
 */
export function SectionHeader({ overline, title, sub, action, icon: Icon, className, size = "md" }: {
  overline?: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {overline && (
          <div className="mb-1.5 flex items-center gap-2">
            <span aria-hidden className="accent-rule h-px w-6 rounded-full" />
            <span className="overline">{overline}</span>
          </div>
        )}
        <h2 className={cn(
          "flex min-w-0 items-center gap-2 font-display font-semibold tracking-tight",
          size === "sm" ? "text-[0.95rem]" : "text-lg"
        )}>
          {Icon && <Icon size={size === "sm" ? 15 : 17} className="shrink-0 text-accent" aria-hidden />}
          <span className="truncate">{title}</span>
        </h2>
        {sub && <p className="mt-1 text-sm leading-relaxed text-muted">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Header row bolted to the top of a Panel, with its own hairline. */
export function PanelHeader(props: React.ComponentProps<typeof SectionHeader>) {
  return (
    <div className="border-b border-line px-4 py-3.5 sm:px-5">
      <SectionHeader size="sm" {...props} />
    </div>
  );
}
