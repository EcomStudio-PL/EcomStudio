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
      "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar/80 py-5 backdrop-blur-xl transition-[width] duration-200 lg:flex",
      collapsed ? "w-[76px] px-2.5" : "w-[264px] px-3",
    )}>
      <div className={cn("pb-5", collapsed ? "flex justify-center" : "px-3")}>
        <Brand href="/dashboard" markOnly={collapsed} />
      </div>

      {collapsed ? (
        <Link
          href="/credits"
          title={`${t("nav.credits")}: ${new Intl.NumberFormat(locale).format(credits)}`}
          className="brand-gradient mx-auto flex h-10 w-10 flex-col items-center justify-center rounded-2xl text-white shadow-e2 ring-1 ring-white/15 transition-shadow hover:ring-white/30"
        >
          <span className="text-[9px] leading-none opacity-80">◆</span>
          <span className="text-[10px] font-bold leading-tight tabular-nums">
            {credits > 999 ? `${Math.floor(credits / 1000)}k` : credits}
          </span>
        </Link>
      ) : (
        <ProfileCard name={name} email={email} credits={credits} plan={plan} initial={initial} />
      )}

      <nav className="thin-scroll mt-4 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {CLIENT_NAV.map((g) => (
          <div key={g.key} className="mb-3">
            {!collapsed && <NavGroupLabel>{t(`nav.groups.${g.key}`)}</NavGroupLabel>}
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`nav.${i.key}`)} icon={i.icon} compact={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      {isAdmin && (
        <Link href="/admin"
          title={collapsed ? t("nav.admin") : undefined}
          className={cn(
            "plate mt-3 flex items-center rounded-xl py-2.5 text-sm font-semibold text-muted transition-colors hover:border-[rgb(var(--accent2)/0.4)] hover:text-ink",
            collapsed ? "justify-center px-0" : "gap-2.5 px-3",
          )}>
          <Shield size={15} className="text-accent2" aria-hidden />
          {!collapsed && t("nav.admin")}
        </Link>
      )}

      {/* Collapse toggle — pinned last, like the arrow in the reference. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
        title={collapsed ? t("nav.expand") : t("nav.collapse")}
        className={cn(
          "mt-3 flex h-10 items-center rounded-xl text-faint transition-colors hover:bg-raised hover:text-ink",
          collapsed ? "justify-center" : "gap-2.5 px-3",
        )}
      >
        {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
        {!collapsed && <span className="text-xs font-medium">{t("nav.collapse")}</span>}
      </button>
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
    <div className="px-3">
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
