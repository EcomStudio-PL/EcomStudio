import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listAssets } from "@/lib/services/generator";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function LibraryPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const generations = await listAssets(supabase, workspace.id);
  // Tool results are saved the same way but are not generations, so they get
  // their own shelf rather than being folded into the generation grid.
  const { data: toolResults } = await supabase
    .from("tool_results")
    .select("id, tool_slug, storage_path, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(60);

  // Sign all generated asset paths in one call.
  const paths = [
    ...generations.flatMap((g) => g.generation_assets.map((a) => a.storage_path)),
    ...(toolResults ?? []).map((r) => r.storage_path),
  ];
  const urlMap = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(paths, 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl); });
  }

  return (
    <div>
      <PageHeader overline={t("nav.groups.assets")} title={t("library.title")} sub={t("library.sub")} />
      {generations.length === 0 && (toolResults ?? []).length === 0 ? (
        <EmptyState title={t("library.emptyTitle")} body={t("library.emptyBody")} />
      ) : (
        <div className="stagger grid gap-3.5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
          {generations.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              {g.generation_assets.length > 0 && (
                <div className={`grid gap-0.5 ${g.generation_assets.length > 1 ? "grid-cols-2" : ""}`}>
                  {g.generation_assets.slice(0, 4).map((a) => {
                    const url = urlMap.get(a.storage_path);
                    return url ? (
                      <a key={a.id} href={url} target="_blank" className="block bg-raised">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="aspect-square w-full object-cover transition-transform duration-200 hover:scale-[1.02]" />
                      </a>
                    ) : null;
                  })}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{g.products?.name ?? "—"}</p>
                  <p className="text-xs text-muted">{formatDate(g.created_at, locale)}</p>
                </div>
                <Badge tone={g.generation_assets.length > 0 ? "green" : "neutral"}>
                  {g.generation_assets.length}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(toolResults ?? []).length > 0 && (
        <section className="mt-7">
          <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tight">{t("tools.title")}</h2>
          <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0 sm:grid-cols-4 lg:grid-cols-6">
            {(toolResults ?? []).map((r) => {
              const url = urlMap.get(r.storage_path);
              return url ? (
                <a key={r.id} href={url} target="_blank" rel="noreferrer noopener"
                  className="panel panel-interactive block overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" className="aspect-square w-full bg-checker object-contain" />
                  <p className="truncate px-2 py-1.5 text-[11px] font-medium">{t(`tools.${r.tool_slug}.name`)}</p>
                </a>
              ) : null;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
