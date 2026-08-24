"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LifeBuoy, PanelLeftClose, PanelLeftOpen, Plus, Shield } from "lucide-react";
import { CLIENT_NAV, CLIENT_BOTTOM } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { useDrawer } from "./shell-context";
import { BottomNav } from "./bottom-nav";
import { NavGroupLabel } from "./drawer";
import { AccountIsland } from "./account-island";

/** Customer sidebar (desktop): a persistent rail with the identity block on
 *  top, grouped navigation below and admin access pinned to the bottom.
 *  Collapses to an icon rail (the "wersja pośrednia" on the way to the
 *  topbar-only navigation) — the choice is remembered per browser.
 *  Same information architecture as the mobile drawer. Deliberately contains
 *  NO admin entries in the main nav; /admin stays server-guarded anyway. */
export function Sidebar({ name, email, credits, plan, isAdmin }: {
  name: string; email?: string; credits: number; plan: string; isAdmin: boolean;
}) {
  const { t, locale } = useI18n();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem("ecs-rail-collapsed") === "1") setCollapsed(true); }
    catch { /* private mode */ }
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem("ecs-rail-collapsed", c ? "0" : "1"); } catch { /* private mode */ }
      return !c;
    });
  }
  return (
    <aside className={cn(
      "rail sticky top-0 hidden h-dvh shrink-0 flex-col py-4 lg:flex",
      "transition-[width] duration-300 ease-[cubic-bezier(0.2,0.9,0.2,1)]",
      collapsed ? "w-[var(--rail-w-collapsed)] px-3" : "w-[var(--rail-w)] px-3",
    )}>
      <div className={cn("pb-4", collapsed ? "flex justify-center" : "px-2")}>
        <Brand href="/dashboard" markOnly={collapsed} />
      </div>

      {collapsed ? (
        <Link
          href="/credits"
          className="group brand-gradient relative mx-auto flex h-11 w-11 flex-col items-center justify-center rounded-2xl text-white shadow-e2 ring-1 ring-white/15 transition-shadow hover:ring-white/30"
        >
          <span aria-hidden className="text-[9px] leading-none opacity-80">◆</span>
          <span className="text-[10px] font-bold leading-tight tabular-nums">
            {credits > 999 ? `${Math.floor(credits / 1000)}k` : credits}
          </span>
          <span aria-hidden className="rail-tip">
            {t("nav.credits")}: {new Intl.NumberFormat(locale).format(credits)}
          </span>
        </Link>
      ) : (
        <ProfileCard name={name} email={email} credits={credits} plan={plan} initial={initial} />
      )}

      {/* Navigation. Expanded scrolls internally; collapsed stays visible so
          the hover tooltips are never clipped by an overflow context. */}
      <nav className={cn(
        "mt-4 flex min-h-0 flex-1 flex-col gap-0.5",
        collapsed ? "items-stretch overflow-visible" : "thin-scroll overflow-y-auto",
      )}>
        {CLIENT_NAV.map((g, gi) => (
          <div key={g.key} className={cn(collapsed ? "mb-2" : "mb-3")}>
            {collapsed
              ? gi > 0 && <span aria-hidden className="mx-auto mb-2 block h-px w-7 bg-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.6))]" />
              : <NavGroupLabel>{t(`nav.groups.${g.key}`)}</NavGroupLabel>}
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} compact={collapsed} dense />
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-3 space-y-1.5">
        {isAdmin && (
          <Link href="/admin"
            className={cn(
              "group relative flex items-center rounded-xl py-2.5 text-sm font-semibold transition-colors",
              "text-accent2 hover:bg-accent2-soft",
              collapsed ? "justify-center px-0" : "gap-2.5 px-3",
            )}>
            <span aria-hidden className={cn(
              "flex shrink-0 items-center justify-center rounded-lg bg-accent2-soft",
              collapsed ? "h-9 w-9" : "h-7 w-7",
            )}>
              <Shield size={collapsed ? 16 : 15} />
            </span>
            {!collapsed && t("nav.admin")}
            {collapsed && <span aria-hidden className="rail-tip">{t("nav.admin")}</span>}
          </Link>
        )}

        {/* Collapse toggle — pinned last, like the arrow in the reference. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-expanded={!collapsed}
          className={cn(
            "group relative flex w-full items-center rounded-xl py-2.5 text-faint transition-colors hover:bg-raised hover:text-ink",
            collapsed ? "justify-center px-0" : "gap-2.5 px-3",
          )}
        >
          <span aria-hidden className={cn(
            "flex shrink-0 items-center justify-center rounded-lg",
            collapsed ? "h-9 w-9" : "h-7 w-7",
          )}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </span>
          {!collapsed && <span className="text-xs font-semibold">{t("nav.collapse")}</span>}
          {collapsed && <span aria-hidden className="rail-tip">{t("nav.expand")}</span>}
        </button>
      </div>
    </aside>
  );
}

/** Identity + wallet block. Same component and shape as the drawer header,
 *  so the rail and the mobile menu are visibly one system. */
export function ProfileCard({ name, email, credits, plan, initial }: {
  name: string; email?: string; credits: number; plan: string; initial: string;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="px-0.5">
      <AccountIsland
        standalone
        initial={initial}
        name={name}
        email={email}
        facts={[
          { label: t("nav.credits"), value: `◆ ${new Intl.NumberFormat(locale).format(credits)}` },
          { label: t("nav.plan"), value: plan, tone: "accent2" },
        ]}
        primaryAction={{ href: "/credits", label: t("nav.topUp"), icon: Plus }}
        secondaryActions={[
          { href: "/plan", label: plan.trim().toLowerCase() === "free" ? t("nav.upgrade") : t("nav.managePlan"), icon: ArrowUpRight },
          { href: "/support", label: t("nav.help"), icon: LifeBuoy },
        ]}
      />
    </div>
  );
}

/**
 * Bottom navigation (mobile). Delegates to the shared dock so the customer
 * app and the admin panel cannot drift apart.
 */
export function MobileNav() {
  const { t } = useI18n();
  const { setOpen } = useDrawer();
  return (
    <BottomNav
      items={CLIENT_BOTTOM}
      labelFor={(i) => t(`nav.${i.shortKey ?? i.key}`)}
      moreLabel={t("nav.more")}
      onMore={() => setOpen(true)}
      exactRoots={["/dashboard"]}
    />
  );
}
