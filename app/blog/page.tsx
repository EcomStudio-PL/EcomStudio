import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { FALLBACK_OG_IMAGE } from "@/lib/grovnews-blog";
import { blogChrome, getBlogFeed } from "@/lib/server/grovnews-blog";
import { BlogCards, BlogCategoryNav, BlogCta, BlogFrame } from "@/components/grovnews/blog";

/**
 * /blog — GrovNews' PUBLIC articles, newest first. Separate documents from the
 * premium posts (migration 0124), read through the public functions only; the
 * premium feed stays at /grovnews behind its access check.
 */

const FEED_SIZE = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [{ dict }, cards] = await Promise.all([getDictionary(), getBlogFeed(null, FEED_SIZE)]);
  const t = makeT(dict);
  const title = t("grovnews.blog.metaTitle");
  const description = t("grovnews.blog.metaDescription");
  return {
    title,
    description,
    alternates: { canonical: "/blog" },
    // An empty list is not a page worth indexing yet (and the sitemap leaves
    // it out until the first article is published).
    ...(cards.length === 0 ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "GrovBase", url: "/blog", title, description, images: [FALLBACK_OG_IMAGE] },
    twitter: { card: "summary", title, description },
  };
}

export default async function BlogIndex() {
  const [{ locale, t, signedIn, showAuth, shell }, cards] = await Promise.all([blogChrome(), getBlogFeed(null, FEED_SIZE)]);
  return (
    <BlogFrame shell={shell}>
      <header className="mb-6 max-w-2xl">
        <p className="overline">{t("grovnews.title")}</p>
        <h1 className="mt-2 font-display text-[clamp(1.8rem,1.3rem+2vw,2.75rem)] font-bold leading-[1.1] tracking-tight">
          {t("grovnews.blog.title")}
        </h1>
        <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{t("grovnews.blog.sub")}</p>
      </header>
      <BlogCategoryNav cards={cards} active={null} t={t} />
      <BlogCards cards={cards} locale={locale} t={t} />
      <BlogCta signedIn={signedIn} showAuth={showAuth} t={t} />
    </BlogFrame>
  );
}
