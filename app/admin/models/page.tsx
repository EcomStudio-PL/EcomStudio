import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { ModelRow, type ModelView } from "@/components/admin/model-editor";

export default async function AdminModels() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const [{ data: models }, { data: billing }] = await Promise.all([
    supabase.from("ai_models").select("*, ai_providers(name)").order("sort_order"),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
  ]);
  const b = (billing?.value ?? {}) as { price_per_100_credits?: number; usd_to_pln?: number };
  const plnPerCredit = (b.price_per_100_credits ?? 19) / 100;
  const usdToPln = b.usd_to_pln ?? 4.0;
  const views: ModelView[] = (models ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    model_identifier: m.model_identifier,
    type: m.type,
    active: m.active,
    credit_cost: m.credit_cost,
    internal_cost_usd_micros: m.internal_cost_usd_micros,
    quality_tier: m.quality_tier,
    speed_tier: m.speed_tier,
    max_reference_images: m.max_reference_images,
    supports_reference_images: m.supports_reference_images,
    description: m.description,
    display_name: m.display_name,
    badge: m.badge,
    sort_order: m.sort_order,
    pricing: (m.pricing ?? {}) as Record<string, number>,
    supported_resolutions: m.supported_resolutions ?? ["1K"],
    providerName: m.ai_providers?.name ?? "—",
  }));
  return (
    <div>
      <PageHeader title={t("admin.nav.models")} sub={t("admin.modelsSub")} />
      <div className="space-y-3">
        {views.map((m) => (
          <ModelRow key={m.id} m={m} usdToPln={usdToPln} plnPerCredit={plnPerCredit} locale={locale} />
        ))}
      </div>
      <p className="mt-4 text-sm text-faint">{t("admin.economicsNote")}</p>
    </div>
  );
}
