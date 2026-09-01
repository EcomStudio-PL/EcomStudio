import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { EngineAdmin, type EngineRuleView, type EngineVersionView, type KnowledgeSetView } from "@/components/admin/engine";

export const dynamic = "force-dynamic";

/**
 * AI ENGINE — the admin's continuous-learning console: knowledge sets
 * (imported ZIP archives of documentation + BEFORE/AFTER examples), the
 * curated examples the engine retrieves from at planning time, the prompt
 * rules it always applies, and the engine version history. Admin-only at
 * every layer: the layout guard, requireAdmin in every action, and the RLS
 * from migration 0042.
 */
export default async function AdminEnginePage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const [{ data: sets }, { data: exampleRows }, { data: rules }, { data: versions }] = await Promise.all([
    supabase.from("knowledge_sets")
      .select("id, name, product_category, product_description, model, status, error, notes, file_count, version, created_at, updated_at")
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("knowledge_examples").select("id, set_id, enabled, result_rating").limit(5000),
    supabase.from("prompt_engine_rules")
      .select("id, name, rule_type, content, priority, enabled, version, updated_at")
      .order("priority", { ascending: true }),
    supabase.from("prompt_engine_versions")
      .select("id, version, changelog, active, created_at")
      .order("created_at", { ascending: false }).limit(50),
  ]);

  const bySet = new Map<string, { total: number; enabled: number; rated: number; ratingSum: number }>();
  for (const e of exampleRows ?? []) {
    const agg = bySet.get(e.set_id) ?? { total: 0, enabled: 0, rated: 0, ratingSum: 0 };
    agg.total++;
    if (e.enabled) agg.enabled++;
    if (typeof e.result_rating === "number") { agg.rated++; agg.ratingSum += e.result_rating; }
    bySet.set(e.set_id, agg);
  }

  const setViews: KnowledgeSetView[] = (sets ?? []).map((row) => {
    const agg = bySet.get(row.id);
    return {
      id: row.id, name: row.name,
      category: row.product_category, description: row.product_description,
      model: row.model, status: row.status, error: row.error, notes: row.notes,
      fileCount: row.file_count, version: row.version,
      createdAt: row.created_at, updatedAt: row.updated_at,
      exampleCount: agg?.total ?? 0, enabledCount: agg?.enabled ?? 0,
      avgRating: agg && agg.rated > 0 ? Math.round((agg.ratingSum / agg.rated) * 10) / 10 : null,
    };
  });

  const ruleViews: EngineRuleView[] = (rules ?? []).map((r) => ({
    id: r.id, name: r.name, ruleType: r.rule_type, content: r.content,
    priority: r.priority, enabled: r.enabled, version: r.version, updatedAt: r.updated_at,
  }));
  const versionViews: EngineVersionView[] = (versions ?? []).map((v) => ({
    id: v.id, version: v.version, changelog: v.changelog, active: v.active, createdAt: v.created_at,
  }));

  return (
    <div>
      <PageHeader title={t("admin.engine.title")} sub={t("admin.engine.sub")} />
      <EngineAdmin sets={setViews} rules={ruleViews} versions={versionViews} />
    </div>
  );
}
