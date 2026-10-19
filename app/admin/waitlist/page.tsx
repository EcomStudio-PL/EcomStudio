import { redirect } from "next/navigation";

/**
 * THE WAITLIST SCREEN IS NOW THE CONTACT LIST, FILTERED.
 *
 * This page used to be a manager of its own: a table over
 * `waitlist_subscribers`, four counters and a search box. Migration 0097 made
 * every launch-page signup a newsletter contact with `source = waitlist`, so
 * the list it showed is a view of the list Newsletter → Kontakty already
 * renders — with a consent column, a group column and an account link the old
 * table never had.
 *
 * WHICH VIEW, SINCE THE PRE-LAUNCH LIST (0144). "The waitlist" now means the
 * people who CONFIRMED their address on the launch page — the double opt-in
 * list, read from prelaunch_signups. The old `source=waitlist` view answered a
 * different question (first source only: it shows the legacy rows that never
 * confirmed and misses a confirmed signup whose first source was an account),
 * so it is no longer the default — but it stays one parameter away, at
 * `/admin/waitlist?view=legacy`, and in the contact list's source filter.
 * `?view=pending` opens the people still waiting to confirm — what a
 * "new signup" notification is about, since it fires before the click.
 *
 * A REDIRECT RATHER THAN A DELETION, because the URL is in bookmarks, in at
 * least one Notion page, and behind the "Otwórz listę" button of the
 * `waitlist.signup` Telegram and admin-mail notifications. Landing on a 404
 * would read as "the waitlist was lost", which is exactly the opposite of what
 * happened to it.
 *
 * `replace: true` semantics come free with redirect() in a Server Component:
 * the old URL does not end up in history, so Back from the contact list goes
 * where the operator actually came from instead of bouncing them forward
 * again.
 */
export default async function AdminWaitlistRedirect({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  if (view === "legacy") redirect("/admin/newsletter/kontakty?source=waitlist");
  if (view === "pending") redirect("/admin/newsletter/kontakty?prelaunch=pending");
  redirect("/admin/newsletter/kontakty?prelaunch=confirmed");
}
