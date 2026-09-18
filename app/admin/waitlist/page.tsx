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
 * A REDIRECT RATHER THAN A DELETION, because the URL is in bookmarks and in
 * at least one Notion page. Landing on a 404 would read as "the waitlist was
 * lost", which is exactly the opposite of what happened to it.
 *
 * `replace: true` semantics come free with redirect() in a Server Component:
 * the old URL does not end up in history, so Back from the contact list goes
 * where the operator actually came from instead of bouncing them forward
 * again.
 */
export default function AdminWaitlistRedirect() {
  redirect("/admin/newsletter/kontakty?source=waitlist");
}
