import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProviderToggle } from "@/components/admin/inline-controls";

// Provider API keys live ONLY in server environment variables. The admin UI
// reports configured/not-configured — the secret itself never reaches the browser.
const ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
  fal: "FAL_API_KEY",
  higgsfield: "HIGGSFIELD_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export default async function AdminProviders() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("ai_providers")
    .select("*, ai_models(id, active)")
    .order("name");
  return (
    <div>
      <PageHeader title={t("admin.nav.providers")} sub={t("admin.providersSub")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data ?? []).map((p) => {
          const envName = ENV_KEYS[p.slug];
          const configured = envName ? Boolean(process.env[envName]) : false;
          const activeModels = p.ai_models.filter((m) => m.active).length;
          return (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold">{p.name}</h3>
                  <code className="text-xs text-muted">{p.slug}</code>
                </div>
                <Badge tone={p.active ? "green" : "amber"}>
                  {p.active ? t("admin.active") : t("admin.inactive")}
                </Badge>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t("admin.apiKey")}</span>
                  <Badge tone={configured ? "green" : "red"}>
                    {configured ? t("admin.configured") : t("admin.notConfigured")}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t("admin.envVar")}</span>
                  <code className="text-xs">{envName ?? "—"}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t("admin.nav.models")}</span>
                  <span>{activeModels} / {p.ai_models.length} {t("admin.active").toLowerCase()}</span>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-xs text-muted">{t("admin.keyHint")}</p>
                <ProviderToggle providerId={p.id} active={p.active} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
