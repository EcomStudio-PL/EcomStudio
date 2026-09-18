import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { campaignBriefs, listGroups, listSources } from "@/lib/services/newsletter";
import { GroupList } from "@/components/admin/newsletter/group-list";

/**
 * GRUPY I SEGMENTY.
 *
 * Three reads, one round trip. The groups are the screen; the sources and the
 * campaigns are there only so the segment builder's conditions can be PICKED
 * rather than typed — a `source` condition stores a source key and a
 * `clicked_campaign` condition stores a campaign id, and a hand-typed one of
 * either saves cleanly and then matches nobody, with nothing in the stack to
 * say why. Fetching them here rather than inside the builder keeps the modal
 * from opening empty and filling in afterwards.
 *
 * NOTHING HERE COUNTS A SEGMENT. `listGroups` returns members = -1 for a
 * dynamic group on purpose, and this page does not improve on that: resolving
 * every segment on load is up to twelve contact-table queries per segment
 * before the first pixel, for a number nobody has asked for yet. The count
 * arrives when an operator presses "Przelicz", and it is the real one.
 *
 * No PageHeader and no nav: app/admin/newsletter/layout.tsx renders both.
 */
export default async function NewsletterGroupsPage() {
  const supabase = await createClient();
  const { locale } = await getDictionary();

  const [groups, sources, campaigns] = await Promise.all([
    listGroups(supabase),
    listSources(supabase),
    campaignBriefs(supabase),
  ]);

  return (
    <GroupList
      groups={groups}
      sources={sources.map((s) => ({ value: s.key, label: s.name }))}
      campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))}
      locale={locale}
    />
  );
}
