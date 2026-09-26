import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { formatMoney } from "@/lib/grovnews-billing";
import { ensureLaunchBonus } from "@/lib/server/grovnews-billing";
import { viewerIsAdmin } from "@/lib/server/feature-availability";
import { SLUG_RE } from "@/lib/grovnews";
import { getGrovNewsOffer, getPublishedArticle, hasActiveGrovNewsAccess } from "@/lib/services/grovnews";
import { GrovNewsArticle, GrovNewsLocked } from "@/components/grovnews/reader";

export const dynamic = "force-dynamic";

/** No title in the metadata: a locked visitor must not learn the headline
 *  from the tab either. */
export const metadata: Metadata = { title: "GrovNews", robots: { index: false } };

/**
 * ONE ARTICLE. The same order as the feed: the entitlement is checked before
 * the post is read, so a direct link from someone without access yields the
 * locked screen and no content. A draft or an archived post is a 404 for
 * everyone here, the admin included — they preview drafts from the panel.
 */
export default async function GrovNewsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const supabase = await createClient();
  // A launch-campaign claim that is due (survey done before the campaign went
  // live) lands before access is asked; after the first claim this is a no-op.
  await ensureLaunchBonus(supabase);
  const [{ dict, locale }, access, admin] = await Promise.all([
    getDictionary(), hasActiveGrovNewsAccess(supabase), viewerIsAdmin(supabase),
  ]);
  const t = makeT(dict);
  if (!access && !admin) return <GrovNewsLocked t={t} offer={await lockedOffer(supabase, locale)} />;

  const article = await getPublishedArticle(supabase, slug);
  if (!article) notFound();
  return <GrovNewsArticle article={article} locale={locale} t={t} />;
}

/** The price on the locked screen — only when GrovNews Premium is on sale. */
async function lockedOffer(supabase: Awaited<ReturnType<typeof createClient>>, locale: string) {
  const offer = await getGrovNewsOffer(supabase);
  return offer ? { price: formatMoney(offer.priceCents, offer.currency, locale) } : null;
}
