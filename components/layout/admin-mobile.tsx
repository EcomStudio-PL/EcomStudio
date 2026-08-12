"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";
import { rolePresentation } from "@/lib/roles";
import { ADMIN_BOTTOM, ADMIN_NAV } from "@/lib/navigation";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { Drawer, DrawerIdentity, NavGroupLabel } from "./drawer";
import { BottomNav } from "./bottom-nav";

export type AdminShellStats = {
  users: number;
  usersToday: number;
  revenueTodayCents: number;
  revenue30dCents: number;
};

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(cents / 100);

/**
 * Admin chrome. Built from the SAME drawer and dock components as the
 * customer app, so the two surfaces are one product: identical widths,
 * spacing, close button, item heights and active states. Only the content
 * differs — role instead of plan, real business KPIs instead of credits.
 */
export function AdminShell({ name, email, role, stats }: {
  name: string; email?: string; role: string; stats: AdminShellStats;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const rp = rolePresentation(role);

  const roleBadge = (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]", rp.badgeClass)}>
      {t(rp.labelKey)}
    </span>
  );

  return (
    <>
      <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)]">
        <div className="flex h-[60px] items-center justify-between gap-2 px-3 sm:px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t("admin.title")}
              aria-expanded={open}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink lg:hidden"
            >
              <Menu aria-hidden size={20} />
            </button>
            <div className="lg:hidden"><Brand href="/admin" markOnly /></div>
            <div className="hidden sm:block">{roleBadge}</div>
            <span className="hidden truncate text-sm text-muted lg:inline">{t("admin.title")}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <LocaleSwitcher />
            <ThemeToggle />
            <Link href="/dashboard" aria-label={t("admin.backToApp")}
              className="hidden h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink sm:flex">
              <ArrowLeft aria-hidden size={14} />
              <span className="hidden lg:inline">{t("admin.backToApp")}</span>
            </Link>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t("admin.title")}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent2-soft text-xs font-bold text-accent2 lg:hidden"
            >
              {initial}
            </button>
            <span aria-hidden className="hidden h-9 w-9 items-center justify-center rounded-full bg-accent2-soft text-xs font-bold text-accent2 lg:flex">
              {initial}
            </span>
          </div>
        </div>
      </header>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        label={t("admin.title")}
        header={
          <DrawerIdentity
            initial={initial}
            name={name}
            email={email}
            tone="accent2"
            badge={roleBadge}
            facts={[
              { label: t("admin.kpiClients"), value: stats.users, tone: "ink" },
              { label: t("admin.kpiToday"), value: pln(stats.revenueTodayCents), tone: "accent2" },
              { label: t("admin.kpi30d"), value: pln(stats.revenue30dCents), tone: "accent2" },
            ]}
          />
        }
        footer={
          <Link href="/dashboard"
            className="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-ink">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-faint">
              <ArrowLeft size={15} />
            </span>
            {t("admin.backToApp")}
          </Link>
        }
      >
        {ADMIN_NAV.map((g) => (
          <div key={g.key} className="mb-1">
            <NavGroupLabel>{t(`admin.navGroups.${g.key}`)}</NavGroupLabel>
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href} label={t(`admin.nav.${i.key}`)} icon={i.icon} onNavigate={() => setOpen(false)} />
            ))}
          </div>
        ))}
      </Drawer>

      <BottomNav
        items={ADMIN_BOTTOM}
        labelFor={(i) => t(`admin.nav.${i.shortKey ?? i.key}`)}
        moreLabel={t("nav.more")}
        onMore={() => setOpen(true)}
        exactRoots={["/admin"]}
      />
    </>
  );
}
