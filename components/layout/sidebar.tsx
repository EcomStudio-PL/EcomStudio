"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { NavItem } from "@/lib/navigation";
import { CLIENT_NAV, CLIENT_BOTTOM } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { useDrawer } from "./shell-context";

/** Customer sidebar (desktop). Renders the shared nav config; deliberately
 *  contains NO admin entries — admin access lives in the topbar shield and
 *  the drawer, for admins only, and /admin stays server-guarded anyway. */
export function Sidebar() {
  const { t } = useI18n();
  return (
    <aside className="glass hidden w-[250px] shrink-0 flex-col rounded-none border-y-0 border-l-0 px-3 py-5 lg:flex">
      <div className="px-3 pb-6"><Brand href="/dashboard" /></div>
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
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function MoreButton({ label }: { label: string }) {
  const { setOpen } = useDrawer();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[11px] font-medium text-muted transition-colors duration-150"
    >
      <span aria-hidden className="flex h-6 w-10 items-center justify-center rounded-full"><MoreHorizontal size={17} /></span>
      <span className="truncate">{label}</span>
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
        <BottomItem key={i.href} item={i} label={t(`nav.${i.key}`)} />
      ))}
      <MoreButton label={t("nav.more")} />
    </nav>
  );
}
