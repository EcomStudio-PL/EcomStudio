"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Image as ImageIcon, Layers, Settings2, Signpost } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE CMS'S OWN NAVIGATION.
 *
 * Five places, one row, and the list of PAGES is the first of them because it
 * is the one opened nine times out of ten. Before this, global settings were
 * a full form sitting on top of that list — the least-used thing on the
 * screen taking the most space on it, and pushing the pages below the fold on
 * a phone.
 *
 * A row of links rather than a sidebar: a second permanent column on a 390px
 * screen is a column nobody can afford.
 */

const TABS = [
  { href: "/admin/www", key: "pages", icon: FileText, exact: true },
  { href: "/admin/media", key: "media", icon: ImageIcon, exact: false },
  { href: "/admin/www/sekcje-globalne", key: "global", icon: Layers, exact: false },
  { href: "/admin/www/przekierowania", key: "redirects", icon: Signpost, exact: false },
  { href: "/admin/www/ustawienia-globalne", key: "settings", icon: Settings2, exact: false },
] as const;

export function CmsNav() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <nav aria-label={t("cms.pagesTitle")} data-cms-nav
      className="thin-scroll mb-4 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map((tab) => {
        const on = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} data-cms-tab={tab.key}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-colors duration-150",
              on ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink",
            )}>
            <tab.icon size={14} aria-hidden />
            {t(`cms.nav.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
