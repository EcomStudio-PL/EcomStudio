import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { TemplateManager } from "@/components/admin/inline-controls";
import { PromptBlocksManager } from "@/components/admin/prompt-blocks";

export default async function AdminTemplates() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  void t;
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
      <TemplateManager templates={templates ?? []} />
      <div className="mt-10">
        <PromptBlocksManager blocks={blocks ?? []} />
      </div>
    </div>
  );
}
