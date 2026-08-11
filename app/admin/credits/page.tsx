import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function AdminCredits() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("credit_transactions")
    .select("*")
    .order("created_at", { ascending: false }).limit(200);
  return (
    <div>
      <PageHeader title={t("admin.nav.credits")} />
      <AdminTable
        headers={[t("common.type"), t("common.amount"), t("common.description"), t("common.date")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((tx) => [
          t(`credits.tt.${tx.type}`),
          <Badge key="a" tone={tx.amount >= 0 ? "green" : "red"}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</Badge>,
          tx.description ?? "—",
          formatDate(tx.created_at, locale),
        ])}
      />
    </div>
  );
}
