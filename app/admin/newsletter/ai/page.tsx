import { createClient } from "@/lib/supabase/server";
import { listCampaigns } from "@/lib/services/newsletter";
import { newsletterAiAvailable } from "@/lib/server/newsletter/ai";
import { AiPanel } from "@/components/admin/newsletter/ai-panel";

/**
 * AI STUDIO.
 *
 * THE AVAILABILITY CHECK HAPPENS HERE, ON THE SERVER, and it is a real one:
 * `newsletterAiAvailable` resolves the same provider chain the actions use —
 * an active provider, an adapter, and a credential that actually opens — so
 * the screen cannot claim to be ready while the first click fails. The panel
 * receives a boolean and nothing about how it was reached; no provider name,
 * no key, no base URL crosses to the browser.
 *
 * WHY THE CAMPAIGN LIST IS FETCHED EVEN THOUGH AI MIGHT BE OFF. It is one
 * indexed read, and skipping it would mean re-rendering the page the moment a
 * provider is configured. The unavailable state is a state of this screen, not
 * a different screen.
 *
 * `maxDuration` IS RAISED BECAUSE THE PERSONALISATION BATCH POSTS BACK HERE.
 * Server actions run in the route segment they were invoked from, and a batch
 * that spends forty-five seconds asking a model for openers needs more than the
 * platform's default. The action bounds itself well inside this ceiling and
 * reports what is left rather than relying on it — see
 * `generatePersonalizationAction` — but a ceiling below its own budget would
 * turn every long run into a dead request.
 *
 * No PageHeader and no nav: app/admin/newsletter/layout.tsx renders both for
 * all nine screens.
 */
export const maxDuration = 300;

/** Enough campaigns for the picker to be a picker. An operator with more than
 *  a hundred campaigns reaches this screen from inside the campaign they are
 *  working on, where the panel is embedded and needs no list at all. */
const CAMPAIGN_CHOICES = 100;

export default async function NewsletterAiPage() {
  const supabase = await createClient();

  const [available, campaigns] = await Promise.all([
    newsletterAiAvailable(supabase),
    listCampaigns(supabase, { pageSize: CAMPAIGN_CHOICES }),
  ]);

  return (
    <AiPanel
      available={available}
      campaigns={campaigns.rows.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
