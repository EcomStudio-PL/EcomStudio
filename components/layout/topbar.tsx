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

/** Compact customer toolbar: [hamburger][logo] … [credits][flag][theme][avatar].
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
          <span className="hidden truncate rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-muted lg:inline-flex">
            {workspace}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-1.5">
        <div className="hidden lg:block"><CommandPalette isAdmin={isAdmin} /></div>
        <Link href="/credits"
          className="brand-gradient inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
          <span aria-hidden>◆</span>
          {new Intl.NumberFormat("pl-PL").format(credits)}
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
          className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-xs font-semibold ring-1 ring-line transition-shadow hover:ring-accent/50 lg:hidden"
        >
          {initial}
        </button>
        <Link
          href="/settings"
          aria-label={t("nav.settings")}
          className="hidden h-9 w-9 items-center justify-center rounded-full bg-raised text-xs font-semibold ring-1 ring-line transition-shadow hover:ring-accent/50 lg:flex"
        >
          {initial}
        </Link>
      </div>
      </div>
    </header>
  );
}
