import { createClient } from "@/lib/supabase/server";
import { listCategories } from "@/lib/services/grovnews";
import { BlogEditor } from "@/components/admin/grovnews/blog-editor";

export const dynamic = "force-dynamic";

/** A public article written from scratch — no premium post behind it. */
export default async function NewGrovNewsBlogArticle() {
  const supabase = await createClient();
  const categories = await listCategories(supabase);
  return (
    <BlogEditor categories={categories} article={{
      id: null, title: "", slug: "", excerpt: "", content: "", status: "DRAFT", categoryId: null, tags: [],
      coverUrl: null, coverAlt: null, sources: [], faq: [], relatedSlugs: [], language: "pl", schemaType: "Article",
      noindex: false, seoTitle: null, seoDescription: null, canonicalUrl: null, ogTitle: null, ogDescription: null,
      internalNote: null, publishedAt: null, source: null,
    }} />
  );
}
