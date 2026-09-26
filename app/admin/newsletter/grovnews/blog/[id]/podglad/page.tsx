import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { isUuid } from "@/lib/grovnews";
import { listCategories } from "@/lib/services/grovnews";
import { adminGetPublicArticle } from "@/lib/services/grovnews-blog";
import { toBlogArticle } from "@/lib/grovnews-blog";
import { BlogArticleView } from "@/components/grovnews/blog";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The public article exactly as /blog will show it — including a DRAFT, which
 * is why this lives behind the admin layout (role checked there, RLS under it)
 * and not at a guessable public address.
 */
export default async function PreviewGrovNewsBlogArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ dict, locale }, a, categories] = await Promise.all([getDictionary(), adminGetPublicArticle(supabase, id), listCategories(supabase)]);
  if (!a) notFound();
  const t = makeT(dict);
  const category = categories.find((c) => c.id === a.categoryId);
  // The same shape the public function returns, so the page renders it the
  // same way; an unpublished article previews with "now" as its date.
  const article = toBlogArticle({
    slug: a.slug, title: a.title, excerpt: a.excerpt, content: a.content, cover_url: a.coverUrl, cover_alt: a.coverAlt,
    tags: a.tags, sources: a.sources, faq: a.faq, related_slugs: a.relatedSlugs, seo_title: a.seoTitle,
    seo_description: a.seoDescription, canonical_url: a.canonicalUrl, og_title: a.ogTitle, og_description: a.ogDescription,
    noindex: a.noindex, language: a.language, schema_type: a.schemaType,
    published_at: a.publishedAt ?? new Date().toISOString(), updated_at: a.updatedAt, read_minutes: a.readMinutes,
    category: category ? { slug: category.slug, name: category.name } : null,
  });
  if (!article) notFound();
  return (
    <div data-grovnews-blog-preview>
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-[12.5px] text-muted">
        <Badge tone={a.status === "PUBLISHED" ? "success" : a.status === "ARCHIVED" ? "neutral" : "warning"}>
          {t(`grovnewsAdm.status.${a.status}`)}
        </Badge>
        {t("grovnewsAdm.blog.previewNote")}
      </div>
      <BlogArticleView article={article} related={[]} locale={locale} t={t} />
    </div>
  );
}
