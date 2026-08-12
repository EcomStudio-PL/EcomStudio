"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, Shield } from "lucide-react";
import type { NavItem } from "@/lib/navigation";
import { CLIENT_NAV, CLIENT_BOTTOM } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { useDrawer } from "./shell-context";

/** Customer sidebar (desktop). Same information architecture as the mobile
 *  drawer — profile identity, credits and plan on top, then the shared nav
 *  config — but built as a persistent desktop rail, not a stretched drawer.
 *  Deliberately contains NO admin entries; admin access lives in the topbar
 *  shield and the drawer, and /admin stays server-guarded anyway. */
export function Sidebar({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t } = useI18n();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <aside className="glass hidden w-[250px] shrink-0 flex-col rounded-none border-y-0 border-l-0 px-3 py-5 lg:flex">
      <div className="px-3 pb-4"><Brand href="/dashboard" /></div>

      <div className="mx-1 mb-4 rounded-2xl bg-raised/70 p-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            {email && <p className="truncate text-[11px] text-faint">{email}</p>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href="/credits" className="rounded-xl bg-surface/70 px-2.5 py-2 transition-colors hover:bg-accent-soft">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("nav.credits")}</p>
            <p className="font-display text-sm font-semibold text-accent">
              ◆ {new Intl.NumberFormat("pl-PL").format(credits)}
            </p>
          </Link>
          <Link href="/plan" className="rounded-xl bg-surface/70 px-2.5 py-2 transition-colors hover:bg-accent2-soft">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("nav.plan")}</p>
            <p className="truncate font-display text-sm font-semibold text-accent2">{plan}</p>
          </Link>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {CLIENT_NAV.map((g) => (
          <div key={g.key} className="mb-2">
            <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
              {t(`nav.groups.${g.key}`)}
            </p>
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} />
            ))}
          </div>
        ))}
      </nav>

      {isAdmin && (
        <Link href="/admin"
          className="mx-1 mt-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-accent/40 hover:text-ink">
          <Shield size={15} className="text-accent" aria-hidden />
          {t("nav.admin")}
        </Link>
      )}
    </aside>
  );
}

export function BottomItem({ item, label }: { item: NavItem; label: string }) {
  const pathname = usePathname();
  const active = pathname === item.href || (item.href !== "/dashboard" && item.href !== "/admin" && pathname.startsWith(item.href));
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] font-medium transition-colors duration-150",
        active ? "text-accent" : "text-muted"
      )}
    >
      <span aria-hidden className={cn(
        "flex h-6 w-10 items-center justify-center rounded-full transition-colors duration-150",
        active && "bg-accent-soft"
      )}><Icon size={17} /></span>
      <span className="w-full truncate text-center leading-tight">{label}</span>
    </Link>
  );
}

export function MoreButton({ label }: { label: string }) {
  const { setOpen } = useDrawer();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] font-medium text-muted transition-colors duration-150"
    >
      <span aria-hidden className="flex h-6 w-10 items-center justify-center rounded-full"><MoreHorizontal size={17} /></span>
      <span className="w-full truncate text-center leading-tight">{label}</span>
    </button>
  );
}

/** Customer bottom navigation (mobile): four key destinations + "More",
 *  which opens the SAME unified drawer. */
export function MobileNav() {
  const { t } = useI18n();
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around rounded-none border-x-0 border-b-0 lg:hidden">
      {CLIENT_BOTTOM.map((i) => (
        <BottomItem key={i.href} item={i} label={t(`nav.${i.shortKey ?? i.key}`)} />
      ))}
      <MoreButton label={t("nav.more")} />
    </nav>
  );
}
