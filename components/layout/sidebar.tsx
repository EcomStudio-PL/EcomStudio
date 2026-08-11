"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";

const ITEMS = [
  { href: "/dashboard", key: "dashboard", icon: "▦" },
  { href: "/products", key: "products", icon: "◨" },
  { href: "/generator", key: "generator", icon: "✦" },
  { href: "/library", key: "library", icon: "▤" },
  { href: "/prompts", key: "prompts", icon: "¶" },
  { href: "/history", key: "history", icon: "↺" },
  { href: "/credits", key: "credits", icon: "◎" },
  { href: "/plan", key: "plan", icon: "▲" },
  { href: "/settings", key: "settings", icon: "⚙" },
] as const;

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5">
      <div className="px-3 pb-6"><Brand href="/dashboard" /></div>
      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map((i) => (
          <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} />
        ))}
        {isAdmin && (
          <div className="mt-4 border-t border-line pt-4">
            <NavLink href="/admin" label={t("nav.admin")} icon="⛭" />
          </div>
        )}
      </nav>
    </aside>
  );
}

function MobileItem({ href, label, icon }: { href: string; label: string; icon: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px]",
        active ? "text-accent" : "text-muted"
      )}
    >
      <span aria-hidden className="text-base leading-none">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  const items = ITEMS.slice(0, 4);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      {[...items, { href: "/settings", key: "settings", icon: "⚙" } as const].map((i) => (
        <MobileItem key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} />
      ))}
      {isAdmin && <MobileItem href="/admin" label="Admin" icon="⛭" />}
    </nav>
  );
}
