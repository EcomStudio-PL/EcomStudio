import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { ModelRow, type ModelView } from "@/components/admin/model-editor";
import { GenerationPriority, type PriorityModelOption } from "@/components/admin/generation-priority";

export default async function AdminModels() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const [{ data: models }, { data: billing }, { data: generation }] = await Promise.all([
    supabase.from("ai_models").select("*, ai_providers(name, slug)").order("sort_order"),
    supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "generation").maybeSingle(),
  ]);
  const genCfg = (generation?.value ?? {}) as { provider_priority?: string[]; planner_provider?: string; planner_fallback?: string };
  const priority = genCfg.provider_priority ?? [];
  const priorityOptions: PriorityModelOption[] = (models ?? [])
    .filter((m) => m.active && m.supports_reference_images)
    .map((m) => ({
      key: `${(m.ai_providers as { slug?: string } | null)?.slug}:${m.model_identifier}`,
      label: `${m.display_name || m.name} (${m.ai_providers?.name ?? "?"})`,
    }))
    .filter((o, i, arr) => arr.findIndex((x) => x.key === o.key) === i);
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
    ecom_surcharge_credits: (m as { ecom_surcharge_credits?: number }).ecom_surcharge_credits ?? 0,
    unavailableReason: (m.metadata as { unavailable_reason?: string } | null)?.unavailable_reason ?? null,
    unavailableNote: (m.metadata as { unavailable_note?: string } | null)?.unavailable_note ?? null,
  }));
  return (
    <div>
      <PageHeader title={t("admin.nav.models")} sub={t("admin.modelsSub")} />
      <GenerationPriority options={priorityOptions} current={priority}
        planner={{ primary: genCfg.planner_provider ?? "openai", fallback: genCfg.planner_fallback ?? "" }} />
      <div className="space-y-3">
        {views.map((m) => (
          <ModelRow key={m.id} m={m} usdToPln={usdToPln} plnPerCredit={plnPerCredit} locale={locale} />
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">{t("admin.costSourceOfTruth")}</p>
      <p className="mt-4 text-sm text-faint">{t("admin.economicsNote")}</p>
    </div>
  );
}
