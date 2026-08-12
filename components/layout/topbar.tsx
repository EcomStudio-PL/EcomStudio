"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { signOut } from "@/app/actions/auth";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { Brand } from "./brand";
import { CommandPalette } from "./command-palette";

/** Account dropdown. This is the ONLY place in the customer app that links to
 *  /admin, and only for admins — customer navigation stays admin-free. */
function AccountMenu({ name, email, isAdmin }: { name: string; email?: string; isAdmin: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("nav.groups.account")}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-xs font-semibold ring-1 ring-line transition-shadow hover:ring-accent/50"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="glass animate-pop absolute right-0 top-11 z-50 w-60 rounded-2xl p-1.5">
          <div className="border-b border-line px-3 pb-2.5 pt-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            {email && <p className="truncate text-xs text-muted">{email}</p>}
          </div>
          <div className="pt-1.5">
            <Link href="/settings" role="menuitem"
              className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-sm text-ink transition-colors hover:bg-raised">
              <span aria-hidden className="w-4 text-center text-muted">⚙</span>{t("nav.settings")}
            </Link>
            <Link href="/plan" role="menuitem"
              className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-sm text-ink transition-colors hover:bg-raised">
              <span aria-hidden className="w-4 text-center text-muted">▲</span>{t("nav.plan")}
            </Link>
            {isAdmin && (
              <Link href="/admin" role="menuitem"
                className="mt-1 flex min-h-[40px] items-center gap-2.5 rounded-xl border-t border-line px-3 pt-1 text-sm font-medium text-accent transition-colors hover:bg-accent-soft">
                <span aria-hidden className="w-4 text-center">⛭</span>{t("nav.admin")}
              </Link>
            )}
            <form action={signOut}>
              <button role="menuitem"
                className="flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
                <span aria-hidden className="w-4 text-center">↩</span>{t("common.signOut")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar({ name, email, credits, workspace, isAdmin = false }: {
  name: string; email?: string; credits: number; workspace?: string; isAdmin?: boolean;
}) {
  const { t } = useI18n();
  return (
    <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-4 pt-[env(safe-area-inset-top)] lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="lg:hidden"><Brand href="/dashboard" markOnly /></div>
        {workspace && (
          <span className="hidden truncate rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-muted lg:inline-flex">
            ▣ {workspace}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <CommandPalette isAdmin={isAdmin} />
        <Link href="/credits"
          className="brand-gradient inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 dark:text-emerald-950">
          <span aria-hidden>◆</span>
          {new Intl.NumberFormat("pl-PL").format(credits)}
          <span className="hidden sm:inline">{t("nav.credits")}</span>
        </Link>
        <LocaleSwitcher />
        <ThemeToggle />
        <AccountMenu name={name} email={email} isAdmin={isAdmin} />
      </div>
    </header>
  );
}
