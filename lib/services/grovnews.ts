import type { Client } from "./workspace";
import { readSources, type PostSource } from "@/lib/grovnews";

/**
 * GROVNEWS — reads. Transport-agnostic like every service here: the caller
 * passes a Supabase client and the database decides what that client may see.
 *
 * THE READER'S QUERIES RELY ON RLS, NOT ON A FILTER. grovnews_posts answers a
 * non-admin only with PUBLISHED rows, and only while grovnews_has_access() is
 * true (migration 0119). The explicit `status = PUBLISHED` below is for the
 * ADMIN reading the customer feed, who would otherwise see drafts in it — it
 * is not what keeps drafts from customers.
 */

export type CategoryRow = { id: string; slug: string; name: string; sort_order: number; is_active: boolean };

export type FeedPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string | null;
  publishedAt: string | null;
  readMinutes: number;
  category: { slug: string; name: string } | null;
};

export type Article = FeedPost & { content: string; sources: PostSource[]; tags: string[] };

type PostRow = {
  id: string; slug: string; title: string; excerpt: string; cover_url: string | null;
  published_at: string | null; estimated_read_minutes: number;
  category: { slug: string; name: string } | null;
};

const FEED_COLUMNS = "id, slug, title, excerpt, cover_url, published_at, estimated_read_minutes, category:grovnews_categories(slug, name)";

function toFeedPost(r: PostRow): FeedPost {
  return {
    id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, coverUrl: r.cover_url,
    publishedAt: r.published_at, readMinutes: r.estimated_read_minutes, category: r.category ?? null,
  };
}

/** Does the SIGNED-IN caller hold an active entitlement? Asked of the database,
 *  which answers for auth.uid() only — there is no way to ask about someone else. */
export async function hasActiveGrovNewsAccess(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("grovnews_has_access");
  return !error && data === true;
}

/** GrovNews Premium on sale right now, and for how much — or null. The
 *  database answers only with a Price Stripe has confirmed (0123). */
export async function getGrovNewsOffer(supabase: Client): Promise<{ priceCents: number; currency: string } | null> {
  const { data, error } = await supabase.rpc("grovnews_offer");
  if (error || !data) return null;
  const o = data as { available?: boolean; price_cents?: number | null; currency?: string };
  return o.available === true && typeof o.price_cents === "number"
    ? { priceCents: o.price_cents, currency: o.currency ?? "PLN" } : null;
}

/** Newest first. */
export async function listFeed(supabase: Client, limit = 60): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from("grovnews_posts").select(FEED_COLUMNS)
    .eq("status", "PUBLISHED").lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return (data as unknown as PostRow[]).map(toFeedPost);
}

/** One published article, or null (absent, unpublished, or not yours to read). */
export async function getPublishedArticle(supabase: Client, slug: string): Promise<Article | null> {
  const { data, error } = await supabase
    .from("grovnews_posts").select(`${FEED_COLUMNS}, content, sources, tags`)
    .eq("slug", slug).eq("status", "PUBLISHED").lte("published_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as PostRow & { content: string; sources: unknown; tags: string[] };
  return { ...toFeedPost(row), content: row.content, sources: readSources(row.sources), tags: row.tags ?? [] };
}

/* ── the day's edition (Stage 2) ───────────────────────────────────────────── */

export type CurrentEdition = {
  date: string;
  title: string;
  intro: string;
  posts: { id: string; slug: string; title: string; excerpt: string; featured: boolean; readMinutes: number }[];
};

/** The latest published edition (last three days), published posts only —
 *  answered by the database under the same access rule as the posts. */
export async function getCurrentEdition(supabase: Client): Promise<CurrentEdition | null> {
  const { data, error } = await supabase.rpc("grovnews_current_edition");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as {
    date: string; title: string; intro: string | null;
    posts: { id: string; slug: string; title: string; excerpt: string; featured: boolean; read_minutes: number }[] | null;
  };
  const posts = (d.posts ?? []).map((p) => ({
    id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, featured: p.featured, readMinutes: p.read_minutes,
  }));
  return posts.length ? { date: d.date, title: d.title, intro: d.intro ?? "", posts } : null;
}

export async function listCategories(supabase: Client): Promise<CategoryRow[]> {
  const { data } = await supabase
    .from("grovnews_categories").select("id, slug, name, sort_order, is_active")
    .order("sort_order").order("name");
  return data ?? [];
}

/* ── admin reads (RLS: is_admin) ───────────────────────────────────────────── */

export type AdminPost = {
  id: string; slug: string; title: string; status: string; publishedAt: string | null;
  updatedAt: string; readMinutes: number; category: string | null; author: string | null;
};

export async function adminListPosts(supabase: Client, status?: string): Promise<AdminPost[]> {
  let q = supabase
    .from("grovnews_posts")
    .select("id, slug, title, status, published_at, updated_at, estimated_read_minutes, created_by, category:grovnews_categories(name)")
    .order("updated_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; slug: string; title: string; status: string; published_at: string | null; updated_at: string;
    estimated_read_minutes: number; created_by: string | null; category: { name: string } | null;
  }[];
  const authors = await namesFor(supabase, rows.map((r) => r.created_by));
  return rows.map((r) => ({
    id: r.id, slug: r.slug, title: r.title, status: r.status, publishedAt: r.published_at,
    updatedAt: r.updated_at, readMinutes: r.estimated_read_minutes, category: r.category?.name ?? null,
    author: r.created_by ? authors.get(r.created_by) ?? null : null,
  }));
}

export async function adminGetPost(supabase: Client, id: string) {
  const { data } = await supabase.from("grovnews_posts").select("*").eq("id", id).maybeSingle();
  return data;
}

export type AdminEntitlement = {
  id: string; userId: string; email: string; name: string | null; status: string; source: string;
  startsAt: string; expiresAt: string | null; note: string | null; updatedAt: string;
};

export async function adminListEntitlements(supabase: Client): Promise<AdminEntitlement[]> {
  const { data } = await supabase
    .from("grovnews_entitlements")
    .select("id, user_id, status, source, starts_at, expires_at, internal_note, updated_at, profile:profiles(email, full_name)")
    .order("updated_at", { ascending: false }).limit(1000);
  return ((data ?? []) as unknown as {
    id: string; user_id: string; status: string; source: string; starts_at: string; expires_at: string | null;
    internal_note: string | null; updated_at: string; profile: { email: string; full_name: string | null } | null;
  }[]).map((r) => ({
    id: r.id, userId: r.user_id, email: r.profile?.email ?? "—", name: r.profile?.full_name ?? null,
    status: r.status, source: r.source, startsAt: r.starts_at, expiresAt: r.expires_at,
    note: r.internal_note, updatedAt: r.updated_at,
  }));
}

export type AdminStats = {
  total: number; published: number; drafts: number; archived: number;
  activeSubscribers: number; expiringSoon: number;
  recent: AdminPost[];
};

/** The dashboard's numbers — every one counted, none estimated. */
export async function adminStats(supabase: Client, now: Date = new Date()): Promise<AdminStats> {
  const count = async (status?: string) => {
    let q = supabase.from("grovnews_posts").select("id", { count: "exact", head: true });
    if (status) q = q.eq("status", status);
    const { count: n } = await q;
    return n ?? 0;
  };
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [total, published, drafts, archived, active, expiring, recent] = await Promise.all([
    count(), count("PUBLISHED"), count("DRAFT"), count("ARCHIVED"),
    // Active = ACTIVE status, started, not expired. Distinct users, not rows:
    // one person with two sources is one subscriber.
    supabase.from("grovnews_entitlements").select("user_id")
      .eq("status", "ACTIVE").lte("starts_at", nowIso).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    supabase.from("grovnews_entitlements").select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE").gt("expires_at", nowIso).lte("expires_at", soonIso),
    adminListPosts(supabase),
  ]);
  return {
    total, published, drafts, archived,
    activeSubscribers: new Set((active.data ?? []).map((r) => r.user_id)).size,
    expiringSoon: expiring.count ?? 0,
    recent: recent.slice(0, 6),
  };
}

/** Display names for author ids, in one query. */
async function namesFor(supabase: Client, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, email, full_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email]));
}
