import type { Client } from "./workspace";
import { campaignStats, type CampaignStats } from "./newsletter";
import type {
  DailyRecord, EditionStatus, GrovNewsSettings, ItemStatus, SourceHealth, SourceType,
} from "@/lib/grovnews-research";
import { DEFAULT_SETTINGS, effectiveHealth, readDailyRecord } from "@/lib/grovnews-research";

/**
 * GROVNEWS STAGE 2 — admin reads. Every table read here is admin-only under
 * RLS (0121), so a non-admin client reads nothing at all; the pages that call
 * these sit behind the admin layouts as well. Nothing in this file writes.
 */

/* ── settings and scheduler ────────────────────────────────────────────────── */

export type AdminSettings = GrovNewsSettings & { updatedAt: string | null };

export async function adminGetSettings(supabase: Client): Promise<AdminSettings> {
  const { data } = await supabase.from("grovnews_settings").select("*").eq("id", true).maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS, updatedAt: null };
  return {
    mode: data.mode === "AUTOMATIC" ? "AUTOMATIC" : "REVIEW",
    dailyEnabled: data.daily_enabled,
    runHour: data.run_hour,
    timezone: "Europe/Warsaw",
    minRelevance: data.min_relevance,
    minImportance: data.min_importance,
    maxTopics: data.max_topics,
    autoPublishOfficialSensitive: data.auto_publish_official_sensitive,
    minTopics: data.min_topics ?? DEFAULT_SETTINGS.minTopics,
    lookbackHours: data.lookback_hours ?? DEFAULT_SETTINGS.lookbackHours,
    emailEnabled: data.email_enabled !== false,
    updatedAt: data.updated_at,
  };
}

export type SchedulerStatus = {
  pgCron: boolean;
  jobScheduled: boolean;
  triggerConfigured: boolean;
  lastTick: { status: string; at: string | null; message: string | null } | null;
};

export async function adminSchedulerStatus(supabase: Client): Promise<SchedulerStatus | null> {
  const { data, error } = await supabase.rpc("grovnews_scheduler_status");
  if (error || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const last = d.lastTick as { status?: string; at?: string; message?: string } | null;
  return {
    pgCron: d.pgCron === true,
    jobScheduled: d.jobScheduled === true,
    triggerConfigured: d.triggerConfigured === true,
    lastTick: last ? { status: String(last.status ?? ""), at: last.at ?? null, message: last.message ?? null } : null,
  };
}

export type AdminRun = {
  id: string; date: string; status: string; stage: string; trigger: string; invocations: number;
  startedAt: string; finishedAt: string | null; error: string | null; stats: Record<string, unknown>;
};

export async function adminRecentRuns(supabase: Client, limit = 10): Promise<AdminRun[]> {
  const { data } = await supabase.from("grovnews_runs")
    .select("id, run_date, status, stage, trigger, invocations, started_at, finished_at, error, stats")
    .order("run_date", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id, date: r.run_date, status: r.status, stage: r.stage, trigger: r.trigger, invocations: r.invocations,
    startedAt: r.started_at, finishedAt: r.finished_at, error: r.error,
    stats: (r.stats && typeof r.stats === "object" && !Array.isArray(r.stats) ? r.stats : {}) as Record<string, unknown>,
  }));
}

/* ── sources ───────────────────────────────────────────────────────────────── */

export type AdminSource = {
  id: string; name: string; type: SourceType; url: string | null; enabled: boolean;
  categoryId: string | null; categoryName: string | null; priority: number; official: boolean;
  language: "pl" | "en" | "de"; lastCheckedAt: string | null; lastSuccessAt: string | null; lastError: string | null;
  /** 0125: health as a screen shows it (DISABLED = switched off, UNCHECKED =
   *  never tested), and what the last read established. */
  health: SourceHealth; failures: number; lastHttpStatus: number | null; detectedType: string | null;
  resolvedUrl: string | null; lastItems: number | null; lastNewItems: number | null;
};

/** Every source (a bulk import can bring hundreds; the list never silently
 *  stops at an arbitrary length below that). */
export async function adminListSources(supabase: Client): Promise<AdminSource[]> {
  const { data } = await supabase.from("grovnews_sources")
    .select("id, name, source_type, url, enabled, category_id, priority, official_source, language, last_checked_at, last_success_at, last_error, health_status, consecutive_failures, last_http_status, detected_type, resolved_url, last_items_count, last_new_items, category:grovnews_categories(name)")
    .order("enabled", { ascending: false }).order("priority", { ascending: false }).order("name").limit(2000);
  type Row = {
    id: string; name: string; source_type: string; url: string | null; enabled: boolean; category_id: string | null;
    priority: number; official_source: boolean; language: string; last_checked_at: string | null;
    last_success_at: string | null; last_error: string | null; category: { name: string } | null;
    health_status: string | null; consecutive_failures: number; last_http_status: number | null; detected_type: string | null;
    resolved_url: string | null; last_items_count: number | null; last_new_items: number | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, name: r.name, type: r.source_type as SourceType, url: r.url, enabled: r.enabled,
    categoryId: r.category_id, categoryName: r.category?.name ?? null, priority: r.priority, official: r.official_source,
    language: (r.language === "en" || r.language === "de" ? r.language : "pl"),
    lastCheckedAt: r.last_checked_at, lastSuccessAt: r.last_success_at, lastError: r.last_error,
    health: effectiveHealth(r.enabled, r.health_status), failures: r.consecutive_failures ?? 0,
    lastHttpStatus: r.last_http_status, detectedType: r.detected_type, resolvedUrl: r.resolved_url,
    lastItems: r.last_items_count, lastNewItems: r.last_new_items,
  }));
}

/* ── research inbox ────────────────────────────────────────────────────────── */

export const RESEARCH_FILTERS = ["inbox", "selected", "used", "rejected", "duplicate", "all"] as const;
export type ResearchFilter = (typeof RESEARCH_FILTERS)[number];

const FILTER_STATUSES: Record<ResearchFilter, ItemStatus[] | null> = {
  inbox: ["NEW", "ANALYZED"], selected: ["SELECTED"], used: ["USED"], rejected: ["REJECTED"],
  duplicate: ["DUPLICATE"], all: null,
};

export type AdminResearchItem = {
  id: string; title: string; aiTitle: string | null; url: string; host: string; excerpt: string;
  sourceId: string | null; sourceName: string | null; official: boolean;
  categoryId: string | null; categoryName: string | null; categorySlug: string | null;
  publishedAt: string | null; discoveredAt: string;
  relevance: number | null; importance: number | null; status: ItemStatus;
  aiSummary: string | null; aiReason: string | null; sensitive: boolean; reviewRequired: boolean; reviewReason: string | null;
  duplicateOf: string | null; postId: string | null; analysisError: string | null; analysisAttempts: number;
};

const ITEM_COLUMNS = "id, source_title, ai_title, canonical_url, source_excerpt, source_id, category_id, source_published_at, discovered_at, relevance_score, importance_score, status, ai_summary, ai_reason, sensitive, review_required, review_reason, duplicate_of, post_id, analysis_error, analysis_attempts, source:grovnews_sources(name, official_source), category:grovnews_categories(name, slug)";

type ItemRow = {
  id: string; source_title: string; ai_title: string | null; canonical_url: string; source_excerpt: string;
  source_id: string | null; category_id: string | null; source_published_at: string | null; discovered_at: string;
  relevance_score: number | null; importance_score: number | null; status: string; ai_summary: string | null;
  ai_reason: string | null; sensitive: boolean; review_required: boolean; review_reason: string | null;
  duplicate_of: string | null; post_id: string | null; analysis_error: string | null; analysis_attempts: number;
  source: { name: string; official_source: boolean } | null; category: { name: string; slug: string } | null;
};

function toItem(r: ItemRow): AdminResearchItem {
  let host = "";
  try { host = new URL(r.canonical_url).hostname.replace(/^www\./, ""); } catch { host = ""; }
  return {
    id: r.id, title: r.source_title, aiTitle: r.ai_title, url: r.canonical_url, host, excerpt: r.source_excerpt,
    sourceId: r.source_id, sourceName: r.source?.name ?? null, official: r.source?.official_source ?? false,
    categoryId: r.category_id, categoryName: r.category?.name ?? null, categorySlug: r.category?.slug ?? null,
    publishedAt: r.source_published_at, discoveredAt: r.discovered_at,
    relevance: r.relevance_score, importance: r.importance_score, status: r.status as ItemStatus,
    aiSummary: r.ai_summary, aiReason: r.ai_reason, sensitive: r.sensitive, reviewRequired: r.review_required,
    reviewReason: r.review_reason, duplicateOf: r.duplicate_of, postId: r.post_id,
    analysisError: r.analysis_error, analysisAttempts: r.analysis_attempts,
  };
}

export async function adminListResearch(supabase: Client, filter: ResearchFilter, limit = 200): Promise<AdminResearchItem[]> {
  let q = supabase.from("grovnews_research_items").select(ITEM_COLUMNS);
  const statuses = FILTER_STATUSES[filter];
  if (statuses) q = q.in("status", statuses);
  const { data } = await q
    .order("importance_score", { ascending: false, nullsFirst: false })
    .order("discovered_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as ItemRow[]).map(toItem);
}

export async function adminResearchCounts(supabase: Client): Promise<Record<ResearchFilter, number>> {
  const count = async (statuses: ItemStatus[] | null) => {
    let q = supabase.from("grovnews_research_items").select("id", { count: "exact", head: true });
    if (statuses) q = q.in("status", statuses);
    const { count: n } = await q;
    return n ?? 0;
  };
  const entries = await Promise.all(RESEARCH_FILTERS.map(async (f) => [f, await count(FILTER_STATUSES[f])] as const));
  return Object.fromEntries(entries) as Record<ResearchFilter, number>;
}

/** Other recent stories an admin may mark this one a duplicate of. */
export async function adminDuplicateCandidates(supabase: Client, excludeId: string): Promise<{ id: string; title: string }[]> {
  const { data } = await supabase.from("grovnews_research_items")
    .select("id, source_title, ai_title").is("duplicate_of", null).neq("id", excludeId)
    .gte("discovered_at", new Date(Date.now() - 14 * 24 * 3600_000).toISOString())
    .order("discovered_at", { ascending: false }).limit(200);
  return (data ?? []).map((r) => ({ id: r.id, title: r.ai_title || r.source_title }));
}

/* ── editions ──────────────────────────────────────────────────────────────── */

export type AdminEdition = {
  id: string; date: string; title: string; status: EditionStatus; posts: number;
  campaignId: string | null; recipients: number | null; emailPreparedAt: string | null;
  queuedAt: string | null; sentAt: string | null; failureReason: string | null; autoGenerated: boolean;
};

export async function adminListEditions(supabase: Client, limit = 60): Promise<AdminEdition[]> {
  const { data } = await supabase.from("grovnews_editions")
    .select("id, edition_date, title, status, campaign_id, email_recipients, email_prepared_at, queued_at, sent_at, failure_reason, auto_generated, posts:grovnews_edition_posts(count)")
    .order("edition_date", { ascending: false }).limit(limit);
  type Row = {
    id: string; edition_date: string; title: string; status: string; campaign_id: string | null; email_recipients: number | null;
    email_prepared_at: string | null; queued_at: string | null; sent_at: string | null; failure_reason: string | null;
    auto_generated: boolean; posts: { count: number }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, date: r.edition_date, title: r.title, status: r.status as EditionStatus, posts: r.posts?.[0]?.count ?? 0,
    campaignId: r.campaign_id, recipients: r.email_recipients, emailPreparedAt: r.email_prepared_at,
    queuedAt: r.queued_at, sentAt: r.sent_at, failureReason: r.failure_reason, autoGenerated: r.auto_generated,
  }));
}

export type AdminEditionPost = {
  postId: string; position: number; featured: boolean; blurb: string | null;
  title: string; slug: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; publishedAt: string | null;
};

export type AdminEditionDetail = AdminEdition & {
  intro: string; publishedAt: string | null; emailSubject: string | null; emailPreview: string | null;
  emailBody: string | null; items: AdminEditionPost[];
  campaign: { status: string; stats: CampaignStats | null } | null;
  /** 0125: the day's ONE article and how it was made, when this edition
   *  carries one. */
  articlePostId: string | null; daily: DailyRecord | null;
};

export async function adminGetEdition(supabase: Client, id: string): Promise<AdminEditionDetail | null> {
  const { data } = await supabase.from("grovnews_editions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: rows } = await supabase.from("grovnews_edition_posts")
    .select("post_id, position, featured, email_blurb, post:grovnews_posts(title, slug, status, published_at)")
    .eq("edition_id", id).order("position");
  type Row = {
    post_id: string; position: number; featured: boolean; email_blurb: string | null;
    post: { title: string; slug: string; status: string; published_at: string | null } | null;
  };
  const items = ((rows ?? []) as unknown as Row[]).map((r) => ({
    postId: r.post_id, position: r.position, featured: r.featured, blurb: r.email_blurb,
    title: r.post?.title ?? "", slug: r.post?.slug ?? "",
    status: (r.post?.status ?? "DRAFT") as AdminEditionPost["status"], publishedAt: r.post?.published_at ?? null,
  }));

  let campaign: AdminEditionDetail["campaign"] = null;
  if (data.campaign_id) {
    const { data: k } = await supabase.from("newsletter_campaigns").select("status").eq("id", data.campaign_id).maybeSingle();
    if (k) {
      const stats = k.status === "draft" ? null : await campaignStats(supabase, data.campaign_id);
      campaign = { status: k.status, stats };
    }
  }

  return {
    id: data.id, date: data.edition_date, title: data.title, status: data.status as EditionStatus, posts: items.length,
    campaignId: data.campaign_id, recipients: data.email_recipients, emailPreparedAt: data.email_prepared_at,
    queuedAt: data.queued_at, sentAt: data.sent_at, failureReason: data.failure_reason, autoGenerated: data.auto_generated,
    intro: data.intro, publishedAt: data.published_at, emailSubject: data.email_subject, emailPreview: data.email_preview,
    emailBody: data.email_body, items, campaign,
    articlePostId: data.article_post_id ?? null, daily: readDailyRecord(data.daily),
  };
}

/** Stories an admin may add to today's draft article: analysed or selected,
 *  within the lookback, not used by any post yet, not a duplicate. */
export async function adminDailyCandidates(supabase: Client, lookbackHours: number): Promise<{
  id: string; title: string; source: string | null; official: boolean; relevance: number | null; importance: number | null;
}[]> {
  const since = new Date(Date.now() - Math.max(12, lookbackHours) * 3600_000).toISOString();
  const { data } = await supabase.from("grovnews_research_items")
    .select("id, source_title, ai_title, relevance_score, importance_score, source:grovnews_sources(name, official_source)")
    .in("status", ["ANALYZED", "SELECTED"]).is("post_id", null).gte("discovered_at", since)
    .order("importance_score", { ascending: false, nullsFirst: false }).limit(40);
  type Row = {
    id: string; source_title: string; ai_title: string | null; relevance_score: number | null; importance_score: number | null;
    source: { name: string; official_source: boolean } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, title: r.ai_title || r.source_title, source: r.source?.name ?? null, official: r.source?.official_source ?? false,
    relevance: r.relevance_score, importance: r.importance_score,
  }));
}

/** Posts an admin may add to a draft edition: recent, not archived, not in
 *  any edition yet. */
export async function adminEditionCandidates(supabase: Client): Promise<{ id: string; title: string; status: string; publishedAt: string | null }[]> {
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const [{ data: posts }, { data: taken }] = await Promise.all([
    supabase.from("grovnews_posts").select("id, title, status, published_at, updated_at")
      .neq("status", "ARCHIVED").gte("updated_at", since).order("updated_at", { ascending: false }).limit(100),
    supabase.from("grovnews_edition_posts").select("post_id").limit(5000),
  ]);
  const used = new Set((taken ?? []).map((r) => r.post_id));
  return (posts ?? []).filter((p) => !used.has(p.id))
    .map((p) => ({ id: p.id, title: p.title, status: p.status, publishedAt: p.published_at }));
}

/* ── subscribers: can we e-mail them? ──────────────────────────────────────── */

export type MailEligibility = "ok" | "no_contact" | "no_consent" | "unsubscribed" | "suppressed";

/**
 * For each entitled user, whether the newsletter would actually mail them —
 * by the newsletter's own rules. An entitlement is access to the app; it is
 * NOT consent to e-mail, and suppression beats everything.
 */
export async function adminMailEligibility(
  supabase: Client, users: readonly { id: string; email: string }[],
): Promise<Map<string, MailEligibility>> {
  const out = new Map<string, MailEligibility>();
  if (users.length === 0) return out;
  const ids = users.map((u) => u.id);
  const emails = users.map((u) => u.email.toLowerCase());
  const [{ data: byUser }, { data: byEmail }, { data: suppressed }] = await Promise.all([
    supabase.from("newsletter_contacts").select("user_id, email, marketing_consent, unsubscribed_at").in("user_id", ids).limit(5000),
    supabase.from("newsletter_contacts").select("user_id, email, marketing_consent, unsubscribed_at").is("user_id", null).in("email", emails).limit(5000),
    supabase.from("newsletter_suppressions").select("email").in("email", emails).limit(5000),
  ]);
  const blocked = new Set((suppressed ?? []).map((s) => s.email));
  type Contact = { user_id: string | null; email: string; marketing_consent: boolean; unsubscribed_at: string | null };
  const contacts = [...(byUser ?? []), ...(byEmail ?? [])] as Contact[];
  for (const u of users) {
    const c = contacts.find((x) => x.user_id === u.id) ?? contacts.find((x) => x.user_id === null && x.email === u.email.toLowerCase());
    if (!c) { out.set(u.id, "no_contact"); continue; }
    if (blocked.has(c.email)) out.set(u.id, "suppressed");
    else if (c.unsubscribed_at) out.set(u.id, "unsubscribed");
    else if (!c.marketing_consent) out.set(u.id, "no_consent");
    else out.set(u.id, "ok");
  }
  return out;
}
