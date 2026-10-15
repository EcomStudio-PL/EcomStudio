"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Image as ImageIcon, Layers, MousePointerClick, Settings2, Signpost } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE CMS'S OWN NAVIGATION.
 *
 * Six places, one row, and the list of PAGES is the first of them because it
 * is the one opened nine times out of ten. Before this, global settings were
 * a full form sitting on top of that list — the least-used thing on the
 * screen taking the most space on it, and pushing the pages below the fold on
 * a phone.
 *
 * "Edytor wizualny" sits right after the list: every page the inline editor
 * can open (and the ones it cannot), the other way of changing what a page
 * says. It is a tab here, not a second entry in the admin sidebar.
 *
 * A row of links rather than a sidebar: a second permanent column on a 390px
 * screen is a column nobody can afford.
 */

const TABS = [
  { href: "/admin/www", key: "pages", icon: FileText, exact: true },
  // Labelled from the editor's own (admin-only) namespace: the cms namespace
  // ships with every public page, and this label belongs to none of them.
  { href: "/admin/www/edytor", key: "visual", icon: MousePointerClick, exact: false, labelKey: "iceAdmin.nav" },
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
            {"labelKey" in tab ? t(tab.labelKey) : t(`cms.nav.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
