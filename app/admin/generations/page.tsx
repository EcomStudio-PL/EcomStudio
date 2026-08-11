import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function AdminGenerations() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("generation_jobs")
    .select("*, products(name), workspaces(name)")
    .order("created_at", { ascending: false }).limit(200);
  return (
    <div>
      <PageHeader title={t("admin.nav.generations")} />
      <AdminTable
        headers={[t("history.product"), "Workspace", t("common.status"), t("history.creditsCol"), t("common.date")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((j) => [
          j.products?.name ?? "—",
          j.workspaces?.name ?? "—",
          <Badge key="s">{t(`history.st.${j.status}`)}</Badge>,
          j.credits_charged,
          formatDate(j.created_at, locale),
        ])}
      />
    </div>
  );
}
