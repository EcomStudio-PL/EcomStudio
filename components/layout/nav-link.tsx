"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-accent-soft text-ink shadow-[inset_0_1px_0_rgb(var(--accent)/0.15)]"
          : "text-muted hover:bg-raised hover:text-ink"
      )}
    >
      {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
      <span aria-hidden className={cn("w-5 text-center", active && "text-accent")}>{icon}</span>
      {label}
    </Link>
  );
}
