import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { Json } from "@/lib/database.types";
import { dispatchToken } from "@/lib/server/server-token";
import {
  DEFAULT_SETTINGS, readDailyRecord, type DailyRecord, type GrovNewsSettings, type GrovNewsMode, type SourceType,
} from "@/lib/grovnews-research";

export type { DailyRecord, DailyTopicRecord } from "@/lib/grovnews-research";

/**
 * THE DAILY JOB'S DATABASE DOORS (migration 0121 §6), typed.
 *
 * Every call carries the dispatch token and works the same from the cron
 * route (anonymous client, no user) and from an admin's server action (their
 * own client): the token, checked inside SECURITY DEFINER functions, is the
 * authority — never the session. That is what lets the admin's "Uruchom
 * teraz" button and the 06:00 run be ONE code path.
 *
 * AN ERROR IS AN ERROR. supabase-js returns failures as `{ data: null, error }`
 * rather than throwing; every wrapper here turns that into a thrown
 * `StoreError`, so a job can never read "permission denied" as "nothing to
 * do" and report success (the STRIPE LIVE lesson, and ADR "Zadania w tle":
 * 200 after a swallowed failure is the worst possible outcome).
 */

export class StoreError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "StoreError";
  }
}

function token(): string {
  const t = dispatchToken();
  if (!t) throw new StoreError("no_server_token");
  return t;
}

/** Whether this deployment can run the job at all (it needs the server key). */
export const serverTokenAvailable = (): boolean => dispatchToken() !== null;

async function unwrap<T>(call: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new StoreError(error.message.slice(0, 120) || "rpc_failed");
  return data as T;
}

export type SourceRef = {
  id: string; name: string; type: SourceType; url: string | null; categoryId: string | null;
  priority: number; official: boolean; language: "pl" | "en" | "de";
};
export type CategoryRef = { id: string; slug: string; name: string };
export type RecentItem = { id: string; hash: string; title: string };
export type JobContext = { settings: GrovNewsSettings; sources: SourceRef[]; categories: CategoryRef[]; recent: RecentItem[] };

type RawSettings = {
  mode?: string; daily_enabled?: boolean; run_hour?: number; min_relevance?: number; min_importance?: number;
  max_topics?: number; auto_publish_official_sensitive?: boolean;
  min_topics?: number; lookback_hours?: number; email_enabled?: boolean;
};

export function settingsFromRow(raw: RawSettings | null | undefined): GrovNewsSettings {
  if (!raw) return DEFAULT_SETTINGS;
  return {
    mode: raw.mode === "AUTOMATIC" ? "AUTOMATIC" : "REVIEW" as GrovNewsMode,
    dailyEnabled: raw.daily_enabled === true,
    runHour: raw.run_hour ?? DEFAULT_SETTINGS.runHour,
    timezone: "Europe/Warsaw",
    minRelevance: raw.min_relevance ?? DEFAULT_SETTINGS.minRelevance,
    minImportance: raw.min_importance ?? DEFAULT_SETTINGS.minImportance,
    maxTopics: raw.max_topics ?? DEFAULT_SETTINGS.maxTopics,
    autoPublishOfficialSensitive: raw.auto_publish_official_sensitive === true,
    minTopics: raw.min_topics ?? DEFAULT_SETTINGS.minTopics,
    lookbackHours: raw.lookback_hours ?? DEFAULT_SETTINGS.lookbackHours,
    emailEnabled: raw.email_enabled !== false,
  };
}

export async function jobContext(db: Client): Promise<JobContext> {
  const raw = await unwrap<{
    settings: RawSettings; recent: RecentItem[]; categories: CategoryRef[];
    sources: { id: string; name: string; type: SourceType; url: string | null; category_id: string | null;
      priority: number; official: boolean; language: "pl" | "en" | "de" }[];
  }>(db.rpc("grovnews_job_context", { p_token: token() }));
  return {
    settings: settingsFromRow(raw.settings),
    sources: (raw.sources ?? []).map((s) => ({
      id: s.id, name: s.name, type: s.type, url: s.url, categoryId: s.category_id,
      priority: s.priority, official: s.official, language: s.language,
    })),
    categories: raw.categories ?? [],
    recent: raw.recent ?? [],
  };
}

export type IngestItem = {
  url: string; nurl: string; title: string; excerpt: string; published_at: string | null;
  hash: string; title_norm: string; duplicate_of: string | null; stale: boolean; metadata: Record<string, Json>;
};
export type IngestResult = {
  inserted: number; duplicates: number; skipped: number; stale: number; items: RecentItem[];
  /** 0125: how many entries the read listed; whether it was the source's
   *  first stored read (its baseline). */
  entries?: number; baseline?: boolean;
};

export async function ingest(db: Client, sourceId: string, ok: boolean, error: string | null, items: IngestItem[]): Promise<IngestResult> {
  return unwrap<IngestResult>(db.rpc("grovnews_ingest", {
    p_token: token(), p_source_id: sourceId, p_ok: ok, p_error: error ?? "", p_items: items as unknown as Json,
  }));
}

export type AnalyzeWork = {
  id: string; url: string; title: string; excerpt: string; published_at: string | null;
  source_name: string; official: boolean; priority: number; category: string | null;
};
export type DraftWork = {
  id: string; url: string; title: string; excerpt: string; published_at: string | null;
  ai_title: string | null; ai_summary: string | null; ai_reason: string | null; category_id: string | null;
  relevance_score: number | null; importance_score: number | null; sensitive: boolean; review_required: boolean;
  source_name: string; official: boolean; language: "pl" | "en" | "de";
  related: { url: string; title: string; source: string; official: boolean }[];
};

export async function analyzeWork(db: Client, limit: number): Promise<AnalyzeWork[]> {
  return (await unwrap<AnalyzeWork[] | null>(db.rpc("grovnews_work_items", { p_token: token(), p_kind: "analyze", p_limit: limit }))) ?? [];
}

export async function draftWork(db: Client, limit: number): Promise<DraftWork[]> {
  return (await unwrap<DraftWork[] | null>(db.rpc("grovnews_work_items", { p_token: token(), p_kind: "draft", p_limit: limit }))) ?? [];
}

export type AnalysisRecord =
  | { ok: false; error: string }
  | {
      ok: true; category: string | null; relevance: number; importance: number; title: string; summary: string;
      reason: string; sensitive: boolean; review_required: boolean; review_reason: string; duplicate_of: string | null;
    };

export async function saveAnalysis(db: Client, itemId: string, result: AnalysisRecord): Promise<string> {
  return unwrap<string>(db.rpc("grovnews_save_analysis", { p_token: token(), p_item_id: itemId, p_result: result as unknown as Json }));
}

export async function selectTop(db: Client): Promise<number> {
  return unwrap<number>(db.rpc("grovnews_select_top", { p_token: token() }));
}

export type PostPayload = {
  title: string; slug: string; excerpt: string; content: string; tags: string[];
  sources: { url: string; title: string | null }[]; read_minutes: number; language: "pl" | "en" | "de";
};

export async function createPost(db: Client, itemId: string, post: PostPayload, publish: boolean):
  Promise<{ post_id: string; slug: string; status: string; created: boolean }> {
  return unwrap(db.rpc("grovnews_create_post", {
    p_token: token(), p_item_id: itemId, p_post: post as unknown as Json, p_publish: publish,
  }));
}

export async function buildEdition(db: Client, date: string, publishedOnly: boolean):
  Promise<{ edition_id: string | null; status: string | null; created: boolean; added: number }> {
  return unwrap(db.rpc("grovnews_build_edition", { p_token: token(), p_date: date, p_published_only: publishedOnly }));
}

export async function groupSync(db: Client): Promise<{ group_id: string; added: number; removed: number }> {
  return unwrap(db.rpc("grovnews_group_sync", { p_token: token() }));
}

export async function editionSend(db: Client, input: {
  editionId: string; subject: string; preview: string; body: string; links: string[];
  utm: { source: string; medium: string; campaign: string };
}): Promise<{ status: "queued" | "already_queued" | "no_recipients"; campaign_id?: string; recipients?: number }> {
  return unwrap(db.rpc("grovnews_edition_send", {
    p_token: token(), p_edition_id: input.editionId, p_subject: input.subject, p_preview: input.preview,
    p_body: input.body, p_links: input.links, p_utm: input.utm,
  }));
}

export async function editionsSync(db: Client): Promise<number> {
  return unwrap<number>(db.rpc("grovnews_editions_sync", { p_token: token() }));
}

export type RunClaim =
  | { claimed: true; run_id: string; stage: string; stats: Record<string, Json>; run_date: string }
  | { claimed: false; reason: string; run_id?: string };

export async function runClaim(db: Client, trigger: "CRON" | "ADMIN"): Promise<RunClaim> {
  return unwrap<RunClaim>(db.rpc("grovnews_run_claim", { p_token: token(), p_trigger: trigger }));
}

export async function runUpdate(db: Client, runId: string, patch: {
  stage?: string; status?: "RUNNING" | "DONE" | "FAILED"; stats?: Record<string, Json>; error?: string | null; release?: boolean;
}): Promise<void> {
  await unwrap<null>(db.rpc("grovnews_run_update", {
    p_token: token(), p_run_id: runId, p_stage: patch.stage ?? null,
    p_status: patch.status ?? null, p_stats: (patch.stats ?? {}) as Json,
    p_error: patch.error ?? null, p_release: patch.release ?? false,
  }));
}

export async function aiProviders(db: Client): Promise<{ id: string; slug: string }[]> {
  return (await unwrap<{ id: string; slug: string }[] | null>(db.rpc("grovnews_ai_providers", { p_token: token() }))) ?? [];
}

export type MailSourcePost = {
  id: string; slug: string; title: string; excerpt: string; content: string;
  emailSummary: string | null; blurb: string | null;
};
export type MailSource = {
  date: string; title: string; intro: string; posts: MailSourcePost[];
  /** 0125: the day's article and its editorial record, when this is an
   *  article edition. */
  articlePostId?: string | null; daily?: DailyRecord | null;
};

/** The edition and its PUBLISHED posts, in order (0121 §6.8b, 0125 §5.6). */
export async function editionMailSource(db: Client, editionId: string): Promise<MailSource | null> {
  const raw = await unwrap<{
    date: string; title: string; intro: string | null; article_post_id?: string | null; daily?: unknown;
    posts: { id: string; slug: string; title: string; excerpt: string; content: string; email_summary: string | null; blurb: string | null }[];
  } | null>(db.rpc("grovnews_edition_mail_source", { p_token: token(), p_edition_id: editionId }));
  if (!raw) return null;
  return {
    date: raw.date, title: raw.title, intro: raw.intro ?? "",
    posts: (raw.posts ?? []).map((p) => ({
      id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, content: p.content,
      emailSummary: p.email_summary, blurb: p.blurb,
    })),
    articlePostId: raw.article_post_id ?? null,
    daily: readDailyRecord(raw.daily),
  };
}

/* ── 0125: source health, the day's topics, the day's article ─────────────── */

export type HealthResult = {
  ok: boolean; error: string | null; http: number | null; detected_type: string | null;
  resolved_url: string | null; entries: number | null;
};

/** Record one health check (admin session or the job's token). */
export async function sourceChecked(db: Client, sourceId: string, result: HealthResult): Promise<string> {
  return unwrap<string>(db.rpc("grovnews_source_checked", {
    p_token: dispatchToken() ?? "", p_source_id: sourceId, p_result: result as unknown as Json,
  }));
}

export type DailySource = {
  id: string; url: string; title: string; excerpt: string; published_at: string | null;
  source: string; official: boolean; priority: number; source_id: string | null;
  /** Review-flagged, or law/tax from an unofficial site (its excerpt still
   *  reaches the writer, so the topic waits for a person). */
  flagged?: boolean;
};
export type DailyCandidate = {
  id: string; url: string; title: string; excerpt: string; published_at: string | null; discovered_at: string;
  ai_title: string | null; ai_summary: string | null; ai_reason: string | null;
  relevance: number | null; importance: number | null; sensitive: boolean; review_required: boolean;
  review_reason: string | null; category: string | null;
  source_name: string; official: boolean; priority: number; language: "pl" | "en" | "de"; source_id: string | null;
  related: DailySource[];
};

/** Today's SELECTED topics, each with every report of the same story. */
export async function dailyCandidates(db: Client, date: string): Promise<DailyCandidate[]> {
  return (await unwrap<DailyCandidate[] | null>(db.rpc("grovnews_daily_candidates", { p_token: token(), p_date: date }))) ?? [];
}

export type DailyArticleResult = {
  post_id: string; slug: string; status: string; created: boolean;
  edition_id: string | null; edition_status: string | null; attached?: boolean;
};

/** The day's article when it is already written (its topics are then USED,
 *  so a resumed run finds no candidates) — or null. The database returns an
 *  existing article before it looks at the (here empty) topics; with none
 *  written it refuses the empty list, and nothing is written. */
export async function dailyArticleOf(db: Client, date: string): Promise<DailyArticleResult | null> {
  const { data, error } = await db.rpc("grovnews_daily_article", {
    p_token: token(), p_date: date, p_item_ids: [], p_post: {} as Json, p_publish: false, p_review_reason: "",
  });
  if (error) {
    if (/invalid_items/.test(error.message)) return null;
    throw new StoreError(error.message.slice(0, 120) || "rpc_failed");
  }
  return data as DailyArticleResult;
}

/** Write the day's ONE article (the database decides whether it publishes).
 *  `absorbed`: same-story items merged into a topic — claimed with it. */
export async function dailyArticle(db: Client, input: {
  date: string; itemIds: string[]; post: PostPayload & { daily: DailyRecord }; publish: boolean; reviewReason: string;
  absorbed?: string[];
}): Promise<DailyArticleResult> {
  const post = { ...input.post, absorbed: input.absorbed ?? [] };
  return unwrap<DailyArticleResult>(db.rpc("grovnews_daily_article", {
    p_token: token(), p_date: input.date, p_item_ids: input.itemIds, p_post: post as unknown as Json,
    p_publish: input.publish, p_review_reason: input.reviewReason,
  }));
}
