import { createClient } from "@/lib/supabase/server";
import {
  campaignBriefs, listAutomations, listGroups, listSources, stepSummaries,
  type StepSummary,
} from "@/lib/services/newsletter";
import { AutomationList } from "@/components/admin/newsletter/automation-list";

/**
 * AUTOMATYZACJE.
 *
 * FOUR READS IN ONE ROUND TRIP, THEN A FIFTH THAT DEPENDS ON THEM. The steps
 * query needs the campaign ids, and those come out of the first batch, so it
 * cannot join the `Promise.all` — but it is still ONE query for every sequence
 * on the screen rather than one per rule. `stepSummaries` exists for exactly
 * that: `listSteps` would answer the same question per campaign and would drag
 * the full body of every mailing across the wire so this page can print
 * "+3 dni" next to each message.
 *
 * WHICH CAMPAIGNS ARE FETCHED, AND WHY ALL OF THEM. The list needs the steps of
 * the sequences the rules point at; the form needs every campaign an operator
 * could choose. Asking for the union would mean two queries and a screen whose
 * dropdown and whose rows disagree about what exists, so `campaignBriefs` reads
 * both at once — names and flags only, never a body.
 *
 * ONLY STATIC GROUPS REACH THE FORM. "Kontakt trafia do grupy" is an event on
 * `newsletter_group_members`, and a dynamic segment has no rows there: its
 * membership is recomputed from a filter every time it is used, so nobody ever
 * "joins" one. Offering segments in that picker would let an operator build a
 * rule that cannot fire even once the dispatcher exists.
 *
 * No PageHeader and no nav: app/admin/newsletter/layout.tsx renders both.
 */
export default async function NewsletterAutomationsPage() {
  const supabase = await createClient();

  const [automations, campaigns, groups, sources] = await Promise.all([
    listAutomations(supabase),
    campaignBriefs(supabase),
    listGroups(supabase),
    listSources(supabase),
  ]);

  const steps = await stepSummaries(supabase, campaigns.map((c) => c.id));

  // A Map crosses the server/client boundary, but a plain object is what the
  // component indexes by campaign id and what every other screen in this module
  // passes down. One shape, decided here rather than at the call site.
  const stepsByCampaign: Record<string, StepSummary[]> = {};
  for (const [campaignId, rows] of steps) stepsByCampaign[campaignId] = rows;

  return (
    <AutomationList
      automations={automations}
      campaigns={campaigns}
      steps={stepsByCampaign}
      groups={groups.filter((g) => !g.isDynamic).map((g) => ({ value: g.id, label: g.name }))}
      sources={sources.map((s) => ({ value: s.key, label: s.name }))}
    />
  );
}
