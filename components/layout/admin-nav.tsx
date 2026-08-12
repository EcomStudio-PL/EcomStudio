"use client";
import { useI18n } from "@/lib/i18n/provider";
import { NavLink } from "./nav-link";

export const ADMIN_GROUPS = [
  { key: "overview", items: [
    { href: "/admin", key: "dashboard", icon: "▦" },
  ]},
  { key: "people", items: [
    { href: "/admin/users", key: "users", icon: "◉" },
    { href: "/admin/workspaces", key: "workspaces", icon: "▣" },
  ]},
  { key: "content", items: [
    { href: "/admin/products", key: "products", icon: "◨" },
    { href: "/admin/generations", key: "generations", icon: "✦" },
    { href: "/admin/templates", key: "templates", icon: "¶" },
  ]},
  { key: "finance", items: [
    { href: "/admin/credits", key: "credits", icon: "◎" },
    { href: "/admin/plans", key: "plans", icon: "▲" },
  ]},
  { key: "ai", items: [
    { href: "/admin/providers", key: "providers", icon: "⇄" },
    { href: "/admin/models", key: "models", icon: "⌘" },
  ]},
  { key: "system", items: [
    { href: "/admin/logs", key: "logs", icon: "≡" },
    { href: "/admin/system", key: "system", icon: "⚙" },
  ]},
] as const;

export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-0.5">
      {ADMIN_GROUPS.map((g) => (
        <div key={g.key} className="mb-1.5">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            {t(`admin.navGroups.${g.key}`)}
          </p>
          {g.items.map((i) => (
            <NavLink key={i.href} href={i.href} label={t(`admin.nav.${i.key}`)} icon={i.icon} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}
