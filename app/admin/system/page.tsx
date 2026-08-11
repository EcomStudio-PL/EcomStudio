import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AdminSystem() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const isDev = SUPABASE_URL.includes("ezyhwkcrrysanbcbkzsq");
  return (
    <div>
      <PageHeader title={t("admin.nav.system")} />
      <Card>
        <CardHeader title={t("admin.sysEnv")} />
        <div className="space-y-3 p-5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Supabase</span>
            <div className="flex items-center gap-2">
              <code className="text-xs">{SUPABASE_URL.replace("https://", "")}</code>
              <Badge tone={isDev ? "blue" : "red"}>{isDev ? "DEV" : "PROD"}</Badge>
            </div>
          </div>
          <p className="rounded-xl bg-raised px-4 py-3 text-xs text-muted">{t("admin.sysNote")}</p>
        </div>
      </Card>
    </div>
  );
}
