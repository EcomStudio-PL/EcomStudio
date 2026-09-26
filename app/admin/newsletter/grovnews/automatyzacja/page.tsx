import { createClient } from "@/lib/supabase/server";
import { adminGetSettings, adminRecentRuns, adminSchedulerStatus } from "@/lib/services/grovnews-research";
import { newsletterAiAvailable } from "@/lib/server/newsletter/ai";
import { serverTokenAvailable } from "@/lib/server/grovnews/store";
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
 * only booleans and the scheduler's last tick cross to the browser.
 */
export default async function GrovNewsAutomation() {
  const supabase = await createClient();
  const [settings, scheduler, runs, aiAvailable] = await Promise.all([
    adminGetSettings(supabase),
    adminSchedulerStatus(supabase),
    adminRecentRuns(supabase, 14),
    newsletterAiAvailable(supabase),
  ]);
  return (
    <div className="min-w-0" data-grovnews-automation>
      <AutomationPanel
        settings={settings}
        scheduler={scheduler}
        runs={runs}
        aiAvailable={aiAvailable}
        serverKey={serverTokenAvailable()}
      />
    </div>
  );
}
