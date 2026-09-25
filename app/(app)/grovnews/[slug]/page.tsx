import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { viewerIsAdmin } from "@/lib/server/feature-availability";
import { SLUG_RE } from "@/lib/grovnews";
import { getPublishedArticle, hasActiveGrovNewsAccess } from "@/lib/services/grovnews";
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
  const [{ dict, locale }, access, admin] = await Promise.all([
    getDictionary(), hasActiveGrovNewsAccess(supabase), viewerIsAdmin(supabase),
  ]);
  const t = makeT(dict);
  if (!access && !admin) return <GrovNewsLocked t={t} />;

  const article = await getPublishedArticle(supabase, slug);
  if (!article) notFound();
  return <GrovNewsArticle article={article} locale={locale} t={t} />;
}
