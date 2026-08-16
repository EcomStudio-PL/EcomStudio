import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** ADMIN — recent concept sessions across all workspaces. RLS grants this
 *  listing to admins only; a member hitting the route gets an empty page. */
export default async function AdminConceptsPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const { data: sessions } = await supabase
    .from("prompt_sessions")
    .select("id, product_name, status, aspect_ratio, created_at, workspace_id, workspaces(name)")
    .order("created_at", { ascending: false })
    .limit(40);

  const ids = (sessions ?? []).map((s) => s.id);
  const counts = new Map<string, { total: number; generated: number }>();
  if (ids.length > 0) {
    const { data: prompts } = await supabase
      .from("generated_prompts")
      .select("session_id, generation_count")
      .in("session_id", ids);
    for (const p of prompts ?? []) {
      if (!p.session_id) continue;
      const c = counts.get(p.session_id) ?? { total: 0, generated: 0 };
      c.total += 1;
      if ((p.generation_count ?? 0) > 0) c.generated += 1;
      counts.set(p.session_id, c);
    }
  }

  return (
    <div>
      <PageHeader overline={t("admin.navGroups.ai")} title={t("admin.concepts.title")} sub={t("admin.concepts.sub")} />
      {(sessions ?? []).length === 0 ? (
        <Panel className="rounded-2xl px-5 py-12 text-center text-sm text-muted">{t("admin.concepts.empty")}</Panel>
      ) : (
        <div className="space-y-2.5">
          {(sessions ?? []).map((s) => {
            const c = counts.get(s.id);
            return (
              <Link key={s.id} href={`/admin/concepts/${s.id}`}
                className="panel panel-interactive flex items-center gap-3 rounded-2xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.product_name}</p>
                  <p className="truncate text-xs text-faint">
                    {(s.workspaces as { name?: string } | null)?.name ?? "—"} · {formatDate(s.created_at, locale)} · {s.aspect_ratio}
                  </p>
                </div>
                {c && (
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {t("admin.concepts.generated")}: {c.generated}/{c.total}
                  </span>
                )}
                <Badge tone={s.status === "ready" ? "green" : s.status === "failed" ? "red" : "amber"}>
                  {s.status}
                </Badge>
                <ArrowRight size={14} className="shrink-0 text-faint" aria-hidden />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
