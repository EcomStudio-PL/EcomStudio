import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function AdminUsers() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
  return (
    <div>
      <PageHeader title={t("admin.nav.users")} />
      <AdminTable
        headers={[t("admin.user"), t("auth.email"), t("admin.role"), t("common.created")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((u) => [
          u.full_name ?? "—",
          u.email,
          <Badge key="r" tone={u.role === "admin" ? "green" : "neutral"}>{u.role}</Badge>,
          formatDate(u.created_at, locale),
        ])}
      />
    </div>
  );
}
