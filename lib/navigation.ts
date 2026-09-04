import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Package, Sparkles, PenLine, Images, History as HistoryIcon,
  Coins, Rocket, LifeBuoy, Settings, Shield, Users, Building2, Cpu, Plug, Wrench,
  FileText, ScrollText, SlidersHorizontal, Wand2, BarChart3, Layers, Globe,
  FolderOpen, Lightbulb, MessageSquare, BrainCircuit, Home, Megaphone, ListChecks, Mail,
} from "lucide-react";

/** Single source of truth for app navigation. Client drawer, desktop
 *  sidebars, admin drawer and both bottom bars all render from this config,
 *  so future modules (video, marketplace, CRM, messaging) are added here
 *  once — filtered by role where needed, not re-declared per component. */

export type NavItem = {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Short label key for the mobile bottom bar, where one line must fit. */
  shortKey?: string;
};
export type NavGroup = { key: string; items: readonly NavItem[] };

export const CLIENT_NAV: readonly NavGroup[] = [
  { key: "overview", items: [
    { href: "/home", key: "dashboard", icon: LayoutDashboard },
  ]},
  { key: "work", items: [
    { href: "/products", key: "products", icon: Package },
    { href: "/generator", key: "generator", icon: Sparkles },
    { href: "/prompts", key: "prompts", icon: PenLine },
    { href: "/tools", key: "tools", icon: Wrench },
    { href: "/inspirations", key: "inspirations", icon: Lightbulb },
    { href: "/library", key: "library", icon: Images },
    { href: "/library?tab=history", key: "history", icon: HistoryIcon },
  ]},
  { key: "account", items: [
    { href: "/plan", key: "plan", icon: Rocket },
    { href: "/credits", key: "credits", icon: Coins },
    { href: "/settings", key: "settings", icon: Settings },
  ]},
] as const;

/** Bottom bar: Pulpit · Prompty · AI Studio · Biblioteka (+ "Więcej" opens
 *  the drawer). Products stay reachable via the drawer/search — the primary
 *  flow starts at Prompty or AI Studio, no prior product required. */
export const CLIENT_BOTTOM: readonly NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/prompts", key: "prompts", icon: PenLine, shortKey: "promptsShort" },
  { href: "/generator", key: "generator", icon: Sparkles },
  { href: "/library", key: "library", icon: Images },
] as const;

export const ADMIN_NAV: readonly NavGroup[] = [
  { key: "overview", items: [
    { href: "/admin", key: "dashboard", icon: LayoutDashboard },
    { href: "/admin/analytics", key: "analytics", icon: BarChart3 },
  ]},
  { key: "people", items: [
    { href: "/admin/users", key: "users", icon: Users },
    { href: "/admin/workspaces", key: "workspaces", icon: Building2 },
    { href: "/admin/support", key: "support", icon: MessageSquare },
  ]},
  { key: "content", items: [
    { href: "/admin/products", key: "products", icon: Package },
    { href: "/admin/generations", key: "generations", icon: Wand2 },
    { href: "/admin/templates", key: "templates", icon: FileText },
    { href: "/admin/inspirations", key: "inspirations", icon: Lightbulb },
  ]},
  { key: "finance", items: [
    { href: "/admin/credits", key: "credits", icon: Coins },
    { href: "/admin/plans", key: "plans", icon: Rocket },
    { href: "/admin/services", key: "services", icon: Layers },
  ]},
  { key: "ai", items: [
    { href: "/admin/providers", key: "providers", icon: Plug },
    { href: "/admin/models", key: "models", icon: Cpu },
    { href: "/admin/engine", key: "engine", icon: BrainCircuit },
    { href: "/admin/concepts", key: "concepts", icon: PenLine },
    { href: "/admin/tools", key: "tools", icon: Wrench },
  ]},
  { key: "marketing", items: [
    { href: "/admin/homepage", key: "homepage", icon: Home },
    { href: "/admin/www", key: "www", icon: Globe },
    { href: "/admin/launch", key: "launch", icon: Megaphone },
    { href: "/admin/waitlist", key: "waitlist", icon: ListChecks },
    { href: "/admin/media", key: "media", icon: FolderOpen },
  ]},
  { key: "system", items: [
    { href: "/admin/logs", key: "logs", icon: ScrollText },
    { href: "/admin/email", key: "email", icon: Mail },
    { href: "/admin/system", key: "system", icon: SlidersHorizontal },
  ]},
] as const;

/** Four admin destinations for the dock; everything else lives behind
 *  "More", which opens the admin drawer. Labels are the short forms so a
 *  five-slot dock never squeezes them. */
export const ADMIN_BOTTOM: readonly NavItem[] = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard },
  { href: "/admin/users", key: "users", shortKey: "usersShort", icon: Users },
  { href: "/admin/generations", key: "generations", shortKey: "generationsShort", icon: Wand2 },
  { href: "/admin/credits", key: "credits", icon: Coins },
] as const;

export const ADMIN_ICON = Shield;
