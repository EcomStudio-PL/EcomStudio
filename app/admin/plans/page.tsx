import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { formatCredits, formatPrice } from "@/lib/utils";

export default async function AdminPlans() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("subscription_plans").select("*").order("sort_order");
  return (
    <div>
      <PageHeader title={t("admin.nav.plans")} />
      <AdminTable
        headers={[t("common.name"), t("admin.priceCol"), t("nav.credits")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((p) => [
          p.name,
          formatPrice(p.price_cents, p.currency),
          formatCredits(p.monthly_credits),
        ])}
      />
    </div>
  );
}
