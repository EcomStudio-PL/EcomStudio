"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";

const GROUPS = [
  { key: "main", items: [
    { href: "/dashboard", key: "dashboard", icon: "▦" },
    { href: "/products", key: "products", icon: "◨" },
  ]},
  { key: "create", items: [
    { href: "/prompts", key: "prompts", icon: "¶" },
    { href: "/generator", key: "generator", icon: "✦" },
  ]},
  { key: "assets", items: [
    { href: "/library", key: "library", icon: "▤" },
    { href: "/history", key: "history", icon: "↺" },
  ]},
  { key: "account", items: [
    { href: "/credits", key: "credits", icon: "◎" },
    { href: "/plan", key: "plan", icon: "▲" },
    { href: "/settings", key: "settings", icon: "⚙" },
  ]},
] as const;

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  return (
    <aside className="glass hidden w-[250px] shrink-0 flex-col rounded-none border-y-0 border-l-0 px-3 py-5 lg:flex">
      <div className="px-3 pb-6"><Brand href="/dashboard" /></div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {GROUPS.map((g) => (
          <div key={g.key} className="mb-2">
            <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
              {t(`nav.groups.${g.key}`)}
            </p>
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} />
            ))}
          </div>
        ))}
        {isAdmin && (
          <div className="mt-auto border-t border-line pt-3">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
              {t("nav.groups.admin")}
            </p>
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
        "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] transition-colors",
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
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <MobileItem href="/dashboard" label={t("nav.dashboard")} icon="▦" />
      <MobileItem href="/products" label={t("nav.products")} icon="◨" />
      <MobileItem href="/generator" label={t("nav.generator")} icon="✦" />
      <MobileItem href="/library" label={t("nav.library")} icon="▤" />
      <MobileItem href="/settings" label={t("nav.more")} icon="⋯" />
      {isAdmin && <MobileItem href="/admin" label="Admin" icon="⛭" />}
    </nav>
  );
}
