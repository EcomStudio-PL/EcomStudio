"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section roots ("/dashboard", "/admin") only highlight on exact match,
 *  otherwise every child route would light them up too. */
const EXACT = new Set(["/dashboard", "/admin"]);

export function NavLink({ href, label, icon: Icon, onNavigate, compact = false }: {
  href: string; label: string; icon: LucideIcon; onNavigate?: () => void;
  /** Icon-only rendering for the collapsed desktop rail (label → tooltip). */
  compact?: boolean;
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
      title={compact ? label : undefined}
      className={cn(
        "group relative flex min-h-[44px] items-center rounded-xl py-2.5 text-sm transition-all duration-150",
        compact ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-[linear-gradient(90deg,rgb(var(--accent)/0.18),rgb(var(--accent)/0.04))] font-semibold text-ink shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]"
          : "font-medium text-muted hover:bg-[rgb(var(--accent)/0.08)] hover:text-ink"
      )}
    >
      {/* Active rail: a lit bar on the left edge, the one place the brand
          gradient appears in navigation. */}
      <span aria-hidden className={cn(
        "brand-gradient absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-200",
        active ? "h-6 opacity-100" : "h-2 opacity-0 group-hover:h-4 group-hover:opacity-40"
      )} />
      <span aria-hidden className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
        active ? "bg-[rgb(var(--accent)/0.18)] text-accent" : "text-faint group-hover:text-muted"
      )}>
        <Icon size={16} strokeWidth={active ? 2.3 : 2} />
      </span>
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}
