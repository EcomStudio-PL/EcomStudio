import { createClient } from "@/lib/supabase/server";
import { CAMPAIGN_STATUSES } from "@/lib/newsletter";
import { campaignPerformance, listCampaigns } from "@/lib/services/newsletter";
import { CampaignList } from "@/components/admin/newsletter/campaign-list";

/**
 * KAMPANIE — what was sent and what came of it.
 *
 * THE NUMBERS COME FROM ONE AGGREGATE, NOT FROM TWENTY-FIVE. `campaignStats`
 * answers "how did this campaign do" in three reads, and the obvious way to
 * fill a table with it is to call it per row — which is seventy-five round
 * trips for one page of a list an operator opens constantly.
 * `campaignPerformance` exists precisely because that does not scale: three
 * reads, grouped in memory, whatever the page size.
 *
 * THE WINDOW IS ALL OF TIME, and that is the one place this screen differs
 * from Analityka. Analytics asks "what happened in the last thirty days" and
 * is right to; a campaign LIST is a register of everything that was ever sent,
 * and a row whose click count silently excluded last quarter would be a number
 * nobody could reconcile with the campaign's own report. `campaignPerformance`
 * filters on activity timestamps, so an epoch-to-now window simply means "no
 * filter" without inventing a second function that says so.
 *
 * A CAMPAIGN WITH NO ACTIVITY IS NOT IN THE AGGREGATE AT ALL — a draft has no
 * recipients, no events and no attributions. That is not a gap to paper over:
 * the list component defaults those rows to zero counts and unknown rates, so
 * a draft reads as "nothing has happened yet" rather than as a missing row.
 *
 * The header and the sub-navigation belong to app/admin/newsletter/layout.tsx;
 * a page that rendered its own would show them twice.
 */

const PAGE_SIZE = 25;

/** The epoch as an ISO instant: "no lower bound", spelled in the one type
 *  `campaignPerformance` accepts. */
const ALL_TIME = "1970-01-01T00:00:00.000Z";

export default async function NewsletterCampaigns({ searchParams }: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // Anything else in the query string is somebody editing the URL. Passing it
  // through would produce an empty list with no explanation, so it is dropped
  // and the unfiltered list is served instead.
  const status = (CAMPAIGN_STATUSES as readonly string[]).includes(params.status ?? "")
    ? params.status : undefined;

  const [campaigns, performance] = await Promise.all([
    listCampaigns(supabase, { status, page, pageSize: PAGE_SIZE }),
    campaignPerformance(supabase, ALL_TIME, new Date().toISOString()),
  ]);

  return (
    <CampaignList
      rows={campaigns.rows}
      performance={performance}
      total={campaigns.total}
      page={campaigns.page}
      pages={Math.max(1, Math.ceil(campaigns.total / campaigns.pageSize))}
      status={status}
    />
  );
}
