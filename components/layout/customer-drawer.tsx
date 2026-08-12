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
import { ProfileCard } from "./sidebar";
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
        "overlay absolute inset-y-0 left-0 flex w-[318px] max-w-[88vw] flex-col rounded-none border-y-0 border-l-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]",
        closing ? "animate-drawer-out" : "animate-drawer"
      )}>
        {/* Profile IS the header — full width, edge to edge */}
        <div className="px-4 pb-4 pt-1">
          <div className="mb-3 flex justify-end"><DrawerClose onClick={close} /></div>
          <ProfileCard name={name} email={email} credits={credits} plan={plan} initial={initial} size="lg" />
        </div>

        <nav className="thin-scroll flex-1 overflow-y-auto px-4">
          {CLIENT_NAV.map((g) => (
            <div key={g.key} className="mb-3">
              <div className="mb-1.5 flex items-center gap-2 px-3 pt-1">
                <span className="overline text-[10px]">{t(`nav.groups.${g.key}`)}</span>
                <span aria-hidden className="h-px flex-1 bg-[rgb(var(--hairline)/var(--hairline-alpha))]" />
              </div>
              {g.items.map((i) => (
                <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} onNavigate={close} />
              ))}
            </div>
          ))}
        </nav>

        {/* Account actions sit on their own plane, separated from the work
            navigation above by a real edge rather than by spacing alone. */}
        <div className="mt-2 border-t border-line bg-sunken/60 px-4 py-2">
          {isAdmin && (
            <Link href="/admin"
              className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-semibold text-accent2 transition-colors hover:bg-accent2-soft">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent2-soft">
                <Shield size={15} />
              </span>
              {t("nav.admin")}
            </Link>
          )}
          <form action={signOut}>
            <button className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-faint">
                <LogOut size={15} />
              </span>
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
