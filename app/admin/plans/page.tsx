import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanEditor } from "@/components/admin/inline-controls";

export default async function AdminPlans() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("subscription_plans").select("*").order("sort_order");
  return (
    <div>
      <PageHeader title={t("admin.nav.plans")} sub={t("admin.plansSub")} />
      <div className="space-y-4">
        {(data ?? []).map((p) => (
          <Card key={p.id} className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <code className="rounded bg-raised px-2 py-0.5 text-xs">{p.slug}</code>
              {!p.active && <Badge tone="amber">{t("admin.inactive")}</Badge>}
            </div>
            <PlanEditor plan={p} />
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{t("admin.plansNote")}</p>
    </div>
  );
}
