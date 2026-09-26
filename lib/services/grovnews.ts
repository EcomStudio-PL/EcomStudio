import type { Client } from "./workspace";
import { readSources, SLUG_RE, type PostSource } from "@/lib/grovnews";
import { parseGrovNewsState, warsawLocalToIso, type GrovNewsState } from "@/lib/grovnews-billing";
import { readDailyRecord, warsawDate } from "@/lib/grovnews-research";

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
  /** How many sources the post cites ("Źródła: n" on the card). */
  sourcesCount: number;
};

export type Article = FeedPost & { content: string; sources: PostSource[]; tags: string[] };

type PostRow = {
  id: string; slug: string; title: string; excerpt: string; cover_url: string | null;
  published_at: string | null; estimated_read_minutes: number;
  category: { slug: string; name: string } | null;
  sources?: unknown;
};

const FEED_COLUMNS = "id, slug, title, excerpt, cover_url, published_at, estimated_read_minutes, category:grovnews_categories(slug, name)";

function toFeedPost(r: PostRow): FeedPost {
  return {
    id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, coverUrl: r.cover_url,
    publishedAt: r.published_at, readMinutes: r.estimated_read_minutes, category: r.category ?? null,
    sourcesCount: readSources(r.sources).length,
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

/** The signed-in customer's own GrovNews state (access, its sources, the
 *  paid subscription, the launch bonus) — grovnews_my_state() answers for
 *  auth.uid() only. Null when the database does not answer. */
export async function getMyGrovNewsState(supabase: Client): Promise<GrovNewsState | null> {
  const { data, error } = await supabase.rpc("grovnews_my_state");
  return error ? null : parseGrovNewsState(data);
}

export type FeedFilter = {
  /** An ACTIVE category's id, already validated by `pickCategory` — never a
   *  raw query-string value. */
  categoryId?: string | null;
  limit?: number;
};

/** Newest first, optionally one category (filtered in the database). */
export async function listFeed(supabase: Client, filter: FeedFilter = {}): Promise<FeedPost[]> {
  let q = supabase
    .from("grovnews_posts").select(`${FEED_COLUMNS}, sources`)
    .eq("status", "PUBLISHED").lte("published_at", new Date().toISOString());
  if (filter.categoryId) q = q.eq("category_id", filter.categoryId);
  const { data, error } = await q.order("published_at", { ascending: false }).limit(filter.limit ?? 60);
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
  const sources = readSources(row.sources);
  return { ...toFeedPost(row), sourcesCount: sources.length, content: row.content, sources, tags: row.tags ?? [] };
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

/** The reader's filter chips: ACTIVE categories only, in the admin's order.
 *  RLS already hides inactive ones from customers; the explicit filter keeps
 *  an admin reading the customer feed on the same list. */
export async function listActiveCategories(supabase: Client): Promise<CategoryRow[]> {
  return (await listCategories(supabase)).filter((c) => c.is_active);
}

/** `?category=<slug>` → the ACTIVE category it names, or null. Anything else
 *  (absent, malformed, inactive, unknown) is ignored — the feed shows every
 *  category rather than an error. */
export function pickCategory(categories: readonly CategoryRow[], raw: unknown): CategoryRow | null {
  const slug = Array.isArray(raw) ? raw[0] : raw;
  if (typeof slug !== "string" || slug.length > 120 || !SLUG_RE.test(slug)) return null;
  return categories.find((c) => c.is_active && c.slug === slug) ?? null;
}

/* ── the reader's own access card ──────────────────────────────────────────── */

/** What gives this reader access, in the order it is shown: a paid
 *  subscription first, then the granted kinds, then the admin role (an admin
 *  reading without any entitlement of their own). */
export type AccessKind = "PAID" | "LAUNCH_BONUS" | "PROMO" | "ADMIN_GRANT" | "ADMIN";

export type AccessView = {
  kind: AccessKind;
  /** Other active sources the reader also holds (chips next to the main one). */
  also: AccessKind[];
  /** PAID: the subscriber's OWN price (locked at purchase), not today's offer. */
  priceCents: number | null;
  currency: string;
  /** PAID and renewing: the next charge. */
  renewsOn: string | null;
  /** PAID and not renewing: the last day of access. */
  endsOn: string | null;
  pastDue: boolean;
  /** Granted kinds: access until this instant; `forever` = no end date. Both
   *  empty = the database did not say (shown without a date, never guessed). */
  until: string | null;
  forever: boolean;
};

const GRANTED: readonly AccessKind[] = ["LAUNCH_BONUS", "PROMO", "ADMIN_GRANT"];

/** grovnews_my_state() → the card at the top of /grovnews. Null = no access
 *  (and not an admin): the locked screen, never this card. Pure. */
export function grovnewsAccessView(state: GrovNewsState | null, admin: boolean): AccessView | null {
  const paid = state?.paid && state.paid.hasAccess ? state.paid : null;
  const granted = GRANTED.filter((k) => state?.access === true && state.sources.includes(k));
  const base = {
    also: [] as AccessKind[], priceCents: null, currency: "PLN", renewsOn: null, endsOn: null,
    pastDue: false, until: null, forever: false,
  };
  if (paid) {
    const renewing = paid.live && !paid.cancelAtPeriodEnd && paid.status !== "past_due";
    return {
      ...base, kind: "PAID", also: granted,
      priceCents: paid.priceCents, currency: paid.currency,
      renewsOn: renewing ? paid.currentPeriodEnd : null,
      endsOn: renewing || paid.status === "past_due" ? null : paid.paidThrough ?? paid.currentPeriodEnd,
      pastDue: paid.status === "past_due",
    };
  }
  const [first, ...rest] = granted;
  if (first) {
    const launch = first === "LAUNCH_BONUS" && state?.launch?.accessGranted ? state.launch : null;
    return {
      ...base, kind: first, also: rest,
      until: launch && !launch.forever ? launch.accessUntil : null,
      forever: launch?.forever === true,
    };
  }
  return admin ? { ...base, kind: "ADMIN" } : null;
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

const PAGE = 1000;

/** Every `user_id` a filtered query returns, read page by page with an exact
 *  count, so a total above PostgREST's row cap is never silently truncated. */
async function allUserIds(
  query: (from: number, to: number) => PromiseLike<{ data: { user_id: string | null }[] | null; count: number | null; error: unknown }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, count, error } = await query(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data) if (r.user_id) ids.push(r.user_id);
    if (data.length < PAGE || (count !== null && from + PAGE >= count)) break;
  }
  return ids;
}

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
  const [total, published, drafts, archived, granted, paid, expiring, recent] = await Promise.all([
    count(), count("PUBLISHED"), count("DRAFT"), count("ARCHIVED"),
    // Active = the resolver's two ways in (0123): an ACTIVE, started, unexpired
    // entitlement, OR a subscription paid through a future date. Distinct
    // users across both: one person with two sources is one subscriber.
    allUserIds((from, to) => supabase.from("grovnews_entitlements").select("user_id", { count: "exact" })
      .eq("status", "ACTIVE").lte("starts_at", nowIso).or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("user_id").range(from, to)),
    allUserIds((from, to) => supabase.from("grovnews_subscriptions").select("user_id", { count: "exact" })
      .gt("paid_through", nowIso).order("user_id").range(from, to)),
    supabase.from("grovnews_entitlements").select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE").gt("expires_at", nowIso).lte("expires_at", soonIso),
    adminListPosts(supabase),
  ]);
  return {
    total, published, drafts, archived,
    activeSubscribers: new Set([...granted, ...paid]).size,
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

/* ── admin dashboard: "does GrovNews work today?" (RLS: is_admin) ──────────── */

/** Why an enabled source is not healthy, from its stored `last_error` code
 *  (the vocabulary of lib/server/grovnews/fetch.ts / probe.ts). */
export const SOURCE_ERROR_BUCKETS = ["timeout", "auth", "http", "network", "format", "empty", "unsupported", "other"] as const;
export type SourceErrorBucket = (typeof SOURCE_ERROR_BUCKETS)[number];

export function sourceErrorBucket(code: string | null): SourceErrorBucket {
  const c = (code ?? "").trim();
  const http = /^http_status_(\d{3})$/.exec(c);
  if (c === "timeout") return "timeout";
  if ((http && ["401", "402", "403", "407", "451"].includes(http[1])) || c === "requires_access" || c === "bot_protection"
    || c === "auth_failed" || c === "secret_missing") return "auth";
  if (http) return "http";
  if (["dns", "network", "private_address", "forbidden_host", "invalid_url", "too_large", "too_many_redirects", "robots_unreachable"].includes(c)) return "network";
  if (c === "unrecognized_format") return "format";
  if (c === "empty") return "empty";
  if (["adapter_unavailable", "robots", "no_url", "manual"].includes(c)) return "unsupported";
  return "other";
}

export type SourceHealthSummary = {
  total: number;
  /** Switched on — the ones a run reads. */
  enabled: number;
  disabled: number;
  /** Enabled and HEALTHY at the last read. */
  ok: number;
  /** Enabled, never checked yet. */
  unchecked: number;
  /** Enabled and DEGRADED / FAILED / UNSUPPORTED. */
  withErrors: number;
  /** withErrors split by cause; only non-zero buckets, largest first. */
  causes: { bucket: SourceErrorBucket; count: number }[];
};

type SourceHealthRow = { enabled: boolean; health_status: string | null; last_error: string | null };

/** Pure: the source rows → the dashboard's one-line health summary. */
export function summarizeSourceHealth(rows: readonly SourceHealthRow[]): SourceHealthSummary {
  const causes = new Map<SourceErrorBucket, number>();
  let enabled = 0, ok = 0, unchecked = 0, withErrors = 0;
  for (const r of rows) {
    if (!r.enabled) continue;
    enabled++;
    if (r.health_status === "HEALTHY") ok++;
    else if (r.health_status === "DEGRADED" || r.health_status === "FAILED" || r.health_status === "UNSUPPORTED") {
      withErrors++;
      const b = sourceErrorBucket(r.last_error);
      causes.set(b, (causes.get(b) ?? 0) + 1);
    } else unchecked++;
  }
  return {
    total: rows.length, enabled, disabled: rows.length - enabled, ok, unchecked, withErrors,
    causes: SOURCE_ERROR_BUCKETS.filter((b) => causes.has(b)).map((bucket) => ({ bucket, count: causes.get(bucket) ?? 0 }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function adminSourceHealth(supabase: Client): Promise<SourceHealthSummary> {
  const rows: SourceHealthRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("grovnews_sources")
      .select("enabled, health_status, last_error").order("id").range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return summarizeSourceHealth(rows);
}

export type TodayStatus = {
  /** The Warsaw calendar day the numbers are for (YYYY-MM-DD). */
  date: string;
  run: {
    status: string; stage: string; trigger: string; startedAt: string; finishedAt: string | null;
    outcome: string | null; error: string | null;
  } | null;
  /** Research items first seen today: all, rejected, duplicates. */
  items: { fetched: number; rejected: number; duplicates: number };
  edition: {
    id: string; status: string; title: string; topics: number;
    recipients: number | null; failureReason: string | null; campaignId: string | null;
  } | null;
  /** The edition's mail, counted from the newsletter's own recipient rows. */
  mail: { campaignStatus: string | null; recipients: number; sent: number; failed: number } | null;
};

/** Today's run, research intake, edition and mail — every number counted
 *  from the tables (admin-only under RLS), none estimated. */
export async function adminToday(supabase: Client, now: Date = new Date()): Promise<TodayStatus> {
  const date = warsawDate(now);
  const since = warsawLocalToIso(`${date}T00:00`) ?? `${date}T00:00:00Z`;
  const items = (status?: string) => {
    let q = supabase.from("grovnews_research_items").select("id", { count: "exact", head: true }).gte("discovered_at", since);
    if (status) q = q.eq("status", status);
    return q.then((r) => r.count ?? 0);
  };
  const [run, edition, fetched, rejected, duplicates] = await Promise.all([
    supabase.from("grovnews_runs").select("status, stage, trigger, started_at, finished_at, error, stats")
      .eq("kind", "DAILY").eq("run_date", date).maybeSingle(),
    supabase.from("grovnews_editions")
      .select("id, status, title, campaign_id, email_recipients, failure_reason, daily, posts:grovnews_edition_posts(count)")
      .eq("edition_date", date).maybeSingle(),
    items(), items("REJECTED"), items("DUPLICATE"),
  ]);
  const r = run.data;
  const stats = r?.stats && typeof r.stats === "object" && !Array.isArray(r.stats) ? r.stats as Record<string, unknown> : {};
  const e = edition.data as unknown as {
    id: string; status: string; title: string; campaign_id: string | null; email_recipients: number | null;
    failure_reason: string | null; daily: unknown; posts: { count: number }[] | null;
  } | null;

  let mail: TodayStatus["mail"] = null;
  if (e?.campaign_id) {
    const count = (status?: string) => {
      let q = supabase.from("newsletter_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", e.campaign_id ?? "");
      if (status) q = q.eq("status", status);
      return q.then((x) => x.count ?? 0);
    };
    const [campaign, total, sent, failed] = await Promise.all([
      supabase.from("newsletter_campaigns").select("status").eq("id", e.campaign_id).maybeSingle(),
      count(), count("sent"), count("failed"),
    ]);
    mail = { campaignStatus: campaign.data?.status ?? null, recipients: total, sent, failed };
  }

  return {
    date,
    run: r ? {
      status: r.status, stage: r.stage, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at,
      outcome: typeof stats.outcome === "string" ? stats.outcome : null, error: r.error,
    } : null,
    items: { fetched, rejected, duplicates },
    edition: e ? {
      id: e.id, status: e.status, title: e.title,
      topics: readDailyRecord(e.daily)?.topics.length ?? e.posts?.[0]?.count ?? 0,
      recipients: e.email_recipients, failureReason: e.failure_reason, campaignId: e.campaign_id,
    } : null,
    mail,
  };
}
