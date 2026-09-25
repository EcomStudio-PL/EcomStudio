"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LayoutDashboard, Tags, UserCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** GrovNews' own four places, under the newsletter's navigation. One
 *  scrollable row at every width — four short labels fit a phone. */
const TABS = [
  { href: "/admin/newsletter/grovnews", key: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/newsletter/grovnews/wpisy", key: "posts", icon: FileText },
  { href: "/admin/newsletter/grovnews/kategorie", key: "categories", icon: Tags },
  { href: "/admin/newsletter/grovnews/subskrybenci", key: "subscribers", icon: UserCheck },
] as const;

export function GrovNewsAdminNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav aria-label="GrovNews" data-grovnews-admin-nav
      className="thin-scroll -mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map((tab) => {
        const on = "exact" in tab && tab.exact ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[12.5px] font-semibold transition-colors",
              on ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink",
            )}>
            <tab.icon size={14} aria-hidden />
            {t(`grovnewsAdm.nav.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
