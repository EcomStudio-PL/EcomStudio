"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { rolePresentation } from "@/lib/roles";
import { ADMIN_BOTTOM } from "@/lib/navigation";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";

export type AdminShellStats = {
  users: number;
  usersToday: number;
  revenueTodayCents: number;
  revenue30dCents: number;
};

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(cents / 100);

/** Admin chrome: unified topbar (role badge, flag/theme, avatar), mobile
 *  slide-out drawer with role, identity, REAL business KPIs (from the
 *  payments table — 0 until a PSP is connected, never faked) and the full
 *  grouped admin nav, plus a compact bottom bar. */
export function AdminShell({ name, email, role, stats }: {
  name: string; email?: string; role: string; stats: AdminShellStats;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const rp = rolePresentation(role);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  const roleBadge = (
    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", rp.badgeClass)}>
      {t(rp.labelKey)}
    </span>
  );

  return (
    <>
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-2 rounded-none border-x-0 border-t-0 px-3 pt-[env(safe-area-inset-top)] sm:px-4 lg:px-8">
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
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("admin.title")}>
          <div className="animate-fade absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="overlay animate-drawer absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col rounded-none border-y-0 border-l-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between px-5">
              <div className="flex items-center gap-2">
                <Brand href="/admin" markOnly />
                {roleBadge}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <X aria-hidden size={18} />
              </button>
            </div>

            <div className="mx-4 mt-4 rounded-2xl bg-raised p-4">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent2-soft text-sm font-bold text-accent2">
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  {email && <p className="truncate text-xs text-muted">{email}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-surface px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpiClients")}</p>
                  <p className="font-display text-sm font-semibold">{stats.users}</p>
                  <p className="text-[10px] text-accent">+{stats.usersToday} {t("admin.kpiToday").toLowerCase()}</p>
                </div>
                <div className="rounded-xl bg-surface px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpiToday")}</p>
                  <p className="font-display text-sm font-semibold text-accent2">{pln(stats.revenueTodayCents)}</p>
                </div>
                <div className="rounded-xl bg-surface px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpi30d")}</p>
                  <p className="font-display text-sm font-semibold text-accent2">{pln(stats.revenue30dCents)}</p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto px-3">
              <AdminNav onNavigate={() => setOpen(false)} />
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
