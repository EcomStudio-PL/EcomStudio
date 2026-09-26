import { createClient } from "@/lib/supabase/server";
import { listCategories } from "@/lib/services/grovnews";
import { adminListSources, sourceHealthSummary } from "@/lib/services/grovnews-research";
import { sourceSecretName } from "@/lib/server/grovnews/api";
import { secretStatuses } from "@/lib/server/secret-store";
import { SourcesManager, type SourceSecretState } from "@/components/admin/grovnews/sources";

export const dynamic = "force-dynamic";

/**
 * GrovNews sources: where the daily research reads from.
 *
 * `maxDuration` is raised because "fetch now" and "test" run here: server
 * actions execute in the route segment that invoked them, and reading every
 * enabled source is bounded by its own budget (see ingestNowAction), not by
 * the platform's default ceiling.
 *
 * 0128: the health summary line is computed by the same service the Pulpit
 * uses (real counts), and for API sources that authenticate, whether a secret
 * is stored and its last four characters — cut in the database, read here on
 * the server; the secret itself never reaches the page.
 */
export const maxDuration = 300;

export default async function GrovNewsSources() {
  const supabase = await createClient();
  const [sources, categories, summary] = await Promise.all([
    adminListSources(supabase), listCategories(supabase), sourceHealthSummary(supabase),
  ]);
  const withAuth = sources.filter((s) => s.type === "API" && s.authKind !== "none");
  const statuses = await secretStatuses(supabase, withAuth.map((s) => sourceSecretName(s.id)));
  const secrets: Record<string, SourceSecretState> = {};
  for (const s of withAuth) {
    const st = statuses.get(sourceSecretName(s.id));
    secrets[s.id] = { configured: st?.configured === true, lastFour: st?.lastFour ?? null };
  }
  return (
    <div className="min-w-0" data-grovnews-sources>
      <SourcesManager sources={sources} categories={categories} summary={summary} secrets={secrets} />
    </div>
  );
}
