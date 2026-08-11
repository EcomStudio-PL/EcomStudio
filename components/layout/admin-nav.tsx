"use client";
import { useI18n } from "@/lib/i18n/provider";
import { NavLink } from "./nav-link";

const ITEMS = [
  { href: "/admin", key: "dashboard", icon: "▦" },
  { href: "/admin/users", key: "users", icon: "◉" },
  { href: "/admin/workspaces", key: "workspaces", icon: "▣" },
  { href: "/admin/products", key: "products", icon: "◨" },
  { href: "/admin/generations", key: "generations", icon: "✦" },
  { href: "/admin/credits", key: "credits", icon: "◎" },
  { href: "/admin/models", key: "models", icon: "⌘" },
  { href: "/admin/plans", key: "plans", icon: "▲" },
  { href: "/admin/logs", key: "logs", icon: "≡" },
  { href: "/admin/system", key: "system", icon: "⚙" },
] as const;

export function AdminNav() {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((i) => (
        <NavLink key={i.href} href={i.href} label={t(`admin.nav.${i.key}`)} icon={i.icon} />
      ))}
    </nav>
  );
}
