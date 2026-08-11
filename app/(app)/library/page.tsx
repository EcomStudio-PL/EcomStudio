import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listAssets } from "@/lib/services/generator";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function LibraryPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const generations = await listAssets(supabase, workspace.id);

  return (
    <div>
      <PageHeader title={t("library.title")} sub={t("library.sub")} />
      {generations.length === 0 ? (
        <EmptyState title={t("library.emptyTitle")} body={t("library.emptyBody")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {generations.map((g) => (
            <Card key={g.id} className="p-4">
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium">{g.products?.name ?? "—"}</span>
                <Badge tone={g.quality_status === "passed" ? "green" : g.quality_status === "failed" ? "red" : "neutral"}>
                  {g.quality_status}
                </Badge>
              </div>
              {g.product_match_score !== null && (
                <p className="mt-1 text-xs text-muted">Match: {g.product_match_score}%</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
