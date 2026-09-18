import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import {
  campaignPerformance, dashboardTotals, listSources, queueDepth,
} from "@/lib/services/newsletter";
import { readSettings } from "@/lib/server/newsletter/settings";
import { formatWindow, resolveRange } from "@/lib/newsletter";
import { Dashboard } from "@/components/admin/newsletter/dashboard";

/** How many campaigns the summary panel shows. Five is the number that fits
 *  beside the sources panel without either side scrolling; the rest of the
 *  list is one click away on Analityka. */
const TOP_CAMPAIGNS = 5;

/**
 * PULPIT — the newsletter module's first screen.
 *
 * THE PAGE FETCHES, THE COMPONENTS RENDER. Every read starts in the same
 * `Promise.all`, so the screen costs one round trip rather than one per panel:
 * a dashboard assembled from six components that each await their own query is
 * a waterfall the operator watches assemble itself.
 *
 * THE RANGE COMES FROM THE URL, not from component state, which is what makes
 * this page linkable — "look at last week" is a link somebody can paste into
 * chat — and what lets it be server-rendered at all. `resolveRange` is the one
 * place the boundaries are decided, and the same function feeds the picker's
 * caption, so the control can never claim a window the queries did not use.
 *
 * No PageHeader and no nav here: app/admin/newsletter/layout.tsx renders both
 * for all nine screens, and a page that adds its own gets two of each.
 */
export default async function NewsletterDashboardPage({ searchParams }: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { locale } = await getDictionary();

  const range = resolveRange(params);
  const [totals, queued, settings, campaigns, sources] = await Promise.all([
    dashboardTotals(supabase, range.since, range.until),
    queueDepth(supabase),
    readSettings(supabase),
    campaignPerformance(supabase, range.since, range.until),
    listSources(supabase),
  ]);

  return (
    <Dashboard
      effective={formatWindow(range, locale)}
      totals={totals}
      queued={queued}
      settings={settings}
      campaigns={campaigns.slice(0, TOP_CAMPAIGNS)}
      sources={sources}
    />
  );
}
