import { createClient } from "@/lib/supabase/server";
import { adminGetSettings, adminRecentRuns, adminSchedulerStatus } from "@/lib/services/grovnews-research";
import { newsletterAiAvailable } from "@/lib/server/newsletter/ai";
import { serverTokenAvailable } from "@/lib/server/grovnews/store";
import { GROVNEWS_MODEL_OPTIONS, grovnewsProviderStatus } from "@/lib/server/grovnews/ai";
import { AutomationPanel } from "@/components/admin/grovnews/automation";

export const dynamic = "force-dynamic";
/** "Uruchom dzisiejszy cykl teraz" runs the daily job in this segment —
 *  fetching, analysis and drafting within its own budget (runDailyNowAction),
 *  so the segment needs the room. */
export const maxDuration = 300;

/**
 * GrovNews automation: the mode, the daily schedule and its thresholds, and
 * what the job did. The three health checks (scheduler, AI, server key) are
 * read here so the panel never offers a run the first click would refuse;
 * only booleans and the scheduler's last tick cross to the browser. So does
 * the AI choice's status (0128): whether each provider is on and holds a
 * usable key — never the key — and the model ids the platform's stack offers.
 */
export default async function GrovNewsAutomation() {
  const supabase = await createClient();
  const [settings, scheduler, runs, aiAvailable, providers] = await Promise.all([
    adminGetSettings(supabase),
    adminSchedulerStatus(supabase),
    adminRecentRuns(supabase, 14),
    newsletterAiAvailable(supabase),
    // 0128: per provider, on / has a usable key — booleans only, the key is
    // resolved and dropped on the server. Needs the server key to ask.
    serverTokenAvailable() ? grovnewsProviderStatus(supabase).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <div className="min-w-0" data-grovnews-automation>
      <AutomationPanel
        settings={settings}
        scheduler={scheduler}
        runs={runs}
        aiAvailable={aiAvailable}
        serverKey={serverTokenAvailable()}
        providers={providers}
        modelOptions={GROVNEWS_MODEL_OPTIONS}
      />
    </div>
  );
}
