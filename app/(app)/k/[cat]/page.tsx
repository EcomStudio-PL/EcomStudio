import { notFound, redirect } from "next/navigation";
import { categoryHref, findCategory } from "@/lib/categories";

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
 * NO GATE HERE, ON PURPOSE. The availability switch used to be checked in this
 * segment's layout, which meant a "Wkrótce" category showed the coming-soon
 * screen at the OLD address instead of forwarding. The destination applies
 * every switch itself — /tools is gated as a module, and a category section is
 * drawn only when the category's own switch allows it, badged when it is
 * "Wkrótce" — so forwarding first hides nothing that was hidden before.
 */
export default async function CategoryRedirect({ params }: { params: Promise<{ cat: string }> }) {
  const { cat } = await params;
  const category = findCategory(cat);
  if (!category) notFound();
  redirect(categoryHref(category));
}
