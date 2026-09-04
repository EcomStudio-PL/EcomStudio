import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { CmsBlock, CmsBlockContent } from "@/lib/cms";

/**
 * READING THE PUBLIC SITE.
 *
 * Every public page is a cms_pages row and every visitor sees its
 * `published_snapshot` — never the live blocks, which are the admin's draft.
 * That rule lives here so no route can accidentally read the wrong column.
 */

export type PublicSite = { instagramUrl: string; facebookUrl: string };

const httpsOnly = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    // Rendered as a link a visitor clicks, so only https ever survives.
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
};

/** Social profiles shown on the public pages. Empty means "no button". */
export async function getPublicSite(supabase: Client): Promise<PublicSite> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "public_site").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    instagramUrl: httpsOnly(v.instagram_url),
    facebookUrl: httpsOnly(v.facebook_url),
  };
}

export type PublicPage = {
  slug: string;
  title: string;
  kind: string;
  blocks: CmsBlock[];
  publishedAt: string | null;
};

function toBlocks(snapshot: unknown): CmsBlock[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => ({
      type: String(b.type ?? ""),
      sort_order: Number(b.sort_order ?? 0),
      visible: b.visible !== false,
      content: (b.content ?? {}) as CmsBlockContent,
    }));
}

/**
 * One page's published content, or null when it was never published. A draft
 * page is not "coming soon" to a visitor — it simply does not exist yet.
 */
export async function getPublishedPage(supabase: Client, slug: string): Promise<PublicPage | null> {
  const { data } = await supabase
    .from("cms_pages")
    .select("slug, title, kind, status, published_snapshot, published_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!data || data.status !== "published") return null;
  return {
    slug: data.slug,
    title: data.title,
    kind: (data.kind as string | null) ?? "standard",
    blocks: toBlocks(data.published_snapshot),
    publishedAt: data.published_at,
  };
}

/** The draft blocks, for the admin-only preview. */
export async function getDraftBlocks(supabase: Client, slug: string): Promise<CmsBlock[]> {
  const { data: page } = await supabase
    .from("cms_pages").select("id").eq("slug", slug).maybeSingle();
  if (!page) return [];
  const { data } = await supabase
    .from("cms_blocks").select("type, sort_order, visible, content")
    .eq("page_id", page.id).order("sort_order");
  return toBlocks(data);
}
