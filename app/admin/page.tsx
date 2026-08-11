import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { adminCounts } from "@/lib/services/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export default async function AdminDashboard() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const counts = await adminCounts(supabase);
  const { data: recent } = await supabase
    .from("activity_logs")
    .select("id, action, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div>
      <PageHeader title={t("admin.title")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("admin.statUsers")} value={counts.users} />
        <Stat label={t("admin.statProducts")} value={counts.products} />
        <Stat label={t("admin.statJobs")} value={counts.jobs} />
        <Stat label={t("admin.statCreditsUsed")} value={counts.creditsUsed} />
      </div>
      <Card className="mt-6">
        <CardHeader title={t("admin.recent")} />
        {(recent ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(recent ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <code className="text-xs">{r.action}</code>
                <span className="text-xs text-muted">{formatDate(r.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
