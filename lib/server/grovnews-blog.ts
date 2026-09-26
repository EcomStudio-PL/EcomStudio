import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getGlobalSections, getNavPages, getPublicSite } from "@/lib/server/public-site";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { SLUG_RE } from "@/lib/grovnews";
import { toBlogArticle, toBlogCard, type BlogArticle, type BlogCard } from "@/lib/grovnews-blog";

/**
 * READING THE PUBLIC BLOG — for everybody, signed in or not.
 *
 * Every read goes through the public database functions of migration 0124,
 * which hand out a PUBLISHED article and only the columns a page shows. There
 * is no other door here: nothing in this file queries a premium post, a
 * research item or an admin note (scripts/grovnews4-tests.ts holds it to that).
 *
 * The client is ANONYMOUS on purpose — a signed-in subscriber gets exactly
 * what a crawler gets, and nothing user-scoped can land in the shared cache.
 * Admin writes clear BLOG_TAG (app/actions/grovnews-blog.ts), so a publish is
 * live at once; the five minutes are only the ceiling for a missed clear.
 */

export const BLOG_TAG = "grovnews-blog";

const anon = () => createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** The /blog list, newest first; one category when `category` is set. */
export const getBlogFeed = unstable_cache(
  async (category: string | null, limit: number): Promise<BlogCard[]> => {
    if (category !== null && !SLUG_RE.test(category)) return [];
    const { data, error } = await anon().rpc("grovnews_public_feed", { p_limit: limit, p_category: category });
    if (error || !Array.isArray(data)) return [];
    return data.map(toBlogCard).filter((c): c is BlogCard => c !== null);
  },
  ["grovnews-blog-feed"],
  { revalidate: 300, tags: [BLOG_TAG] },
);

/** One published article, or null — a draft is not "coming soon", it is not there. */
export const getBlogArticle = unstable_cache(
  async (slug: string): Promise<BlogArticle | null> => {
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    const { data, error } = await anon().rpc("grovnews_public_article", { p_slug: slug });
    if (error || !data) return null;
    return toBlogArticle(data);
  },
  ["grovnews-blog-article"],
  { revalidate: 300, tags: [BLOG_TAG] },
);

export type BlogSitemapEntry = { slug: string; lastModified: string; canonicalUrl: string | null };

/** Published, indexable articles for the sitemap (noindex already excluded). */
export const getBlogSitemap = unstable_cache(
  async (): Promise<BlogSitemapEntry[]> => {
    const { data, error } = await anon().rpc("grovnews_public_sitemap");
    if (error || !Array.isArray(data)) return [];
    return (data as { slug: unknown; last_modified: unknown; canonical_url: unknown }[])
      .filter((r) => typeof r.slug === "string" && SLUG_RE.test(r.slug))
      .map((r) => ({
        slug: r.slug as string,
        lastModified: typeof r.last_modified === "string" ? r.last_modified : "",
        canonicalUrl: typeof r.canonical_url === "string" && r.canonical_url ? r.canonical_url : null,
      }));
  },
  ["grovnews-blog-sitemap"],
  { revalidate: 300, tags: [BLOG_TAG] },
);

/**
 * The frame every /blog page wears — the public site's own header, footer and
 * announcement bar (components/cms/site-shell), exactly as app/[slug] builds
 * it. `signedIn` also decides where the GrovNews call to action points.
 */
export async function blogChrome() {
  const supabase = await createClient();
  const [access, { data: { user } }, global, nav, site, { dict, locale }] = await Promise.all([
    getPlatformAccess(supabase),
    supabase.auth.getUser(),
    getGlobalSections(),
    getNavPages(),
    getPublicSite(supabase),
    getDictionary(),
  ]);
  const t = makeT(dict);
  const signedIn = Boolean(user);
  return {
    locale, t, signedIn, showAuth: access.showAuthEntry,
    shell: { global, nav, site, locale, t, showAuth: access.showAuthEntry, signedIn },
  };
}
