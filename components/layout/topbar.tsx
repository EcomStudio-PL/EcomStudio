"use client";
import Link from "next/link";
import { Menu, Shield } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { Brand } from "./brand";
import { CommandPalette } from "./command-palette";
import { useDrawer } from "./shell-context";
import { NotificationsBell, type NotificationItem } from "./notifications-bell";

/** Compact customer toolbar: [hamburger][logo] … [credits][bell][flag][theme][avatar].
 *  The avatar opens the unified drawer on mobile and links to settings on
 *  desktop — there is deliberately NO second dropdown menu. */
export function Topbar({ name, credits, workspace, isAdmin = false, notifications = [], unread = 0 }: {
  name: string; credits: number; workspace?: string; isAdmin?: boolean;
  notifications?: NotificationItem[]; unread?: number;
}) {
  const { t } = useI18n();
  const { setOpen } = useDrawer();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    // Single safe-area source: padding on the header; fixed 60px content row.
    <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
      <div className="flex h-[60px] items-center justify-between gap-2 px-3 sm:px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("nav.menu")}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
          >
            <Menu aria-hidden size={20} />
          </button>
          <div className="lg:hidden"><Brand href="/dashboard" markOnly /></div>
          {workspace && (
            <span className="plate hidden max-w-[16rem] truncate rounded-lg px-3 py-1.5 text-xs font-medium text-muted lg:inline-flex">
              {workspace}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5">
          <div className="hidden lg:block"><CommandPalette isAdmin={isAdmin} /></div>
          {/* Credits: the one persistent piece of account state, treated as a
              lit pill so it reads as currency rather than as a nav item. */}
          <Link
            href="/credits"
            aria-label={t("nav.credits")}
            className="cta inline-flex h-9 items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-[13px] font-bold"
          >
            <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px]">◆</span>
            <span className="tabular-nums">{new Intl.NumberFormat("pl-PL").format(credits)}</span>
          </Link>
          <NotificationsBell items={notifications} unread={unread} />
          <LocaleSwitcher />
          <ThemeToggle />
          {isAdmin && (
            <Link href="/admin" aria-label={t("nav.admin")}
              className="hidden h-9 w-9 items-center justify-center rounded-xl text-accent2 transition-colors hover:bg-accent2-soft lg:flex">
              <Shield aria-hidden size={17} />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("nav.menu")}
            className="brand-gradient flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 ring-white/15 transition-shadow hover:ring-white/30 lg:hidden"
          >
            {initial}
          </button>
          <Link
            href="/settings"
            aria-label={t("nav.settings")}
            className="brand-gradient hidden h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 ring-white/15 transition-shadow hover:ring-white/30 lg:flex"
          >
            {initial}
          </Link>
        </div>
      </div>
    </header>
  );
}
