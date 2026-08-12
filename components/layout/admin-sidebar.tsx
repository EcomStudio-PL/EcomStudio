"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { rolePresentation } from "@/lib/roles";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";

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
    <aside className="glass hidden w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0 px-3 py-5 lg:flex">
      <div className="px-3 pb-4"><Brand href="/admin" /></div>

      <div className="mx-1 mb-4 rounded-2xl bg-raised/70 p-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
              {t(presentation.labelKey)}
            </p>
          </div>
        </div>
        {email && <p className="mt-2 truncate text-[11px] text-faint">{email}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface/70 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpiUsers")}</p>
            <p className="font-display text-sm font-semibold">{stats.users}</p>
            <p className="text-[10px] text-accent">+{stats.usersToday}</p>
          </div>
          <div className="rounded-xl bg-surface/70 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpiToday")}</p>
            <p className="font-display text-sm font-semibold text-accent2">{pln(stats.revenueTodayCents)}</p>
          </div>
          <div className="col-span-2 rounded-xl bg-surface/70 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("admin.kpi30d")}</p>
            <p className="font-display text-sm font-semibold text-accent2">{pln(stats.revenue30dCents)}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto"><AdminNav /></div>

      <Link href="/dashboard"
        className="mx-1 mt-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-accent/40 hover:text-ink">
        <ArrowLeft size={15} aria-hidden />
        {t("admin.backToApp")}
      </Link>
    </aside>
  );
}
