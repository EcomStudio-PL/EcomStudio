"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";

/** Mobile chrome for the admin panel: top header with hamburger, slide-out
 *  drawer holding the full admin nav, and a compact bottom bar with the four
 *  most-used destinations plus "More" (opens the drawer). Desktop keeps the
 *  permanent sidebar; everything here is lg:hidden. */
export function AdminMobileShell() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("admin.title")}
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            ☰
          </button>
          <Brand href="/admin" markOnly />
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
            Admin
          </span>
        </div>
        <Link href="/dashboard" className="text-sm text-muted transition-colors hover:text-ink">
          ← {t("admin.backToApp")}
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("admin.title")}>
          <div className="animate-fade absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass animate-drawer absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col rounded-none border-y-0 border-l-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="mb-4 flex items-center justify-between px-3">
              <Brand href="/admin" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{t("admin.title")}</p>
            <div className="flex-1 overflow-y-auto">
              <AdminNav onNavigate={() => setOpen(false)} />
            </div>
            <Link href="/dashboard"
              className="mt-3 flex min-h-[44px] items-center rounded-xl border-t border-line px-3 pt-2 text-sm text-muted transition-colors hover:text-ink">
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
