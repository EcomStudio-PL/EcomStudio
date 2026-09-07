import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { readToolRegistry } from "@/lib/services/ai-tools";
import { PageHeader } from "@/components/ui/page-header";
import { ToolRegistry } from "@/components/admin/tool-registry";

export const dynamic = "force-dynamic";

/**
 * AI I GENEROWANIE → NARZĘDZIA I SILNIKI.
 *
 * Every customer-facing tool on one screen, with the five facts an operator
 * opens this page to check: is it live, does it have an engine, what does it
 * run on, what do we charge, and did it work recently.
 *
 * The row is a join, not a new record. Name and route come from the feature
 * registry, status from the availability table, price from the service
 * catalogue, engine and model from `ai_tools`, and "last run" from the usage
 * ledger. Nothing on this page is a second copy of any of them.
 */
export default async function AdminAiToolsPage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const availability = await getAvailabilityMap(supabase);
  const rows = await readToolRegistry(supabase, availability);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.ai")}
        title={t("aicc.tools.title")}
        sub={t("aicc.tools.sub")}
      />
      <ToolRegistry rows={rows} locale={locale} />
    </div>
  );
}
