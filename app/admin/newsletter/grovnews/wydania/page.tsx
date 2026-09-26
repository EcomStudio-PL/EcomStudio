import { createClient } from "@/lib/supabase/server";
import { adminListEditions } from "@/lib/services/grovnews-research";
import { EditionsList } from "@/components/admin/grovnews/editions";

export const dynamic = "force-dynamic";
/** "Zbuduj dzisiejsze wydanie" runs the edition builder in this segment. */
export const maxDuration = 300;

/**
 * The daily editions. Before listing, the editions are brought up to date
 * with their newsletter campaigns (a queued mail that finished becomes SENT
 * or FAILED) — best effort, and under the VIEWER'S OWN session with no server
 * token: the function answers only an admin, so a render that is not an
 * admin's (pages and layouts render in parallel) can trigger nothing. The
 * scheduler's tick does the same every ten minutes anyway.
 */
export default async function GrovNewsEditions() {
  const supabase = await createClient();
  await supabase.rpc("grovnews_editions_sync", { p_token: "" });
  const editions = await adminListEditions(supabase);
  return (
    <div className="min-w-0" data-grovnews-editions>
      <EditionsList editions={editions} />
    </div>
  );
}
