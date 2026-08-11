import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { formatDate } from "@/lib/utils";

export default async function AdminLogs() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("activity_logs")
    .select("*, actor:profiles!activity_logs_actor_id_fkey(email), behalf:profiles!activity_logs_on_behalf_of_fkey(email)")
    .order("created_at", { ascending: false }).limit(300);
  return (
    <div>
      <PageHeader title={t("admin.nav.logs")} />
      <AdminTable
        headers={[t("admin.action"), t("admin.actor"), t("admin.onBehalf"), t("common.date")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((l) => [
          <code key="a" className="text-xs">{l.action}</code>,
          l.actor?.email ?? "—",
          l.behalf?.email ?? "—",
          formatDate(l.created_at, locale),
        ])}
      />
    </div>
  );
}
