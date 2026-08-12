"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { signOut } from "@/app/actions/auth";
import { CLIENT_NAV } from "@/lib/navigation";
import { NavLink } from "./nav-link";
import { DrawerClose } from "./drawer-close";
import { useDrawer } from "./shell-context";

/** THE mobile menu for the customer app — the single navigation hub opened
 *  by the hamburger, the avatar and the bottom-bar "More" button alike.
 *  The user profile IS the drawer header: full-width, starting right below
 *  the safe area — no logo row, no wasted space. */
export function CustomerDrawer({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t } = useI18n();
  const { open, setOpen } = useDrawer();
  const [closing, setClosing] = useState(false);
  const pathname = usePathname();
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); setOpen(false); }, 190);
  }, [setOpen]);

  useEffect(() => { setClosing(false); setOpen(false); }, [pathname, setOpen]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, close]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
      <div className={cn("absolute inset-0 bg-black/70 backdrop-blur-[2px]", closing ? "animate-fade-out" : "animate-fade")} onClick={close} />
      <div className={cn(
        "overlay absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col rounded-none border-y-0 border-l-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]",
        closing ? "animate-drawer-out" : "animate-drawer"
      )}>
        {/* Profile IS the header — full width, edge to edge */}
        <div className="border-b border-line px-6 pb-5 pt-2">
          <div className="flex items-start justify-between gap-3">
            <span aria-hidden className="brand-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white">
              {initial}
            </span>
            <DrawerClose onClick={close} />
          </div>
          <p className="mt-3 truncate text-base font-semibold">{name}</p>
          {email && <p className="truncate text-xs text-muted">{email}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/credits" className="rounded-xl bg-raised px-3 py-2.5 transition-colors hover:bg-accent-soft">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("nav.credits")}</p>
              <p className="font-display text-sm font-semibold text-accent">
                ◆ {new Intl.NumberFormat("pl-PL").format(credits)}
              </p>
            </Link>
            <Link href="/plan" className="rounded-xl bg-raised px-3 py-2.5 transition-colors hover:bg-accent2-soft">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("nav.plan")}</p>
              <p className="truncate font-display text-sm font-semibold text-accent2">{plan}</p>
            </Link>
          </div>
        </div>

        <nav className="mt-3 flex-1 overflow-y-auto px-4">
          {CLIENT_NAV.map((g) => (
            <div key={g.key} className="mb-2">
              <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                {t(`nav.groups.${g.key}`)}
              </p>
              {g.items.map((i) => (
                <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} onNavigate={close} />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-4 pt-2">
          {isAdmin && (
            <Link href="/admin"
              className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-accent2 transition-colors hover:bg-accent2-soft">
              <Shield aria-hidden size={17} />{t("nav.admin")}
            </Link>
          )}
          <form action={signOut}>
            <button className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
              <LogOut aria-hidden size={17} />{t("common.signOut")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
