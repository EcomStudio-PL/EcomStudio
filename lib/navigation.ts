import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Package, Sparkles, PenLine, Images, History as HistoryIcon,
  Coins, Rocket, LifeBuoy, Settings, Shield, Users, Building2, Cpu, Plug,
  FileText, ScrollText, SlidersHorizontal, Wand2,
} from "lucide-react";

/** Single source of truth for app navigation. Client drawer, desktop
 *  sidebars, admin drawer and both bottom bars all render from this config,
 *  so future modules (video, marketplace, CRM, messaging) are added here
 *  once — filtered by role where needed, not re-declared per component. */

export type NavItem = { href: string; key: string; icon: LucideIcon };
export type NavGroup = { key: string; items: readonly NavItem[] };

export const CLIENT_NAV: readonly NavGroup[] = [
  { key: "overview", items: [
    { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  ]},
  { key: "work", items: [
    { href: "/products", key: "products", icon: Package },
    { href: "/generator", key: "generator", icon: Sparkles },
    { href: "/prompts", key: "prompts", icon: PenLine },
    { href: "/library", key: "library", icon: Images },
    { href: "/history", key: "history", icon: HistoryIcon },
  ]},
  { key: "account", items: [
    { href: "/plan", key: "plan", icon: Rocket },
    { href: "/credits", key: "credits", icon: Coins },
    { href: "/settings", key: "settings", icon: Settings },
  ]},
  { key: "help", items: [
    { href: "/support", key: "support", icon: LifeBuoy },
  ]},
] as const;

/** Bottom bar keeps the five most-used destinations; "more" opens the drawer. */
export const CLIENT_BOTTOM: readonly NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/products", key: "products", icon: Package },
  { href: "/generator", key: "generator", icon: Sparkles },
  { href: "/library", key: "library", icon: Images },
] as const;

export const ADMIN_NAV: readonly NavGroup[] = [
  { key: "overview", items: [
    { href: "/admin", key: "dashboard", icon: LayoutDashboard },
  ]},
  { key: "people", items: [
    { href: "/admin/users", key: "users", icon: Users },
    { href: "/admin/workspaces", key: "workspaces", icon: Building2 },
  ]},
  { key: "content", items: [
    { href: "/admin/products", key: "products", icon: Package },
    { href: "/admin/generations", key: "generations", icon: Wand2 },
    { href: "/admin/templates", key: "templates", icon: FileText },
  ]},
  { key: "finance", items: [
    { href: "/admin/credits", key: "credits", icon: Coins },
    { href: "/admin/plans", key: "plans", icon: Rocket },
  ]},
  { key: "ai", items: [
    { href: "/admin/providers", key: "providers", icon: Plug },
    { href: "/admin/models", key: "models", icon: Cpu },
  ]},
  { key: "system", items: [
    { href: "/admin/logs", key: "logs", icon: ScrollText },
    { href: "/admin/system", key: "system", icon: SlidersHorizontal },
  ]},
] as const;

export const ADMIN_BOTTOM: readonly NavItem[] = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard },
  { href: "/admin/users", key: "users", icon: Users },
  { href: "/admin/generations", key: "generations", icon: Wand2 },
  { href: "/admin/credits", key: "credits", icon: Coins },
] as const;

export const ADMIN_ICON = Shield;
