import { createClient } from "@/lib/supabase/server";
import {
  RESEARCH_FILTERS, adminListResearch, adminListSources, adminResearchCounts, type ResearchFilter,
} from "@/lib/services/grovnews-research";
import { newsletterAiAvailable } from "@/lib/server/newsletter/ai";
import { ResearchInbox } from "@/components/admin/grovnews/research";

export const dynamic = "force-dynamic";
/** "Analizuj nowe" and "Utwórz draft" call a model, "Pobierz źródła" reads
 *  the sources — server actions run in this segment, so it needs the room. */
export const maxDuration = 300;

/**
 * The research inbox: what the sources brought in, what the AI made of it,
 * and the admin's decisions. The AI check is the newsletter's own (a real
 * provider chain), so the buttons cannot promise what the first click
 * would refuse; only a boolean crosses to the browser.
 */
export default async function GrovNewsResearch({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f: raw } = await searchParams;
  const filter: ResearchFilter = (RESEARCH_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ResearchFilter) : "inbox";
  const supabase = await createClient();
  const [items, counts, sources, aiAvailable] = await Promise.all([
    adminListResearch(supabase, filter),
    adminResearchCounts(supabase),
    adminListSources(supabase),
    newsletterAiAvailable(supabase),
  ]);
  return (
    <div className="min-w-0" data-grovnews-research>
      <ResearchInbox
        filter={filter}
        filters={RESEARCH_FILTERS}
        counts={counts}
        items={items}
        sources={sources.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }))}
        aiAvailable={aiAvailable}
      />
    </div>
  );
}
