import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  audienceBreakdown, campaignStats, getCampaign, listContacts, listGroups, listSteps,
  personalizedRecipientCount,
} from "@/lib/services/newsletter";
import { newsletterAiAvailable } from "@/lib/server/newsletter/ai";
import { campaignStatusTone } from "@/components/admin/newsletter/kpi";
import { CampaignWizard } from "@/components/admin/newsletter/campaign-wizard";

/**
 * ONE CAMPAIGN — everything the editor needs, fetched once, on the server.
 *
 * THE EDITOR IS A CLIENT COMPONENT AND THE READING IS NOT. Six steps of an
 * editor are genuinely interactive, so the wizard runs in the browser; but
 * nothing it needs to OPEN with should arrive as a spinner. The audience
 * breakdown in particular is a real count across three tables, and computing
 * it here means step 1 paints with the true numbers for the saved audience
 * instead of flickering from zeroes to the answer.
 *
 * `audienceBreakdown` ALSO RETURNS THE CONTACT IDS, and they are dropped here
 * on purpose — the same decision `audiencePreviewAction` makes. The editor
 * needs seven numbers; shipping a few thousand uuids into a client component
 * would put the whole mailing list in the page's serialised props for no
 * benefit at all.
 *
 * THE "PODGLĄD JAKO" LIST IS CONSENTED CONTACTS ONLY, and capped. It exists so
 * an operator can see their merge tags resolve against a real person; offering
 * somebody who has withdrawn consent would invite rendering a mail for a
 * contact this campaign can never reach, which is a confusing thing to be
 * looking at while deciding whether to send.
 *
 * The header and sub-navigation come from the module layout; this page adds
 * the campaign's own name row inside the wizard rather than a second
 * PageHeader.
 */

/** Enough to pick somebody recognisable from, without turning a dropdown into
 *  a directory. The list is for spot-checking merge tags, not for browsing. */
const PREVIEW_CONTACTS = 50;

export default async function NewsletterCampaign({ params }: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Everything else depends on the campaign existing — including
  // `audienceBreakdown`, which needs its audience — so this one read happens
  // first and a 404 costs exactly one query.
  const campaign = await getCampaign(supabase, id);
  if (!campaign) notFound();

  const [steps, groups, breakdown, stats, contacts, personalized, aiAvailable] =
    await Promise.all([
      listSteps(supabase, id),
      listGroups(supabase),
      audienceBreakdown(supabase, campaign.audience),
      campaignStats(supabase, id),
      listContacts(supabase, { consent: "consented", pageSize: PREVIEW_CONTACTS }),
      personalizedRecipientCount(supabase, id),
      // Asked here rather than inside the AI panel for the reason every other
      // read on this page is: the step must open knowing whether AI is usable,
      // so it can say "no provider is configured" instead of offering buttons
      // that fail when pressed.
      newsletterAiAvailable(supabase),
    ]);

  const { ids: _ids, ...audience } = breakdown;

  return (
    <CampaignWizard
      campaign={campaign}
      steps={steps}
      groups={groups.map((group) => ({
        id: group.id,
        name: group.name,
        isDynamic: group.isDynamic,
        members: group.members,
      }))}
      breakdown={audience}
      stats={stats}
      contacts={contacts.rows.map((contact) => ({
        id: contact.id,
        email: contact.email,
        name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
      }))}
      personalizedCount={personalized}
      statusTone={campaignStatusTone(campaign.status)}
      aiAvailable={aiAvailable}
    />
  );
}
