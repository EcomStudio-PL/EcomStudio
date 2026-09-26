import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid, readSources } from "@/lib/grovnews";
import { adminGetPost, listCategories } from "@/lib/services/grovnews";
import { adminPublicArticleForPost } from "@/lib/services/grovnews-blog";
import { PostEditor } from "@/components/admin/grovnews/post-editor";

export const dynamic = "force-dynamic";

export default async function EditGrovNewsPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [post, categories, publicId] = await Promise.all([
    adminGetPost(supabase, id), listCategories(supabase), adminPublicArticleForPost(supabase, id),
  ]);
  if (!post) notFound();
  return (
    <PostEditor key={post.updated_at} categories={categories} publicId={publicId} post={{
      id: post.id, title: post.title, slug: post.slug, excerpt: post.excerpt, content: post.content,
      categoryId: post.category_id, tags: post.tags ?? [], coverUrl: post.cover_url, sources: readSources(post.sources),
      readMinutes: post.estimated_read_minutes, language: post.language, status: post.status,
      emailSummary: post.email_summary, seoTitle: post.seo_title, seoDescription: post.seo_description,
    }} />
  );
}
