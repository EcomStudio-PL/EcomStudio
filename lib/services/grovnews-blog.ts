import type { Client } from "./workspace";
import { readSources } from "@/lib/grovnews";
import { articleSeoChecks, readFaq, type FaqItem } from "@/lib/grovnews-blog";

/**
 * GROVNEWS BLOG — admin reads. Transport-agnostic like every service here:
 * the caller passes a Supabase client and RLS (migration 0124: is_admin) is
 * what lets it see drafts at all. The public pages never come through here —
 * they read lib/server/grovnews-blog.ts, which only knows the public functions.
 */

export type AdminPublicArticle = {
  id: string; slug: string; title: string; status: string;
  publishedAt: string | null; updatedAt: string; noindex: boolean;
  category: string | null;
  source: { id: string; title: string } | null;
  seo: { ok: number; total: number };
};

export async function adminListPublicArticles(supabase: Client, status?: string): Promise<AdminPublicArticle[]> {
  let q = supabase
    .from("grovnews_public_articles")
    .select("id, slug, title, status, published_at, updated_at, noindex, seo_title, seo_description, content, cover_url, cover_alt, canonical_url, category:grovnews_categories(name), source:grovnews_posts(id, title)")
    .order("updated_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return ((data ?? []) as unknown as {
    id: string; slug: string; title: string; status: string; published_at: string | null; updated_at: string;
    noindex: boolean; seo_title: string | null; seo_description: string | null; content: string;
    cover_url: string | null; cover_alt: string | null; canonical_url: string | null;
    category: { name: string } | null; source: { id: string; title: string } | null;
  }[]).map((r) => {
    const checks = articleSeoChecks({
      seoTitle: r.seo_title ?? "", seoDescription: r.seo_description ?? "", content: r.content,
      coverUrl: r.cover_url ?? "", coverAlt: r.cover_alt ?? "", canonicalUrl: r.canonical_url ?? "",
    });
    return {
      id: r.id, slug: r.slug, title: r.title, status: r.status, publishedAt: r.published_at,
      updatedAt: r.updated_at, noindex: r.noindex, category: r.category?.name ?? null, source: r.source ?? null,
      seo: { ok: checks.filter((c) => c.ok).length, total: checks.length },
    };
  });
}

export type AdminPublicArticleDetail = {
  id: string; slug: string; title: string; excerpt: string; content: string; status: string;
  categoryId: string | null; tags: string[]; coverUrl: string | null; coverAlt: string | null;
  sources: { url: string; title: string | null }[]; faq: FaqItem[]; relatedSlugs: string[];
  language: string; schemaType: string; noindex: boolean;
  seoTitle: string | null; seoDescription: string | null; canonicalUrl: string | null;
  ogTitle: string | null; ogDescription: string | null; internalNote: string | null;
  publishedAt: string | null; updatedAt: string; readMinutes: number;
  source: { id: string; title: string; status: string } | null;
};

export async function adminGetPublicArticle(supabase: Client, id: string): Promise<AdminPublicArticleDetail | null> {
  const { data } = await supabase
    .from("grovnews_public_articles")
    .select("*, source:grovnews_posts(id, title, status)")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as typeof data & { source: { id: string; title: string; status: string } | null };
  return {
    id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, content: r.content, status: r.status,
    categoryId: r.category_id, tags: r.tags ?? [], coverUrl: r.cover_url, coverAlt: r.cover_alt,
    sources: readSources(r.sources), faq: readFaq(r.faq), relatedSlugs: r.related_slugs ?? [],
    language: r.language, schemaType: r.schema_type, noindex: r.noindex,
    seoTitle: r.seo_title, seoDescription: r.seo_description, canonicalUrl: r.canonical_url,
    ogTitle: r.og_title, ogDescription: r.og_description, internalNote: r.internal_note,
    publishedAt: r.published_at, updatedAt: r.updated_at, readMinutes: r.estimated_read_minutes,
    source: r.source ?? null,
  };
}

/** Premium posts a public version can be made from: published ones only (an
 *  unapproved draft is not a source), each with its public version if any. */
export type PublicSourceCandidate = {
  id: string; title: string; publishedAt: string | null; category: string | null; publicId: string | null;
};

export async function adminPublicSourceCandidates(supabase: Client): Promise<PublicSourceCandidate[]> {
  const [{ data: posts }, { data: made }] = await Promise.all([
    supabase.from("grovnews_posts")
      .select("id, title, published_at, category:grovnews_categories(name)")
      .eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(200),
    supabase.from("grovnews_public_articles").select("id, source_grovnews_post_id")
      .not("source_grovnews_post_id", "is", null),
  ]);
  const byPost = new Map((made ?? []).map((m) => [m.source_grovnews_post_id as string, m.id]));
  return ((posts ?? []) as unknown as {
    id: string; title: string; published_at: string | null; category: { name: string } | null;
  }[]).map((p) => ({
    id: p.id, title: p.title, publishedAt: p.published_at, category: p.category?.name ?? null,
    publicId: byPost.get(p.id) ?? null,
  }));
}

/** The public version already made from a premium post, if any. */
export async function adminPublicArticleForPost(supabase: Client, postId: string): Promise<string | null> {
  const { data } = await supabase.from("grovnews_public_articles").select("id")
    .eq("source_grovnews_post_id", postId).maybeSingle();
  return data?.id ?? null;
}
