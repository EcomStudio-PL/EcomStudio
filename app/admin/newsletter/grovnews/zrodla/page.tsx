import { createClient } from "@/lib/supabase/server";
import { listCategories } from "@/lib/services/grovnews";
import { adminListSources } from "@/lib/services/grovnews-research";
import { SourcesManager } from "@/components/admin/grovnews/sources";

export const dynamic = "force-dynamic";

/**
 * GrovNews sources: where the daily research reads from.
 *
 * `maxDuration` is raised because "fetch now" and "test" run here: server
 * actions execute in the route segment that invoked them, and reading every
 * enabled source is bounded by its own budget (see ingestNowAction), not by
 * the platform's default ceiling.
 */
export const maxDuration = 300;

export default async function GrovNewsSources() {
  const supabase = await createClient();
  const [sources, categories] = await Promise.all([adminListSources(supabase), listCategories(supabase)]);
  return (
    <div className="min-w-0" data-grovnews-sources>
      <SourcesManager sources={sources} categories={categories} />
    </div>
  );
}
