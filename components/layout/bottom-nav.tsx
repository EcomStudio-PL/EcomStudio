"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * BOTTOM NAVIGATION — one dock for the customer app and the admin panel.
 *
 * Same height, same icon size, same active indicator, same glass treatment.
 * Only the items differ. Anything that does not fit into four slots lives
 * behind "More", which opens that surface's drawer — never seven squeezed
 * labels.
 */
export function BottomNav({ items, labelFor, moreLabel, onMore, exactRoots = [] }: {
  items: readonly NavItem[];
  labelFor: (item: NavItem) => string;
  moreLabel: string;
  onMore: () => void;
  /** Hrefs that only highlight on an exact match (section roots). */
  exactRoots?: string[];
}) {
  const pathname = usePathname();
  const exact = new Set(exactRoots);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="dock flex items-stretch gap-0.5 rounded-2xl p-1">
        {items.slice(0, 4).map((item) => {
          const active = pathname === item.href || (!exact.has(item.href) && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition-colors duration-200",
                active ? "text-accent" : "text-faint"
              )}
            >
              <span aria-hidden className={cn(
                "flex h-8 w-full max-w-[3.25rem] items-center justify-center rounded-xl transition-all duration-200",
                active
                  ? "bg-[rgb(var(--accent)/0.16)] shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.35)]"
                  : "group-active:bg-[rgb(var(--faint)/0.12)]"
              )}>
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
              </span>
              <span className="w-full truncate text-center leading-tight">{labelFor(item)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className="group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold text-faint transition-colors duration-200"
        >
          <span aria-hidden className="flex h-8 w-full max-w-[3.25rem] items-center justify-center rounded-xl transition-colors group-active:bg-[rgb(var(--faint)/0.12)]">
            <MoreHorizontal size={18} />
          </span>
          <span className="w-full truncate text-center leading-tight">{moreLabel}</span>
        </button>
      </div>
    </nav>
  );
}
