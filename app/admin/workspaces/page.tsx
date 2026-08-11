import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { formatDate } from "@/lib/utils";

export default async function AdminWorkspaces() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("workspaces")
    .select("*, workspace_members(user_id), profiles!workspaces_owner_id_fkey(email)")
    .order("created_at", { ascending: false }).limit(200);
  return (
    <div>
      <PageHeader title={t("admin.nav.workspaces")} />
      <AdminTable
        headers={[t("common.name"), t("admin.owner"), t("admin.members"), t("common.created")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((w) => [
          w.name,
          w.profiles?.email ?? "—",
          w.workspace_members.length,
          formatDate(w.created_at, locale),
        ])}
      />
    </div>
  );
}
