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
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "frame-mark bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink"
      )}
    >
      <span aria-hidden className="w-5 text-center">{icon}</span>
      {label}
    </Link>
  );
}
