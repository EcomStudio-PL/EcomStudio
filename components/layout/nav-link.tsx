"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section roots ("/dashboard", "/admin") only highlight on exact match,
 *  otherwise every child route would light them up too. */
const EXACT = new Set(["/dashboard", "/admin"]);

export function NavLink({ href, label, icon: Icon, onNavigate }: {
  href: string; label: string; icon: LucideIcon; onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || (!EXACT.has(href) && pathname.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-gradient-to-r from-accent-soft to-[rgb(var(--accent-soft)/0.35)] text-ink shadow-[inset_0_1px_0_rgb(var(--accent)/0.15)]"
          : "text-muted hover:bg-accent-soft/40 hover:text-ink"
      )}
    >
      {active && <span aria-hidden className="brand-gradient absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full" />}
      <Icon aria-hidden size={17} strokeWidth={2} className={cn("shrink-0", active ? "text-accent" : "text-faint")} />
      {label}
    </Link>
  );
}
