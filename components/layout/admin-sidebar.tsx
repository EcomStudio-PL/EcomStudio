"use client";
import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { rolePresentation } from "@/lib/roles";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";
import { AccountIsland } from "./account-island";

export type AdminSidebarStats = {
  users: number; usersToday: number; revenueTodayCents: number; revenue30dCents: number;
};

/** Admin/staff desktop sidebar — same information architecture as the admin
 *  mobile drawer: identity + role, the business numbers staff actually need,
 *  then the shared admin nav. Never shows customer plan/credit tiles: a staff
 *  member is not a client of the app. */
export function AdminSidebar({ name, email, role, stats }: {
  name: string; email?: string; role: string; stats: AdminSidebarStats;
}) {
  const { t } = useI18n();
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const presentation = rolePresentation(role);
  const pln = (cents: number) =>
    new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(cents / 100);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line bg-sidebar/80 px-3 py-5 backdrop-blur-xl lg:flex">
      <div className="px-3 pb-4"><Brand href="/admin" /></div>

      <div className="px-3">
        <AccountIsland
          standalone
          initial={initial}
          name={name}
          email={email}
          tone="accent2"
          badge={
            <span className="inline-flex rounded-full bg-accent2-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent2">
              {t(presentation.labelKey)}
            </span>
          }
          facts={[
            { label: t("admin.kpiUsers"), value: stats.users, tone: "ink" },
            { label: t("admin.kpiToday"), value: pln(stats.revenueTodayCents), tone: "accent2" },
            { label: t("admin.kpi30d"), value: pln(stats.revenue30dCents), tone: "accent2" },
          ]}
          secondaryActions={[{ href: "/admin/support", label: t("admin.messages"), icon: LifeBuoy }]}
        />
      </div>

      <div className="thin-scroll mt-4 min-h-0 flex-1 overflow-y-auto"><AdminNav /></div>

      <Link href="/dashboard"
        className="plate mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-[rgb(var(--accent2)/0.4)] hover:text-ink">
        <ArrowLeft size={15} aria-hidden />
        {t("admin.backToApp")}
      </Link>
    </aside>
  );
}
