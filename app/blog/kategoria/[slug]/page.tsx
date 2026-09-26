import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { FALLBACK_OG_IMAGE, blogCategoryPath } from "@/lib/grovnews-blog";
import { blogChrome, getBlogFeed } from "@/lib/server/grovnews-blog";
import { BlogCards, BlogCategoryNav, BlogCta, BlogFrame, Breadcrumbs } from "@/components/grovnews/blog";

/**
 * One category of the public blog. A category with no published article (or
 * an inactive one) has no page — the list would be empty, so it is a 404.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [{ dict }, cards] = await Promise.all([getDictionary(), getBlogFeed(slug, 60)]);
  const name = cards[0]?.category?.name;
  if (!name) return {};
  const t = makeT(dict);
  const title = t("grovnews.blog.categoryMetaTitle", { name });
  const description = t("grovnews.blog.categoryDescription", { name });
  const path = blogCategoryPath(slug);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "GrovBase", url: path, title, description, images: [FALLBACK_OG_IMAGE] },
    twitter: { card: "summary", title, description },
  };
}

export default async function BlogCategoryPage({ params }: Params) {
  const { slug } = await params;
  const [cards, all, chrome] = await Promise.all([getBlogFeed(slug, 60), getBlogFeed(null, 60), blogChrome()]);
  const category = cards[0]?.category;
  if (!category) notFound();
  const { locale, t, signedIn, showAuth, shell } = chrome;
  return (
    <BlogFrame shell={shell}>
      <Breadcrumbs t={t} items={[
        { label: t("grovnews.blog.home"), href: "/" },
        { label: t("grovnews.blog.title"), href: "/blog" },
        { label: category.name },
      ]} />
      <header className="mb-6 max-w-2xl">
        <p className="overline">{t("grovnews.blog.title")}</p>
        <h1 className="mt-2 font-display text-[clamp(1.8rem,1.3rem+2vw,2.75rem)] font-bold leading-[1.1] tracking-tight">
          {category.name}
        </h1>
        <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{t("grovnews.blog.categoryDescription", { name: category.name })}</p>
      </header>
      <BlogCategoryNav cards={all} active={slug} t={t} />
      <BlogCards cards={cards} locale={locale} t={t} />
      <BlogCta signedIn={signedIn} showAuth={showAuth} t={t} />
    </BlogFrame>
  );
}
