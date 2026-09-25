import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { isFeatureKey } from "@/lib/features";
import { readBillingServices, readPickableModels, readToolRegistry } from "@/lib/services/ai-tools";
import { clientPreviewStateAction, listFeatureAvailabilityAction } from "@/app/actions/features";
import { PageHeader } from "@/components/ui/page-header";
import { ToolRegistry, type PanelEntry } from "@/components/admin/tool-registry";

export const dynamic = "force-dynamic";

/**
 * AI I GENEROWANIE → NARZĘDZIA I SILNIKI.
 *
 * Every tool, category and module on one screen, with what an operator opens
 * it to check or change: what it runs on, what it costs, whether it is live,
 * and where a customer meets it. "Dostępność funkcji" used to be a second
 * screen for the status half; it redirects here now.
 *
 * The row is a join, not a new record. Name and route come from the feature
 * registry, status and visibility from the availability table, price from the
 * service catalogue, engine and model from `ai_tools`, and "last run" from the
 * usage ledger. Nothing on this page is a second copy of any of them.
 */
export default async function AdminAiToolsPage({ searchParams }: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  // The registry needs the switchboard; everything else is independent, so
  // it all runs at once rather than the registry waiting behind the rest.
  const availP = getAvailabilityMap(supabase);
  const [availability, tools, adminRows, previewing, models, services] = await Promise.all([
    availP,
    availP.then((a) => readToolRegistry(supabase, a)),
    listFeatureAvailabilityAction(),
    clientPreviewStateAction(),
    readPickableModels(supabase),
    readBillingServices(supabase),
  ]);
  const toolByKey = new Map<string, (typeof tools)[number]>(tools.map((r) => [r.key, r]));

  const entries: PanelEntry[] = (adminRows ?? []).map((admin) => ({
    admin,
    tool: toolByKey.get(admin.key) ?? null,
  }));

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.ai")}
        title={t("aicc.tools.title")}
        sub={t("aicc.tools.sub")}
      />
      {adminRows ? (
        <ToolRegistry entries={entries} availability={availability} models={models} services={services}
          previewing={previewing} locale={locale}
          openKey={tool && isFeatureKey(tool) ? tool : null} />
      ) : (
        <p className="text-sm text-muted">{t("common.error")}</p>
      )}
    </div>
  );
}
