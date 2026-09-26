import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/grovnews";
import { listCategories } from "@/lib/services/grovnews";
import { adminGetPublicArticle } from "@/lib/services/grovnews-blog";
import { BlogEditor } from "@/components/admin/grovnews/blog-editor";

export const dynamic = "force-dynamic";

export default async function EditGrovNewsBlogArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [article, categories] = await Promise.all([adminGetPublicArticle(supabase, id), listCategories(supabase)]);
  if (!article) notFound();
  return <BlogEditor key={article.updatedAt} categories={categories} article={article} />;
}
