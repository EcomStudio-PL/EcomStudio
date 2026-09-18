import { createClient } from "@/lib/supabase/server";
import { LOCALES } from "@/lib/newsletter";
import {
  groupsOfContacts, listContacts, listGroups, listSources,
} from "@/lib/services/newsletter";
import { ContactList } from "@/components/admin/newsletter/contact-list";

/**
 * KONTAKTY — who is on the list and where they came from.
 *
 * EVERY FILTER LIVES IN THE URL AND EVERY QUERY RUNS IN POSTGRES. This list is
 * the one table in the product that can plausibly reach six figures, so nothing
 * here loads it in order to measure it, to search it or to page it: the browser
 * receives fifty rows and a count. A client-side filter would work beautifully
 * on the four hundred contacts production has today and would stop working on
 * the day the module finally matters.
 *
 * The URL also makes a view shareable and survivable: "wypisani z formularza na
 * stronie" is a link an operator can send to somebody, and a refresh does not
 * throw the filters away.
 *
 * THE HEADER AND THE SUB-NAV ARE THE LAYOUT'S. Every screen under
 * app/admin/newsletter inherits them, so a page that rendered its own would
 * show them twice.
 */

const PAGE_SIZE = 50;

/** The three answers `listContacts` understands. Anything else in the URL is
 *  somebody editing the query string, and is ignored rather than passed on to
 *  become an empty list with no explanation. */
const CONSENT_VALUES = new Set(["consented", "no_consent", "unsubscribed"]);

export default async function NewsletterContacts({ searchParams }: {
  searchParams: Promise<{
    q?: string; source?: string; group?: string;
    consent?: string; locale?: string; page?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const filter = {
    search: (params.q ?? "").trim() || undefined,
    sourceKey: params.source || undefined,
    groupId: params.group || undefined,
    consent: CONSENT_VALUES.has(params.consent ?? "") ? params.consent : undefined,
    locale: (LOCALES as readonly string[]).includes(params.locale ?? "")
      ? params.locale : undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const contacts = await listContacts(supabase, filter);

  // The group column and the two group filters need the same list, and the
  // memberships need the ids this page actually rendered — so they wait for
  // the page, and then all three go out together.
  const [sources, groups, memberships] = await Promise.all([
    listSources(supabase),
    listGroups(supabase),
    groupsOfContacts(supabase, contacts.rows.map((c) => c.id)),
  ]);

  return (
    <ContactList
      rows={contacts.rows}
      total={contacts.total}
      page={contacts.page}
      pages={Math.max(1, Math.ceil(contacts.total / contacts.pageSize))}
      sources={sources.map((s) => ({ key: s.key, name: s.name }))}
      // Dynamic groups are deliberately not offered as a filter or as a bulk
      // destination: a segment has no membership rows, so "add to this group"
      // has no list to add anybody to and filtering by one would silently
      // return nothing. They are edited as saved filters, on their own screen.
      groups={groups.filter((g) => !g.isDynamic).map((g) => ({ id: g.id, name: g.name }))}
      groupsByContact={Object.fromEntries(memberships)}
    />
  );
}
