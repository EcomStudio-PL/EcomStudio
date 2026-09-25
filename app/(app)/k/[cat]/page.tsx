import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { routeReachable } from "@/lib/features";
import { categoryHref, categoryPath, findCategory } from "@/lib/categories";

/**
 * THE OLD CATEGORY PAGE — now a forwarding address.
 *
 * /k/<slug> used to be the category's own landing page: its workflows as a
 * grid of cards, a header, a "how it works" strip. Every one of those
 * workflows is now a card in the category's SECTION of /tools, which holds
 * every tool the product has, so this page would be a second screen listing
 * the same tools. It forwards there instead — `/tools?category=<slug>` opens
 * that section — and nothing that ever linked here (a bookmark, a shared URL,
 * a search result, the public homepage) ends on a dead screen.
 *
 * `redirect()` from a page replaces the history entry on a client navigation,
 * so Back from the hub does not bounce through this address again.
 *
 * WHAT STAYS UNDER /k/<slug>: the workflows themselves, /k/<slug>/<workflow>,
 * with their own gate (./[wf]/layout.tsx). An unknown slug is still a 404, as
 * it always was — this forwards categories, not arbitrary strings.
 *
 * NO COMING-SOON SCREEN HERE, ON PURPOSE. The availability switch used to be
 * checked in this segment's layout, which meant a "Wkrótce" category showed the
 * coming-soon screen at the OLD address instead of forwarding. The destination
 * applies every switch itself — /tools is gated as a module, and a category
 * section is drawn only when the category's own switch allows it, badged (and
 * carrying the operator's own words) when it is "Wkrótce" or in maintenance.
 *
 * ONE ANSWER STAYS HERE: a DISABLED category does not exist for a customer, and
 * its old address keeps answering 404 exactly as it did — not a forward to a
 * hub that would then quietly show nothing. Admins are forwarded as always.
 *
 * AND THIS IS THE ONE ADDRESS EVERY CATEGORY LINK MAY USE. The menus link to
 * the section directly and hide themselves when the hub is switched off; the
 * links that cannot ask the switchboard — the search palette, the public
 * homepage, a workflow's "back" — come through here, and this decides for
 * them. With the hub DISABLED a forward would be a 404 from an in-app link,
 * so it lands on the dashboard instead. A hub that is merely "Wkrótce" or in
 * maintenance is still forwarded to: its own screen explains itself, which is
 * how every restricted module in the product behaves.
 */
export default async function CategoryRedirect({ params }: { params: Promise<{ cat: string }> }) {
  const { cat } = await params;
  const category = findCategory(cat);
  if (!category) notFound();
  const supabase = await createClient();
  const [avail, isAdmin] = await Promise.all([getAvailabilityMap(supabase), viewerIsAdmin(supabase)]);
  if (!routeReachable(avail, categoryPath(category), isAdmin)) notFound();
  if (!routeReachable(avail, "/tools", isAdmin)) redirect("/home");
  redirect(categoryHref(category));
}
