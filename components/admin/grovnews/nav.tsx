"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CalendarDays, FileText, Inbox, LayoutDashboard, Rss, Tags, UserCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** GrovNews' own eight places, under the newsletter's navigation, in the
 *  order the work flows: research → posts → editions, then the setup
 *  (sources, categories, subscribers, automation). One row at every width;
 *  on a phone it scrolls sideways INSIDE itself, never the page. */
const TABS = [
  { href: "/admin/newsletter/grovnews", key: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/newsletter/grovnews/research", key: "research", icon: Inbox },
  { href: "/admin/newsletter/grovnews/wpisy", key: "posts", icon: FileText },
  { href: "/admin/newsletter/grovnews/wydania", key: "editions", icon: CalendarDays },
  { href: "/admin/newsletter/grovnews/zrodla", key: "sources", icon: Rss },
  { href: "/admin/newsletter/grovnews/kategorie", key: "categories", icon: Tags },
  { href: "/admin/newsletter/grovnews/subskrybenci", key: "subscribers", icon: UserCheck },
  { href: "/admin/newsletter/grovnews/automatyzacja", key: "automation", icon: Bot },
] as const;

export function GrovNewsAdminNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const scroller = useRef<HTMLElement>(null);

  // Eight tabs do not fit a phone: bring the current one into the row's view
  // (horizontally only — the page itself must not jump).
  useEffect(() => {
    const row = scroller.current;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !active) return;
    const left = active.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    if (left < row.scrollLeft || left + active.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.max(0, left - 16);
    }
  }, [pathname]);

  return (
    <nav ref={scroller} aria-label="GrovNews" data-grovnews-admin-nav
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
