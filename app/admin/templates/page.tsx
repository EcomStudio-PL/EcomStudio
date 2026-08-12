import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateManager } from "@/components/admin/inline-controls";
import { PromptBlocksManager } from "@/components/admin/prompt-blocks";

export default async function AdminTemplates() {
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
      <PageHeader title={t("admin.nav.templates")} sub={t("admin.templatesSub")} />
      <TemplateManager templates={templates ?? []} />
      <div className="mt-8">
        <h2 className="mb-1 font-display text-lg font-semibold tracking-tight">{t("admin.blocksTitle")}</h2>
        <PromptBlocksManager blocks={blocks ?? []} />
      </div>
    </div>
  );
}
