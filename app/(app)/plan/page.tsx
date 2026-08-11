import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCredits, formatPrice } from "@/lib/utils";

export default async function PlanPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("active", true)
    .order("sort_order");

  return (
    <div>
      <PageHeader title={t("plan.title")} sub={t("plan.sub")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(plans ?? []).map((p) => {
          const isCurrent = p.slug === "free";
          return (
            <Card key={p.id} className={`flex flex-col p-5 ${isCurrent ? "border-accent" : ""}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">{p.name}</h3>
                {isCurrent && <Badge tone="green">{t("plan.current")}</Badge>}
              </div>
              <p className="mt-3 font-display text-3xl font-semibold tracking-tight">
                {p.price_cents === 0 ? "0 zł" : formatPrice(p.price_cents, p.currency)}
              </p>
              <p className="mt-1 text-sm text-muted">{t("plan.creditsMo", { n: formatCredits(p.monthly_credits) })}</p>
              <div className="mt-auto pt-5">
                <button disabled className="w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-muted opacity-60">
                  {isCurrent ? t("plan.current") : t("plan.choose")}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted">{t("plan.chooseSoon")}</p>
    </div>
  );
}
