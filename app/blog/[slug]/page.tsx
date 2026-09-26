import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { articleJsonLd, articleMetadata, jsonLdScript, relatedArticles } from "@/lib/grovnews-blog";
import { blogChrome, getBlogArticle, getBlogFeed } from "@/lib/server/grovnews-blog";
import { BlogArticleView, BlogCta, BlogFrame } from "@/components/grovnews/blog";

/**
 * ONE PUBLIC ARTICLE. Only a PUBLISHED one exists here — a draft, an archived
 * article or a wrong slug is a 404, not a preview (the preview lives behind
 * the admin panel). Nothing on this page comes from a premium post.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const article = await getBlogArticle(slug);
  return article ? articleMetadata(article) : {};
}

export default async function BlogArticlePage({ params }: Params) {
  const { slug } = await params;
  const [article, chrome, feed] = await Promise.all([
    getBlogArticle(slug), blogChrome(),
    // Related cards are optional: the article renders without them.
    getBlogFeed(null, 60).catch(() => []),
  ]);
  if (!article) notFound();
  const { locale, t, signedIn, showAuth, shell } = chrome;
  const jsonLd = articleJsonLd(article, { home: t("grovnews.blog.home"), blog: t("grovnews.blog.title") });
  return (
    <BlogFrame shell={shell}>
      <BlogArticleView article={article} related={relatedArticles(article, feed)} locale={locale} t={t}
        cta={<BlogCta signedIn={signedIn} showAuth={showAuth} t={t} />} />
      {/* Escaped by jsonLdScript: no stored text can close this element. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
    </BlogFrame>
  );
}
