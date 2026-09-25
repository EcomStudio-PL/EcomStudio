import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { isUuid, readSources } from "@/lib/grovnews";
import { adminGetPost, listCategories } from "@/lib/services/grovnews";
import { GrovNewsArticle } from "@/components/grovnews/reader";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/** The article exactly as a subscriber will read it — including a draft,
 *  which is why this lives behind the admin layout and not under /grovnews. */
export default async function PreviewGrovNewsPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ dict, locale }, post, categories] = await Promise.all([getDictionary(), adminGetPost(supabase, id), listCategories(supabase)]);
  if (!post) notFound();
  const t = makeT(dict);
  const category = categories.find((c) => c.id === post.category_id);
  return (
    <div data-grovnews-preview>
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-[12.5px] text-muted">
        <Badge tone={post.status === "PUBLISHED" ? "success" : post.status === "ARCHIVED" ? "neutral" : "warning"}>
          {t(`grovnewsAdm.status.${post.status}`)}
        </Badge>
        {t("grovnewsAdm.previewNote")}
      </div>
      <GrovNewsArticle locale={locale} t={t} backHref={`/admin/newsletter/grovnews/wpisy/${post.id}`} article={{
        title: post.title, excerpt: post.excerpt, content: post.content, coverUrl: post.cover_url,
        publishedAt: post.published_at, readMinutes: post.estimated_read_minutes,
        category: category ? { slug: category.slug, name: category.name } : null,
        sources: readSources(post.sources), tags: post.tags ?? [],
      }} />
    </div>
  );
}
