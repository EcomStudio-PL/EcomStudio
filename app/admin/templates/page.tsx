import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateManager } from "@/components/admin/inline-controls";

export default async function AdminTemplates() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data } = await supabase
    .from("prompt_templates")
    .select("id, name, shot_type, template, format, style, priority, active")
    .is("workspace_id", null)
    .order("priority");
  return (
    <div>
      <PageHeader title={t("admin.nav.templates")} sub={t("admin.templatesSub")} />
      <TemplateManager templates={data ?? []} />
    </div>
  );
}
