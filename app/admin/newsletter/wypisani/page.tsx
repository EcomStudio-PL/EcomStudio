import { createClient } from "@/lib/supabase/server";
import { listSuppressions } from "@/lib/services/newsletter";
import { SuppressionList } from "@/components/admin/newsletter/suppression-list";

/**
 * WYPISANI I BLOKADY — the addresses nothing may reach, whatever else happens.
 *
 * This list is the module's last line, and it is checked at the LATEST possible
 * moment: `newsletter_queue_claim` re-reads it on every batch, so an address
 * landing here stops messages that are already queued rather than only future
 * ones. Nothing on this screen has to remember to enforce it.
 *
 * IT IS PAGED FOR THE SAME REASON THE CONTACT LIST IS. A suppression list grows
 * monotonically — nothing ever leaves it except by an operator's deliberate act
 * — so it is the one table here guaranteed to get bigger every month, and
 * loading all of it to show fifty rows would get slower forever.
 */

const PAGE_SIZE = 50;

export default async function NewsletterSuppressions({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const suppressions = await listSuppressions(supabase, { page, pageSize: PAGE_SIZE });

  return (
    <SuppressionList
      rows={suppressions.rows}
      total={suppressions.total}
      page={suppressions.page}
      pages={Math.max(1, Math.ceil(suppressions.total / suppressions.pageSize))}
    />
  );
}
