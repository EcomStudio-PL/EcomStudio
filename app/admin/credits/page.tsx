import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/modal";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { PackageManager } from "@/components/admin/package-editor";
import { formatCredits, formatDate } from "@/lib/utils";

export default async function AdminCredits() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: wallets }, { data: monthTx }, { data: txs }, { data: packages }] = await Promise.all([
    supabase.from("credit_wallets").select("balance"),
    supabase.from("credit_transactions").select("amount, type").gte("created_at", monthStart.toISOString()),
    supabase.from("credit_transactions").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("credit_packages").select("*").order("sort_order"),
  ]);
  const circulation = (wallets ?? []).reduce((s, w) => s + w.balance, 0);
  const issued = (monthTx ?? []).filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const consumed = (monthTx ?? []).filter((x) => x.amount < 0).reduce((s, x) => s + Math.abs(x.amount), 0);
  const purchased = (monthTx ?? []).filter((x) => x.type === "topup" && x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const bonus = (monthTx ?? []).filter((x) => x.type === "bonus" && x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const refunded = (monthTx ?? []).filter((x) => x.type === "refund" && x.amount > 0).reduce((s, x) => s + x.amount, 0);

  return (
    <div>
      <PageHeader title={t("admin.nav.credits")} sub={t("admin.creditsSub")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("admin.circulation")} value={formatCredits(circulation)} accent />
        <StatCard label={t("admin.issuedMonth")} value={formatCredits(issued)} />
        <StatCard label={t("admin.consumedMonth")} value={formatCredits(consumed)} />
        <StatCard label={t("credits.tt.topup")} value={purchased > 0 ? formatCredits(purchased) : t("admin.noDataYet")} />
        <StatCard label={t("credits.tt.bonus")} value={formatCredits(bonus)} />
        <StatCard label={t("credits.tt.refund")} value={refunded > 0 ? formatCredits(refunded) : t("admin.noDataYet")} />
      </div>

      <Card className="mt-6">
        <CardHeader title={t("admin.packages")} sub={t("admin.packagesSub")} />
        <div className="p-5">
          <PackageManager packages={packages ?? []} />
        </div>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 font-display text-base font-semibold">{t("credits.historyTitle")}</h2>
        <AdminTable
          headers={[t("common.type"), t("common.amount"), t("common.description"), t("common.date")]}
          empty={t("admin.noData")}
          rows={(txs ?? []).map((tx) => [
            t(`credits.tt.${tx.type}`),
            <Badge key="a" tone={tx.amount >= 0 ? "green" : "red"}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</Badge>,
            tx.description ?? "—",
            formatDate(tx.created_at, locale),
          ])}
        />
      </div>
    </div>
  );
}
