import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listJobs } from "@/lib/services/generator";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminTable } from "@/components/ui/admin-table";
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
      <PageHeader overline={t("nav.groups.assets")} title={t("history.title")} sub={t("history.sub")} />
      {jobs.length === 0 ? (
        <EmptyState title={t("history.emptyTitle")} body={t("history.emptyBody")} />
      ) : (
        <AdminTable
          headers={[t("history.product"), t("common.type"), t("common.status"), t("history.creditsCol"), t("common.date")]}
          empty={t("history.emptyBody")}
          rows={jobs.map((j) => [
            j.products?.name ?? "—",
            j.material_type ? t(`generator.mt.${j.material_type}`) : "—",
            <Badge key="s" tone={TONE[j.status]} dot>{t(`history.st.${j.status}`)}</Badge>,
            <span key="c" className="tabular-nums">{j.credits_charged}</span>,
            <span key="d" className="text-muted">{formatDate(j.created_at, locale)}</span>,
          ])}
        />
      )}
    </div>
  );
}
