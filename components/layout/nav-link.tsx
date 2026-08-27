"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section roots ("/dashboard", "/admin") only highlight on exact match,
 *  otherwise every child route would light them up too. */
const EXACT = new Set(["/dashboard", "/admin"]);

export function NavLink({ href, label, icon: Icon, onNavigate, compact = false, dense = false }: {
  href: string; label: string; icon: LucideIcon; onNavigate?: () => void;
  /** Icon-only rendering for the collapsed desktop rail (label → tooltip). */
  compact?: boolean;
  /** Tighter rows for the desktop rail; the touch drawer keeps 44px. */
  dense?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || (!EXACT.has(href) && pathname.startsWith(href));
  return (
    <Link
      href={href}
      prefetch
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? label : undefined}
      className={cn(
        "group relative flex items-center rounded-xl transition-all duration-150",
        compact
          ? "min-h-[44px] justify-center px-0 py-2 text-sm"
          : dense
            ? "min-h-[32px] gap-2.5 px-2.5 py-1 text-[13px]"
            : "min-h-[44px] gap-3 px-3 py-2.5 text-sm",
        // The active row is a tinted strip with a lit rail, not a filled
        // magenta block: at drawer scale a solid brand fill reads as an
        // error state rather than as "you are here".
        active
          ? "bg-[rgb(var(--accent)/0.10)] font-semibold text-ink"
          : "font-medium text-muted hover:bg-[rgb(var(--ink)/0.05)] hover:text-ink"
      )}
    >
      {/* Active rail: a lit bar on the left edge, the one place the brand
          gradient appears in navigation. */}
      <span aria-hidden className={cn(
        "brand-gradient absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-200",
        active ? "h-6 opacity-100" : "h-2 opacity-0 group-hover:h-4 group-hover:opacity-40"
      )} />
      <span aria-hidden className={cn(
        "flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
        compact ? "h-9 w-9" : dense ? "h-6 w-6" : "h-7 w-7",
        active
          ? "bg-[rgb(var(--accent)/0.18)] text-accent"
          : "text-faint group-hover:text-muted"
      )}>
        <Icon size={compact ? 17 : dense ? 15 : 16} strokeWidth={active ? 2.3 : 2} />
      </span>
      {!compact && <span className="truncate">{label}</span>}
      {/* Collapsed rail: the label becomes a tooltip on hover. */}
      {compact && <span aria-hidden className="rail-tip">{label}</span>}
    </Link>
  );
}
