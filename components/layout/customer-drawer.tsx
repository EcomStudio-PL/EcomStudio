"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { signOut } from "@/app/actions/auth";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { GROUPS } from "./sidebar";

/** Customer offcanvas (mobile). Slides in from the left with the full app
 *  navigation plus account context: avatar, plan, credit balance, sign-out.
 *  The admin entry appears here ONLY for admins, tucked at the bottom —
 *  customer navigation itself stays admin-free. */
export function CustomerDrawer({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("nav.menu")}
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
      >
        ☰
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <div className="animate-fade absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass animate-drawer absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col rounded-none border-y-0 border-l-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between px-5">
              <Brand href="/dashboard" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="mx-4 mt-5 rounded-2xl bg-raised/70 p-4">
              <div className="flex items-center gap-3">
                <span aria-hidden className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white dark:text-emerald-950">
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  {email && <p className="truncate text-xs text-muted">{email}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href="/credits" className="rounded-xl bg-surface px-3 py-2 transition-colors hover:bg-accent-soft">
                  <p className="text-[11px] font-medium text-muted">{t("nav.credits")}</p>
                  <p className="font-display text-sm font-semibold text-accent">
                    ◆ {new Intl.NumberFormat("pl-PL").format(credits)}
                  </p>
                </Link>
                <Link href="/plan" className="rounded-xl bg-surface px-3 py-2 transition-colors hover:bg-accent2-soft">
                  <p className="text-[11px] font-medium text-muted">{t("nav.plan")}</p>
                  <p className="truncate font-display text-sm font-semibold text-accent2">{plan}</p>
                </Link>
              </div>
            </div>

            <nav className="mt-4 flex-1 overflow-y-auto px-4">
              {GROUPS.map((g) => (
                <div key={g.key} className="mb-2">
                  <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {t(`nav.groups.${g.key}`)}
                  </p>
                  {g.items.map((i) => (
                    <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} onNavigate={() => setOpen(false)} />
                  ))}
                </div>
              ))}
            </nav>

            <div className="border-t border-line px-4 pt-2">
              {isAdmin && (
                <Link href="/admin"
                  className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-accent2 transition-colors hover:bg-accent2-soft">
                  <span aria-hidden className="w-5 text-center">⛭</span>{t("nav.admin")}
                </Link>
              )}
              <form action={signOut}>
                <button className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
                  <span aria-hidden className="w-5 text-center">↩</span>{t("common.signOut")}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
