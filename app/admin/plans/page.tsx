import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { PlanManager } from "@/components/admin/plan-manager";

export default async function AdminPlans() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("subscription_plans").select("*").order("sort_order");
  return (
    <div>
      <PageHeader title={t("admin.nav.plans")} sub={t("admin.plansSub")} />
      <PlanManager plans={data ?? []} />
      <p className="mt-4 text-sm text-muted">{t("admin.plansNote")}</p>
    </div>
  );
}
