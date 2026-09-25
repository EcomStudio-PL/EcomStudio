import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { readToolsLayout } from "@/lib/server/tool-layout";
import { PageHeader } from "@/components/ui/page-header";
import { ToolsLayoutEditor, ToolsViewTabs } from "@/components/admin/tools-layout";

export const dynamic = "force-dynamic";

/**
 * AI I GENEROWANIE → NARZĘDZIA I SILNIKI → UKŁAD DLA KLIENTÓW.
 *
 * How the customer's /tools is organised — section order, what each section
 * holds and in what order, which sections are shown — and the three
 * independent switches of every catalogue item (/tools, menu, Start). The
 * admin layout already requires the admin role; the save actions check it
 * again. What a tool does (route, engine, model, credits, prompt, status) is
 * not on this screen and is never written by it.
 */
export default async function AdminToolsLayoutPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [availability, stored] = await Promise.all([
    getAvailabilityMap(supabase),
    readToolsLayout(supabase),
  ]);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.ai")}
        title={t("aicc.tools.title")}
        sub={t("aicc.layout.sub")}
      />
      <ToolsViewTabs />
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{t("aicc.layout.title")}</h2>
      {/* Keyed on the stored version: a save or a reload remounts the editor
          with what is stored instead of keeping a stale draft. */}
      <ToolsLayoutEditor key={stored.updatedAt ?? "default"} initial={stored.layout}
        updatedAt={stored.updatedAt} availability={availability} />
    </div>
  );
}
