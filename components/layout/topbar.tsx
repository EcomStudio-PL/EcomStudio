"use client";
import Link from "next/link";
import { Menu, Plus, Shield } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { creditLevel } from "@/lib/credit-level";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { Brand } from "./brand";
import { CommandPalette } from "./command-palette";
import { useDrawer } from "./shell-context";
import { NotificationsBell, type NotificationItem } from "./notifications-bell";

/** Customer toolbar: [hamburger][logo] [search ⌘K] … [credits][bell][flag][theme][avatar].
 *  Search sits on the LEFT like a proper workbench top bar; the credit pill
 *  carries the traffic-light state from the UX spec (brand → orange → red,
 *  and a "buy credits" CTA at zero) so the wallet warns before it blocks.
 *  The avatar opens the unified drawer on mobile and links to settings on
 *  desktop — there is deliberately NO second dropdown menu. */
export function Topbar({ name, credits, workspace, isAdmin = false, notifications = [], unread = 0 }: {
  name: string; credits: number; workspace?: string; isAdmin?: boolean;
  notifications?: NotificationItem[]; unread?: number;
}) {
  const { t, locale } = useI18n();
  const { setOpen } = useDrawer();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const level = creditLevel(credits);
  const pillClass = {
    ok: "cta",
    low: "bg-[rgb(var(--warning)/0.15)] text-warning ring-1 ring-[rgb(var(--warning)/0.4)]",
    critical: "bg-[rgb(var(--danger)/0.15)] text-danger ring-1 ring-[rgb(var(--danger)/0.4)]",
    empty: "bg-[rgb(var(--danger)/0.15)] text-danger ring-1 ring-[rgb(var(--danger)/0.45)]",
  }[level];
  const pillTitle = level === "critical" ? t("creditsPanel.low")
    : level === "empty" ? t("creditsPanel.buy")
    : t("nav.credits");
  return (
    // Single safe-area source: padding on the header; fixed 60px content row.
    <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
      {/* Same measure as <main>, so the search field and the avatar line up
          with the content columns instead of hugging the viewport edges. */}
      <div className="mx-auto flex h-[58px] w-full max-w-[var(--content-max)] items-center justify-between gap-2 px-3 sm:px-4 lg:px-6 xl:px-7">
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
          <div className="hidden lg:block"><CommandPalette isAdmin={isAdmin} wide /></div>
          {workspace && (
            <span className="plate hidden max-w-[14rem] truncate rounded-xl px-3 py-1.5 text-xs font-medium text-muted xl:inline-flex">
              {workspace}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Credits: the one persistent piece of account state. Healthy = the
              lit brand pill; running low it turns orange, then red, and at
              zero it names the way out instead of silently failing later. */}
          {/* Wallet pill with an attached "+" — the reference's top-right
              control: balance and top-up as one object. */}
          <div className={cn("inline-flex h-9 items-center rounded-full", pillClass)}>
            <Link
              href="/credits"
              aria-label={pillTitle}
              title={pillTitle}
              className="inline-flex h-full items-center gap-1.5 rounded-l-full pl-2.5 pr-2.5 text-[13px] font-bold"
            >
              <span aria-hidden className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                level === "ok" && "bg-white/20",
                level === "low" && "bg-[rgb(var(--warning)/0.2)]",
                (level === "critical" || level === "empty") && "bg-[rgb(var(--danger)/0.2)]",
              )}>◆</span>
              <span className="tabular-nums">{new Intl.NumberFormat(locale).format(credits)}</span>
            </Link>
            <Link
              href="/credits"
              aria-label={t("creditsPanel.buy")}
              title={t("creditsPanel.buy")}
              className={cn(
                "flex h-full w-8 items-center justify-center rounded-r-full border-l transition-colors",
                level === "ok"
                  ? "border-white/25 hover:bg-white/15"
                  : "border-current/25 hover:bg-current/10",
              )}
            >
              <Plus size={14} aria-hidden strokeWidth={2.6} />
            </Link>
          </div>
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
            className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-e2 ring-1 ring-white/15 transition-shadow hover:ring-white/30 lg:hidden"
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
