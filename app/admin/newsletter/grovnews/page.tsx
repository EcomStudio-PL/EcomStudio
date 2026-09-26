import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/components/ui/admin-table";
import { dashboardVerdict, loadGrovNewsDashboard } from "@/components/admin/grovnews/dashboard-data";
import { GrovNewsEconomicsPanel, GrovNewsTodayPanel } from "@/components/admin/grovnews/dashboard";

export const dynamic = "force-dynamic";

/** GrovNews at a glance — "does it work today?" first, then the money, then
 *  the content. Every number counted from the tables, none made up; what is
 *  not known is said to be unknown. */
export default async function GrovNewsDashboard() {
  const supabase = await createClient();
  const now = new Date();
  const [{ dict, locale }, data] = await Promise.all([getDictionary(), loadGrovNewsDashboard(supabase, now)]);
  const { stats } = data;
  const t = makeT(dict);
  const date = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }) : "—";
  return (
    <div className="min-w-0 space-y-5" data-grovnews-dashboard>
      <GrovNewsTodayPanel data={data} verdict={dashboardVerdict(data.today, data.settings, now)} locale={locale} t={t} />
      <GrovNewsEconomicsPanel economics={data.economics} locale={locale} t={t} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t("grovnewsAdm.statTotal")} value={stats.total} />
        <Stat label={t("grovnewsAdm.statPublished")} value={stats.published} tone="success" />
        <Stat label={t("grovnewsAdm.statDrafts")} value={stats.drafts} />
        <Stat label={t("grovnewsAdm.statArchived")} value={stats.archived} />
        <Stat label={t("grovnewsAdm.statSubscribers")} value={stats.activeSubscribers} tone="accent" href="/admin/newsletter/grovnews/subskrybenci" />
        <Stat label={t("grovnewsAdm.statExpiring")} value={stats.expiringSoon} hint={t("grovnewsAdm.statExpiringHint")} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.recent")}</h2>
        <Link href="/admin/newsletter/grovnews/wpisy/nowy" className="cta inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold">
          <FilePlus2 size={15} aria-hidden />{t("grovnewsAdm.newPost")}
        </Link>
      </div>
      <AdminTable
        empty={t("grovnewsAdm.noPosts")}
        headers={[t("grovnewsAdm.colTitle"), t("grovnewsAdm.colStatus"), t("grovnewsAdm.colCategory"), t("grovnewsAdm.colPublished")]}
        rows={stats.recent.map((p) => [
          <Link key="t" href={`/admin/newsletter/grovnews/wpisy/${p.id}`} className="hover:text-accent">{p.title}</Link>,
          <Badge key="s" tone={p.status === "PUBLISHED" ? "success" : p.status === "ARCHIVED" ? "neutral" : "warning"}>{t(`grovnewsAdm.status.${p.status}`)}</Badge>,
          p.category ?? "—",
          date(p.publishedAt),
        ])}
      />
    </div>
  );
}
