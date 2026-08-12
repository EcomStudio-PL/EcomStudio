"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { rolePresentation } from "@/lib/roles";
import { ADMIN_BOTTOM } from "@/lib/navigation";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { DrawerClose } from "./drawer-close";

export type AdminShellStats = {
  users: number;
  usersToday: number;
  revenueTodayCents: number;
  revenue30dCents: number;
};

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(cents / 100);

/** Admin chrome: compact safe-area-aware topbar, slide-out drawer whose
 *  header IS the admin profile (role badge, identity, REAL business KPIs
 *  from the payments table — 0 until a PSP is connected, never faked),
 *  plus a bottom bar. */
export function AdminShell({ name, email, role, stats }: {
  name: string; email?: string; role: string; stats: AdminShellStats;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const pathname = usePathname();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const rp = rolePresentation(role);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); setOpen(false); }, 190);
  }, []);

  useEffect(() => { setClosing(false); setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, close]);

  const roleBadge = (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", rp.badgeClass)}>
      {t(rp.labelKey)}
    </span>
  );

  return (
    <>
      {/* Single safe-area source: padding on the header itself; content row
          has a fixed 60px height so nothing overlaps the status bar. */}
      <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
        <div className="flex h-[60px] items-center justify-between gap-2 px-3 sm:px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t("admin.title")}
              aria-expanded={open}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
            >
              <Menu aria-hidden size={20} />
            </button>
            <div className="lg:hidden"><Brand href="/admin" markOnly /></div>
            {roleBadge}
            <span className="hidden truncate text-sm text-muted lg:inline">{t("admin.title")}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <LocaleSwitcher />
            <ThemeToggle />
            <Link href="/dashboard" aria-label={t("admin.backToApp")}
              className="hidden h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink sm:flex">
              <ArrowLeft aria-hidden size={14} />
              <span className="hidden lg:inline">{t("admin.backToApp")}</span>
            </Link>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t("admin.title")}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent2-soft text-xs font-semibold text-accent2 lg:hidden"
            >
              {initial}
            </button>
            <span aria-hidden className="hidden h-9 w-9 items-center justify-center rounded-full bg-accent2-soft text-xs font-semibold text-accent2 lg:flex">
              {initial}
            </span>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("admin.title")}>
          <div className={cn("absolute inset-0 bg-black/70 backdrop-blur-[2px]", closing ? "animate-fade-out" : "animate-fade")} onClick={close} />
          <div className={cn(
            "overlay absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col rounded-none border-y-0 border-l-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]",
            closing ? "animate-drawer-out" : "animate-drawer"
          )}>
            {/* Admin profile IS the header — full width, role instead of plan */}
            <div className="border-b border-line px-6 pb-5 pt-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent2-soft text-base font-bold text-accent2">
                    {initial}
                  </span>
                  {roleBadge}
                </div>
                <DrawerClose onClick={close} />
              </div>
              <p className="mt-3 truncate text-base font-semibold">{name}</p>
              {email && <p className="truncate text-xs text-muted">{email}</p>}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-raised px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpiClients")}</p>
                  <p className="font-display text-sm font-semibold">{stats.users}</p>
                  <p className="text-[10px] text-accent">+{stats.usersToday} {t("admin.kpiToday").toLowerCase()}</p>
                </div>
                <div className="rounded-xl bg-raised px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpiToday")}</p>
                  <p className="font-display text-sm font-semibold text-accent2">{pln(stats.revenueTodayCents)}</p>
                </div>
                <div className="rounded-xl bg-raised px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpi30d")}</p>
                  <p className="font-display text-sm font-semibold text-accent2">{pln(stats.revenue30dCents)}</p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto px-3">
              <AdminNav onNavigate={close} />
            </div>
            <Link href="/dashboard"
              className="mx-3 mt-2 flex min-h-[44px] items-center gap-2 rounded-xl border-t border-line px-3 pt-2 text-sm text-muted transition-colors hover:text-ink">
              <ArrowLeft aria-hidden size={15} /> {t("admin.backToApp")}
            </Link>
          </div>
        </div>
      )}

      <nav className="glass fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around rounded-none border-x-0 border-b-0 lg:hidden">
        {ADMIN_BOTTOM.map((i) => {
          const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
          const Icon = i.icon;
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] font-medium transition-colors duration-150",
                active ? "text-accent" : "text-muted"
              )}
            >
              <span aria-hidden className={cn(
                "flex h-6 w-10 items-center justify-center rounded-full transition-colors duration-150",
                active && "bg-accent-soft"
              )}><Icon size={17} /></span>
              <span className="truncate">{t(`admin.nav.${i.key}`)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] font-medium text-muted transition-colors duration-150"
        >
          <span aria-hidden className="flex h-6 w-10 items-center justify-center rounded-full text-base leading-none">⋯</span>
          <span className="truncate">{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}
