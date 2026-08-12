import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ServiceManager } from "@/components/admin/service-editor";
import { formatDate } from "@/lib/utils";

export default async function AdminServices() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const [{ data: services }, { data: billing }, { data: history }] = await Promise.all([
    supabase.from("service_catalog").select("*").order("sort_order"),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    supabase.from("service_price_history")
      .select("entity_type, old_values, new_values, created_at, changed_by:profiles(email)")
      .order("created_at", { ascending: false }).limit(20),
  ]);
  const b = (billing?.value ?? {}) as { price_per_100_credits?: number; usd_to_pln?: number };
  const plnPerCredit = (b.price_per_100_credits ?? 19) / 100;
  const usdToPln = b.usd_to_pln ?? 4.0;

  return (
    <div>
      <PageHeader title={t("svc.title")} sub={t("svc.sub")} />
      <ServiceManager services={services ?? []} plnPerCredit={plnPerCredit} usdToPln={usdToPln} />
      <Card className="mt-6">
        <CardHeader title={t("svc.priceHistory")} sub={t("svc.priceHistorySub")} />
        {(history ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(history ?? []).map((h, i) => (
              <li key={i} className="px-5 py-2.5 text-xs">
                <span className="text-muted">{formatDate(h.created_at, locale)} · {h.entity_type} · {h.changed_by?.email ?? "—"}</span>
                <code className="ml-2 break-all text-faint">{JSON.stringify(h.old_values)} → {JSON.stringify(h.new_values)}</code>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
