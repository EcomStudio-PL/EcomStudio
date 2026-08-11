import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listJobs } from "@/lib/services/generator";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

const TONE = { queued: "neutral", processing: "blue", completed: "green", failed: "red", cancelled: "neutral" } as const;

export default async function HistoryPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const jobs = await listJobs(supabase, workspace.id);

  return (
    <div>
      <PageHeader title={t("history.title")} sub={t("history.sub")} />
      {jobs.length === 0 ? (
        <EmptyState title={t("history.emptyTitle")} body={t("history.emptyBody")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("history.product")}</th>
                <th className="px-5 py-3 font-medium">{t("common.type")}</th>
                <th className="px-5 py-3 font-medium">{t("common.status")}</th>
                <th className="px-5 py-3 font-medium">{t("history.creditsCol")}</th>
                <th className="px-5 py-3 font-medium">{t("common.date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-5 py-3">{j.products?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{j.material_type ? t(`generator.mt.${j.material_type}`) : "—"}</td>
                  <td className="px-5 py-3"><Badge tone={TONE[j.status]}>{t(`history.st.${j.status}`)}</Badge></td>
                  <td className="px-5 py-3">{j.credits_charged}</td>
                  <td className="px-5 py-3 text-muted">{formatDate(j.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
