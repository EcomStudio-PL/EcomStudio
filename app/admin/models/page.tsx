import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";

export default async function AdminModels() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("ai_models")
    .select("*, ai_providers(name, slug, active)")
    .order("created_at");
  return (
    <div>
      <PageHeader title={t("admin.nav.models")} />
      <AdminTable
        headers={[t("admin.provider"), t("admin.model"), t("common.status"), t("admin.creditCost")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((m) => [
          m.ai_providers?.name ?? "—",
          <span key="m">{m.name} <code className="text-xs text-muted">{m.model_identifier}</code></span>,
          <Badge key="s" tone={m.active ? "green" : "amber"}>{m.active ? t("admin.active") : t("admin.inactive")}</Badge>,
          m.credit_cost,
        ])}
      />
      <p className="mt-4 text-sm text-muted">{t("generator.noModelsBody")}</p>
    </div>
  );
}
