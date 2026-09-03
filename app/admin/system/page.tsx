import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsEditor } from "@/components/admin/inline-controls";
import { FlagManager } from "@/components/admin/flag-manager";

const SECTION_ORDER = ["general", "user_defaults", "generation", "generator_ui", "retouch", "credits", "security", "features", "billing"];

export default async function AdminSystem() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const d24 = new Date(Date.now() - 86400000).toISOString();
  const [{ data }, { data: flags }, dbCheck, failed24, { data: creds }] = await Promise.all([
    supabase.from("app_settings").select("key, value"),
    supabase.from("feature_flags").select("*").order("flag"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("usage_events").select("id", { count: "exact", head: true })
      .in("status", ["failed", "refunded"]).gte("created_at", d24),
    supabase.from("ai_provider_credentials")
      .select("last_test_status, last_tested_at, ai_providers(name)"),
  ]);
  const sections = (data ?? [])
    .sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key))
    .map((s) => ({ key: s.key, value: (s.value ?? {}) as Record<string, unknown> }));
  const isDev = SUPABASE_URL.includes("ezyhwkcrrysanbcbkzsq");
  const dbOk = dbCheck.error == null;

  return (
    <div>
      <PageHeader title={t("admin.nav.system")} sub={t("admin.systemSub")} />

      <Card className="mb-5">
        <CardHeader title={t("health.title")} />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-sm">
            <span className="text-muted">Supabase</span>
            <Badge tone={dbOk ? "green" : "red"}>{dbOk ? t("health.connected") : t("health.error")}</Badge>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-sm">
            <span className="text-muted">Vercel</span>
            <Badge tone="green">{t("health.connected")}</Badge>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-sm">
            <span className="text-muted">{t("health.failed24")}</span>
            <Badge tone={(failed24.count ?? 0) > 0 ? "amber" : "green"}>{failed24.count ?? 0}</Badge>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-sm">
            <span className="text-muted">{t("admin.sysEnv")}</span>
            <span className="flex items-center gap-2">
              <code className="text-xs">{SUPABASE_URL.replace("https://", "").split(".")[0]}</code>
              <Badge tone={isDev ? "blue" : "green"}>{isDev ? "DEV" : "PROD"}</Badge>
            </span>
          </div>
        </div>
        {(creds ?? []).length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{t("admin.nav.providers")}</p>
            <div className="flex flex-wrap gap-2">
              {(creds ?? []).map((c, i) => (
                <Badge key={i} tone={c.last_test_status === "connected" ? "green" : c.last_test_status ? "amber" : "neutral"}>
                  {c.ai_providers?.name}: {c.last_test_status ?? "—"}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <CardHeader title={t("flags.title")} sub={t("flags.sub")} />
        <div className="p-5"><FlagManager flags={flags ?? []} /></div>
      </Card>

      <SettingsEditor sections={sections} />
    </div>
  );
}
