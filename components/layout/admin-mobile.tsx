"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";

/** Admin chrome: a topbar shown on every breakpoint (context badge, admin
 *  identity, locale/theme, back-to-app), plus mobile-only slide-out drawer
 *  with the full grouped admin nav and a compact bottom bar. Desktop keeps
 *  the permanent sidebar rendered by the layout. */
export function AdminShell({ name, email }: { name: string; email?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-3 pt-[env(safe-area-inset-top)] sm:px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("admin.title")}
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
          >
            ☰
          </button>
          <div className="lg:hidden"><Brand href="/admin" markOnly /></div>
          <span className="rounded-full bg-accent2-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent2">
            Admin
          </span>
          <span className="hidden truncate text-sm text-muted lg:inline">{t("admin.title")}</span>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          <div className="hidden items-center gap-2 sm:flex">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-accent2-soft text-xs font-semibold text-accent2">
              {initial}
            </span>
            <div className="hidden min-w-0 lg:block">
              <p className="max-w-40 truncate text-xs font-semibold leading-tight">{name}</p>
              {email && <p className="max-w-40 truncate text-[11px] leading-tight text-muted">{email}</p>}
            </div>
          </div>
          <Link href="/dashboard" className="h-9 rounded-lg px-2.5 pt-2 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
            ← <span className="hidden sm:inline">{t("admin.backToApp")}</span>
          </Link>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("admin.title")}>
          <div className="animate-fade absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass animate-drawer absolute inset-y-0 left-0 flex w-[290px] max-w-[86vw] flex-col rounded-none border-y-0 border-l-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between px-5">
              <div className="flex items-center gap-2">
                <Brand href="/admin" markOnly />
                <span className="rounded-full bg-accent2-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent2">
                  Admin
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-raised/70 p-3.5">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent2-soft text-xs font-bold text-accent2">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{name}</p>
                {email && <p className="truncate text-xs text-muted">{email}</p>}
              </div>
            </div>
            <div className="mt-3 flex-1 overflow-y-auto px-3">
              <AdminNav onNavigate={() => setOpen(false)} />
            </div>
            <Link href="/dashboard"
              className="mx-3 mt-2 flex min-h-[44px] items-center rounded-xl border-t border-line px-3 pt-2 text-sm text-muted transition-colors hover:text-ink">
              ← {t("admin.backToApp")}
            </Link>
          </div>
        </div>
      )}

      <AdminBottomBar onMore={() => setOpen(true)} />
    </>
  );
}

const BAR_ITEMS = [
  { href: "/admin", key: "dashboard", icon: "▦" },
  { href: "/admin/users", key: "users", icon: "◉" },
  { href: "/admin/generations", key: "generations", icon: "✦" },
  { href: "/admin/credits", key: "credits", icon: "◎" },
] as const;

function AdminBottomBar({ onMore }: { onMore: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around rounded-none border-x-0 border-b-0 lg:hidden">
      {BAR_ITEMS.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
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
              "flex h-6 w-10 items-center justify-center rounded-full text-base leading-none transition-colors duration-150",
              active && "bg-accent-soft"
            )}>{i.icon}</span>
            <span className="truncate">{t(`admin.nav.${i.key}`)}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] font-medium text-muted transition-colors duration-150"
      >
        <span aria-hidden className="flex h-6 w-10 items-center justify-center rounded-full text-base leading-none">⋯</span>
        <span className="truncate">{t("nav.more")}</span>
      </button>
    </nav>
  );
}
