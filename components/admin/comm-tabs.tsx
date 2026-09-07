"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Bell, FileText, Plug2, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * KOMUNIKACJA — one module, four tabs.
 *
 * Everything GrovBase says to somebody used to be four separate menu entries
 * sitting in two different groups: Poczta, Powiadomienia, Szablony wiadomości
 * and Integracje. They are one job — reading what came in, deciding what goes
 * out, writing what it says, and connecting the wire it travels on — so they
 * are one destination with four tabs.
 *
 * Each tab is a real route, not a client-side panel: an operator can bookmark
 * the inbox, the browser back button behaves, and every tab keeps its own
 * server render instead of forcing the heaviest one (the mailbox) to load on
 * every visit.
 */

type Tab = { href: string; key: string; icon: LucideIcon };

export const COMM_TABS: readonly Tab[] = [
  { href: "/admin/communication", key: "inbox", icon: Inbox },
  { href: "/admin/communication/powiadomienia", key: "notifications", icon: Bell },
  { href: "/admin/communication/szablony", key: "templates", icon: FileText },
  { href: "/admin/communication/kanaly", key: "channels", icon: Plug2 },
] as const;

export function CommTabs() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("comm.moduleTitle")}
      // Horizontal scroll rather than a wrap: four tabs stay one line at 360px,
      // and the active one is reachable by swiping instead of by growing the
      // header into two rows.
      className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {COMM_TABS.map((tab) => {
        // Exact match for the inbox, prefix for the rest, so /kanaly does not
        // light the inbox up as well.
        const active = tab.href === "/admin/communication"
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5",
              "text-[13px] font-semibold transition-colors",
              active
                ? "bg-accent2-soft text-accent2 ring-1 ring-[rgb(var(--accent2)/0.30)]"
                : "text-muted hover:bg-raised hover:text-ink"
            )}
          >
            <tab.icon size={15} aria-hidden />
            {t(`comm.tab.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
