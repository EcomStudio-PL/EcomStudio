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

/** Customer sidebar (desktop): a persistent rail with the identity block on
 *  top, grouped navigation below and admin access pinned to the bottom.
 *  Same information architecture as the mobile drawer. Deliberately contains
 *  NO admin entries in the main nav; /admin stays server-guarded anyway. */
export function Sidebar({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t } = useI18n();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <aside className="relative hidden w-[264px] shrink-0 flex-col border-r border-line bg-sidebar/80 px-3 py-5 backdrop-blur-xl lg:flex">
      {/* The rail catches the ambient key light along its inner edge. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[rgb(var(--accent)/0.28)] to-transparent" />
      <div className="px-3 pb-5"><Brand href="/dashboard" /></div>

      <ProfileCard name={name} email={email} credits={credits} plan={plan} initial={initial} />

      <nav className="thin-scroll mt-4 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {CLIENT_NAV.map((g) => (
          <div key={g.key} className="mb-3">
            <div className="mb-1.5 flex items-center gap-2 px-3">
              <span className="overline text-[10px]">{t(`nav.groups.${g.key}`)}</span>
              <span aria-hidden className="h-px flex-1 bg-[rgb(var(--hairline)/var(--hairline-alpha))]" />
            </div>
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} />
            ))}
          </div>
        ))}
      </nav>

      {isAdmin && (
        <Link href="/admin"
          className="plate mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-[rgb(var(--accent2)/0.4)] hover:text-ink">
          <Shield size={15} className="text-accent2" aria-hidden />
          {t("nav.admin")}
        </Link>
      )}
    </aside>
  );
}

/** Identity + wallet block. Shared shape with the mobile drawer header so the
 *  app feels like one product across breakpoints. */
export function ProfileCard({ name, email, credits, plan, initial, size = "sm" }: {
  name: string; email?: string; credits: number; plan: string; initial: string;
  size?: "sm" | "lg";
}) {
  const { t } = useI18n();
  const premium = plan.toLowerCase() !== "free";
  return (
    <div className="panel overflow-hidden rounded-2xl">
      <div className={cn("flex items-center gap-3", size === "lg" ? "p-4" : "p-3")}>
        <span aria-hidden className={cn(
          "brand-gradient flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-e2",
          size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm"
        )}>
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", size === "lg" ? "text-[15px]" : "text-sm")}>{name}</p>
          {email && <p className="truncate text-[11px] text-faint">{email}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-[rgb(var(--hairline)/var(--hairline-alpha))]">
        <Link href="/credits" className="group bg-surface px-3 py-2.5 transition-colors hover:bg-accent-soft">
          <p className="overline text-[9px]">{t("nav.credits")}</p>
          <p className="metric mt-0.5 text-[15px] text-accent">
            ◆ {new Intl.NumberFormat("pl-PL").format(credits)}
          </p>
        </Link>
        <Link href="/plan" className="group bg-surface px-3 py-2.5 transition-colors hover:bg-accent2-soft">
          <p className="overline text-[9px]">{t("nav.plan")}</p>
          <p className={cn("mt-0.5 flex items-center gap-1 truncate font-display text-[15px] font-semibold",
            premium ? "text-accent2" : "text-muted")}>
            {premium && <span aria-hidden className="text-[10px]">★</span>}
            {plan}
          </p>
        </Link>
      </div>
    </div>
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
        "group relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition-colors duration-150",
        active ? "text-accent" : "text-faint"
      )}
    >
      <span aria-hidden className={cn(
        "relative flex h-8 w-full max-w-[3.25rem] items-center justify-center rounded-xl transition-all duration-200",
        active
          ? "bg-[rgb(var(--accent)/0.16)] shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.35)]"
          : "group-active:bg-[rgb(var(--faint)/0.12)]"
      )}>
        <Icon size={18} strokeWidth={active ? 2.4 : 2} />
      </span>
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
      className="group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold text-faint transition-colors duration-150"
    >
      <span aria-hidden className="flex h-8 w-full max-w-[3.25rem] items-center justify-center rounded-xl transition-colors group-active:bg-[rgb(var(--faint)/0.12)]">
        <MoreHorizontal size={18} />
      </span>
      <span className="w-full truncate text-center leading-tight">{label}</span>
    </button>
  );
}

/**
 * Bottom navigation (mobile) as a floating dock: detached from the screen
 * edge, resting above the safe area, so the app reads as a layer over the
 * device rather than a page welded to the bottom bezel.
 */
export function MobileNav() {
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="dock flex items-stretch justify-around gap-0.5 rounded-2xl p-1">
        {CLIENT_BOTTOM.map((i) => (
          <BottomItem key={i.href} item={i} label={t(`nav.${i.shortKey ?? i.key}`)} />
        ))}
        <MoreButton label={t("nav.more")} />
      </div>
    </nav>
  );
}
