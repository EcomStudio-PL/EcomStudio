import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsEditor } from "@/components/admin/inline-controls";

const SECTION_ORDER = ["general", "user_defaults", "generation", "credits", "security", "features"];

export default async function AdminSystem() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase.from("app_settings").select("key, value");
  const sections = (data ?? [])
    .sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key))
    .map((s) => ({ key: s.key, value: (s.value ?? {}) as Record<string, unknown> }));
  const isDev = SUPABASE_URL.includes("ezyhwkcrrysanbcbkzsq");
  return (
    <div>
      <PageHeader title={t("admin.nav.system")} sub={t("admin.systemSub")} />
      <Card className="mb-5">
        <CardHeader title={t("admin.sysEnv")} />
        <div className="flex items-center justify-between p-5 text-sm">
          <span className="text-muted">Supabase</span>
          <div className="flex items-center gap-2">
            <code className="text-xs">{SUPABASE_URL.replace("https://", "")}</code>
            <Badge tone={isDev ? "blue" : "green"}>{isDev ? "DEV" : "PROD"}</Badge>
          </div>
        </div>
      </Card>
      <SettingsEditor sections={sections} />
    </div>
  );
}
