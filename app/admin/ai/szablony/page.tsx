import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AiTabs } from "@/components/admin/ai-tabs";
import { TemplateManager } from "@/components/admin/inline-controls";
import { PromptBlocksManager } from "@/components/admin/prompt-blocks";

/**
 * AI I GENEROWANIE → SZABLONY PROMPTÓW.
 *
 * The shot templates and the reusable prompt blocks the planner composes from.
 * These are NOT a tool's hidden system prompt — that lives encrypted, one
 * version at a time, in the tool's Silnik tab. These are the building blocks
 * the planner assembles per shot, shared by every tool that plans shots, which
 * is why they stay one library instead of being copied per tool.
 */
export default async function AdminPromptTemplates() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [{ data: templates }, { data: blocks }] = await Promise.all([
    supabase
      .from("prompt_templates")
      .select("id, name, shot_type, template, format, style, priority, active")
      .is("workspace_id", null)
      .order("priority"),
    supabase.from("prompt_blocks").select("*").order("sort_order"),
  ]);
  return (
    <div>
      <PageHeader overline={t("admin.navGroups.ai")}
        title={t("admin.nav.templates")} sub={t("aicc.templates.sub")} />
      <AiTabs />
      <TemplateManager templates={templates ?? []} />
      <div className="mt-10">
        <PromptBlocksManager blocks={blocks ?? []} />
      </div>
    </div>
  );
}
