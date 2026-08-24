import { ImageIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EMPTY STATE — a designed destination, not a "no data" apology. The panel
 * carries its own light, the icon sits in a haloed frame, and an optional
 * hint list tells the user what will live here once they start. A screen
 * with nothing in it should still look like somebody built it on purpose.
 */
export function EmptyState({ title, body, action, icon: Icon, hints, className }: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  /** Short "this is what goes here" lines shown under the copy. */
  hints?: string[];
  className?: string;
}) {
  return (
    <div className={cn(
      "panel relative overflow-hidden rounded-2xl px-6 py-14 text-center sm:py-16",
      className
    )}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-56 opacity-70"
        style={{ background: "radial-gradient(28rem 12rem at 50% 0%, rgb(var(--accent) / 0.20), transparent 70%)" }}
      />
      <div className="relative">
        <span aria-hidden className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-accent shadow-e2 ring-1 ring-[rgb(var(--accent)/0.25)]">
          {Icon ? <Icon size={22} /> : <ImageIcon size={22} />}
        </span>
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        {body && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{body}</p>}
        {hints && hints.length > 0 && (
          <ul className="mx-auto mt-5 flex max-w-md flex-wrap justify-center gap-2">
            {hints.map((h) => (
              <li key={h} className="plate rounded-full px-3 py-1.5 text-[11px] font-medium text-muted">
                {h}
              </li>
            ))}
          </ul>
        )}
        {action && <div className="mt-7 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
