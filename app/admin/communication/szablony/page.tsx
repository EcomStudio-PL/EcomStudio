import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { SectionHeader } from "@/components/ui/section-header";
import { TemplateStudio } from "@/components/admin/template-studio";
import { authDeliveryStatusAction, listTemplatesAction } from "@/app/actions/templates";

export const dynamic = "force-dynamic";

/**
 * SZABLONY — the studio for everything GrovBase sends. The admin layout two
 * levels up already gates on role; the actions re-check it on every write, so
 * this page only loads the catalog × stored rows and renders.
 */
export default async function CommunicationTemplates() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [entries, delivery] = await Promise.all([listTemplatesAction(), authDeliveryStatusAction()]);

  return (
    <div>
      <SectionHeader className="mb-4" title={t("tpl.title")} sub={t("tpl.sub")} />
      {entries
        ? <TemplateStudio entries={entries} delivery={delivery} />
        : <p className="text-sm text-muted">{t("common.error")}</p>}
    </div>
  );
}
