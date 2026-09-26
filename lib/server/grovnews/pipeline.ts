import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import type { Json } from "@/lib/database.types";
import {
  FETCHED_TYPES, findSimilar, normalizeTitle, normalizeUrl, relatedCandidates, warsawDate,
} from "@/lib/grovnews-research";
import { SafeFetchError, fetchPageRespectingRobots } from "./fetch";
import { extractListing, parseFeed } from "./feed";
import { analyzeItem, grovnewsEngine, writeDigest, writeDraft, type Engine } from "./ai";
import {
  blurbText, composePost, digestLinks, digestUtm, fallbackBlurb, fallbackIntro, linkedSlugs, renderDigestHtml,
} from "./compose";
import { buildTopics, composeDaily, composeDailyMail, mailBodyDaily, writeDaily } from "./daily";
import * as store from "./store";

/**
 * THE GROVNEWS PIPELINE — sources → research items → analysis → selection →
 * drafts → the day's edition → (AUTOMATIC only) the mail.
 *
 * ONE CODE PATH FOR THE SCHEDULER AND THE ADMIN. The cron route and the
 * admin's "Uruchom teraz" both call these functions; what differs is only who
 * started it. Every write goes through the token-gated doors in ./store.
 *
 * BOUNDED AND RESUMABLE. A run works against a deadline and stops cleanly
 * before it; the run ledger (grovnews_runs) remembers the stage, and the next
 * tick continues from there. Every step is idempotent, so a repeated or
 * overlapping call is harmless: the same URL is one item, the same item is
 * one post, the same day is one edition, the same edition is one campaign.
 *
 * FAILURES ARE LOUD. A step that fails throws; the route answers 500 and the
 * ledger records the error. Nothing here turns a failure into "nothing to do".
 */

export type Budget = { deadline: number; left(): number };

export function budget(ms: number, now: () => number = Date.now): Budget {
  const deadline = now() + ms;
  return { deadline, left: () => deadline - now() };
}

const DAY = 24 * 3600_000;
const STALE_AFTER = 7 * DAY;
/** Entries stored per source per read (the newest first). A source is one
 *  voice among many; the day needs its latest news, not its archive. */
export const PER_SOURCE_ITEMS = 30;
/** Model calls spent on analysis per run, at most — the rest waits (and a
 *  story nobody reached in three days expires without costing a call). */
export const ANALYZE_CAP = 120;

export function contentHash(title: string, excerpt: string): string {
  return createHash("sha256").update(`${normalizeTitle(title)}\n${excerpt.slice(0, 500).toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex");
}

/** A bounded pool: at most `limit` tasks at once, stopping new work when
 *  `stop()` says so. Returns how many tasks ran. */
async function pool<T>(items: readonly T[], limit: number, stop: () => boolean, task: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let ran = 0;
  const worker = async () => {
    while (next < items.length && !stop()) {
      const item = items[next++];
      ran++;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return ran;
}

/* ── 1. INGEST ─────────────────────────────────────────────────────────────── */

export type IngestReport = {
  sources: number; failed: number; inserted: number; duplicates: number; stale: number; skipped: number;
  errors: { sourceId: string; code: string }[];
  /** 0125: reads that worked, entries they listed, sources left for the next
   *  invocation of the same run, and the sources this call reached. */
  succeeded?: number; found?: number; remaining?: number; done?: string[];
};

const ACCEPT: Record<string, string> = {
  RSS: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
  ATOM: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
  PUBLIC_FEED: "application/feed+json, application/json;q=0.9, application/rss+xml;q=0.8, application/atom+xml;q=0.8, application/xml;q=0.7, */*;q=0.1",
  WEB_PAGE: "text/html, application/xhtml+xml;q=0.9, */*;q=0.1",
};

export function errorCode(e: unknown): string {
  if (e instanceof SafeFetchError) return e.status ? `${e.code}_${e.status}` : e.code;
  if (e instanceof Error && /^[a-z_]{2,40}$/.test(e.message)) return e.message;
  return "error";
}

/** Download one source and turn its entries into item payloads. Pure of the
 *  database: the caller stores the result. */
export async function readSource(source: store.SourceRef, recent: store.RecentItem[], now: number): Promise<store.IngestItem[]> {
  if (!source.url) throw new Error("no_url");
  // robots.txt is honoured for every source type, at every redirect (0125).
  const doc = source.type === "WEB_PAGE"
    ? await fetchPageRespectingRobots(source.url, { accept: ACCEPT.WEB_PAGE, maxBytes: 1_500_000 })
    : await fetchPageRespectingRobots(source.url, { accept: ACCEPT[source.type] ?? ACCEPT.RSS, maxBytes: 2_000_000 });
  const parsed = source.type === "WEB_PAGE" ? extractListing(doc.body, doc.url) : parseFeed(doc.body, doc.url, now);
  if (!parsed) throw new Error("unrecognized_format");

  const items: store.IngestItem[] = [];
  for (const e of parsed.entries) {
    const nurl = normalizeUrl(e.url);
    if (!nurl) continue;
    const titleNorm = normalizeTitle(e.title);
    const hash = contentHash(e.title, e.excerpt);
    const published = e.publishedAt ? Date.parse(e.publishedAt) : NaN;
    items.push({
      url: e.url, nurl, title: e.title, excerpt: e.excerpt, published_at: e.publishedAt, hash, title_norm: titleNorm,
      duplicate_of: findSimilar(titleNorm, recent),
      stale: Number.isFinite(published) && now - published > STALE_AFTER,
      metadata: {
        kind: parsed.kind,
        ...(e.guid ? { guid: e.guid } : {}),
        ...(e.categories.length ? { feed_categories: e.categories as Json } : {}),
      },
    });
  }
  return items;
}

export async function ingestSources(
  db: Client, ctx: store.JobContext, b: Budget, onlySourceId?: string, alreadyRead?: ReadonlySet<string>,
): Promise<IngestReport> {
  const report: IngestReport = {
    sources: 0, failed: 0, inserted: 0, duplicates: 0, stale: 0, skipped: 0, errors: [], succeeded: 0, found: 0, remaining: 0, done: [],
  };
  const recent = [...ctx.recent];
  const all = ctx.sources.filter((s) => (onlySourceId ? s.id === onlySourceId : true) && s.type !== "MANUAL");
  // A run that resumes reads only the sources it has not reached yet: a long
  // list is read across invocations, never dropped (0125 §2.4). Tracked by
  // id, so an admin's health check in between does not count as a read.
  const sources = alreadyRead ? all.filter((s) => !alreadyRead.has(s.id)) : all;
  // Official and high-priority sources first, so when two report the same
  // story the official one is the original and the other its reference.
  sources.sort((a, x) => Number(x.official) - Number(a.official) || x.priority - a.priority);
  const lookbackMs = Math.max(12, ctx.settings.lookbackHours) * 3600_000;

  const ran = await pool(sources, 4, () => b.left() < 20_000, async (source) => {
    report.sources++;
    report.done?.push(source.id);
    if (source.type === "API") {
      // No API adapter is registered until a provider with a real key exists
      // (CLAUDE.md: never fake a provider). Recorded, not silently skipped.
      await store.ingest(db, source.id, false, "adapter_unavailable", []);
      report.failed++;
      report.errors.push({ sourceId: source.id, code: "adapter_unavailable" });
      return;
    }
    if (!FETCHED_TYPES.includes(source.type)) return;
    let items: store.IngestItem[];
    try {
      items = await readSource(source, recent, Date.now());
    } catch (e) {
      const code = errorCode(e);
      await store.ingest(db, source.id, false, code, []);
      report.failed++;
      report.errors.push({ sourceId: source.id, code });
      return;
    }
    // Newest first, capped; anything older than the lookback is remembered
    // but not news (never analysed) — deterministic, before any model.
    const now = Date.now();
    // Feeds list in either order; the newest are kept. An undated entry may
    // be today's, so it is never the one the cap drops (ties keep the feed's
    // own order).
    const dated = (it: store.IngestItem) => {
      const t = it.published_at ? Date.parse(it.published_at) : Number.NaN;
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const newestFirst = items.map((it, i) => ({ it, i })).sort((a, b) => dated(b.it) - dated(a.it) || a.i - b.i).map((x) => x.it);
    const capped = newestFirst.slice(0, PER_SOURCE_ITEMS).map((it) => {
      const published = it.published_at ? Date.parse(it.published_at) : Number.NaN;
      return Number.isFinite(published) && now - published > lookbackMs ? { ...it, stale: true } : it;
    });
    const res = await store.ingest(db, source.id, true, null, capped);
    report.succeeded = (report.succeeded ?? 0) + 1;
    report.found = (report.found ?? 0) + capped.length;
    report.inserted += res.inserted;
    report.duplicates += res.duplicates;
    report.stale += res.stale;
    report.skipped += res.skipped;
    recent.push(...(res.items ?? []));
  });
  report.remaining = sources.length - ran;
  return report;
}

/* ── 2. ANALYSE ────────────────────────────────────────────────────────────── */

/**
 * The whole provider chain is down or refusing (bad key, quota, overload,
 * timeouts) — not a verdict on the ITEM. Such a failure stops the batch
 * instead of spending the item's three attempts on an outage.
 */
const PROVIDER_DOWN = new Set([
  "analysis_unavailable", "analysis_quota", "analysis_rate_limited", "analysis_overloaded",
  "analysis_timeout", "analysis_unreachable",
]);
export const isProviderDown = (e: unknown): boolean => PROVIDER_DOWN.has(errorCode(e));

export type AnalyzeReport = { analyzed: number; failed: number; remaining: number; unavailable: boolean; providerDown: boolean };

export async function analyzeQueue(
  db: Client, ctx: store.JobContext, engine: Engine | null, b: Budget, limit = 30,
): Promise<AnalyzeReport> {
  if (!engine) return { analyzed: 0, failed: 0, remaining: 0, unavailable: true, providerDown: false };
  const work = await store.analyzeWork(db, limit);
  const categories = ctx.categories.map((c) => c.slug);
  let analyzed = 0;
  let failed = 0;
  let providerDown = false;
  // One model call can take tens of seconds; new calls stop well before the
  // deadline so a started one can still finish and be saved.
  const ran = await pool(work, 3, () => providerDown || b.left() < 45_000, async (item) => {
    const candidates = relatedCandidates(normalizeTitle(item.title), ctx.recent.filter((r) => r.id !== item.id));
    try {
      const a = await analyzeItem(engine, item, { categories, candidates });
      await store.saveAnalysis(db, item.id, {
        ok: true, category: a.category, relevance: a.relevance, importance: a.importance, title: a.title,
        summary: a.summary, reason: a.reason, sensitive: a.sensitive, review_required: a.reviewRequired,
        review_reason: a.reviewReason, duplicate_of: a.duplicateOf,
      });
      analyzed++;
    } catch (e) {
      if (e instanceof store.StoreError) throw e;
      if (isProviderDown(e)) {
        providerDown = true;
        return;
      }
      // A model that did not answer (or answered nonsense) leaves the item
      // waiting — it is never published, never half-saved.
      await store.saveAnalysis(db, item.id, { ok: false, error: errorCode(e) });
      failed++;
    }
  });
  return { analyzed, failed, remaining: work.length - ran, unavailable: false, providerDown };
}

/* ── 3. DRAFT ──────────────────────────────────────────────────────────────── */

export type DraftReport = { created: number; published: number; failed: number; unavailable: boolean; providerDown: boolean };

export async function draftQueue(
  db: Client, engine: Engine | null, b: Budget, publish: boolean, onlyItemId?: string,
): Promise<DraftReport> {
  if (!engine) return { created: 0, published: 0, failed: 0, unavailable: true, providerDown: false };
  const work = (await store.draftWork(db, onlyItemId ? 50 : 10)).filter((w) => (onlyItemId ? w.id === onlyItemId : true));
  const report: DraftReport = { created: 0, published: 0, failed: 0, unavailable: false, providerDown: false };
  await pool(work, 2, () => report.providerDown || b.left() < 45_000, async (item) => {
    let post: store.PostPayload;
    try {
      post = composePost(await writeDraft(engine, item), item);
    } catch (e) {
      if (e instanceof store.StoreError) throw e;
      if (isProviderDown(e)) report.providerDown = true;
      else report.failed++;
      return;
    }
    // Whether it is published is the DATABASE's decision (0121 §6.7).
    const res = await store.createPost(db, item.id, post, publish);
    if (res.created) report.created++;
    if (res.status === "PUBLISHED") report.published++;
  });
  return report;
}

/* ── 4. THE MAIL (AUTOMATIC mode) ──────────────────────────────────────────── */

export type EditionMailPost = store.MailSourcePost;

/** The day's copy: the model's when it answers, the posts' own words when it
 *  does not. Never an empty mail. */
export async function composeEditionMail(
  engine: Engine | null, edition: { date: string; title: string; intro: string }, posts: readonly EditionMailPost[],
): Promise<{ subject: string; preview: string; intro: string; blurbs: Map<string, string>; aiUsed: boolean }> {
  if (posts.length === 0) throw new Error("edition_empty");
  let copy: Awaited<ReturnType<typeof writeDigest>> | null = null;
  if (engine) {
    try {
      copy = await writeDigest(engine, posts);
    } catch {
      copy = null;
    }
  }
  const blurbs = new Map<string, string>();
  for (const p of posts) {
    const ai = copy?.items.get(p.id);
    blurbs.set(p.id, ai ? blurbText(ai.blurb, ai.why) : fallbackBlurb(p));
  }
  return {
    subject: copy?.subject || edition.title,
    preview: copy?.preview || posts[0].title.slice(0, 140),
    intro: edition.intro.trim() || copy?.intro || fallbackIntro(posts.length),
    blurbs,
    aiUsed: copy !== null,
  };
}

export function mailBody(edition: { date: string; title: string }, intro: string, posts: readonly EditionMailPost[], blurbs: Map<string, string>) {
  const html = renderDigestHtml({
    editionDate: edition.date, title: edition.title, intro,
    entries: posts.map((p) => ({ slug: p.slug, title: p.title, blurb: blurbs.get(p.id) ?? fallbackBlurb(p) })),
  });
  const slugs = new Set(posts.map((p) => p.slug));
  if (linkedSlugs(html).some((s) => !slugs.has(s))) throw new Error("foreign_link");
  return { html, links: digestLinks(html, edition.date) };
}

/** AUTOMATIC mode: write the day's mail from the edition's published posts
 *  and hand it to the newsletter queue through the one unattended door. */
export async function autoSendEdition(db: Client, engine: Engine | null, editionId: string) {
  const source = await store.editionMailSource(db, editionId);
  if (!source || source.posts.length === 0) return { status: "edition_empty", recipients: 0, aiUsed: false };
  if (source.articlePostId) {
    // The day's ONE article: its mail was written with it, and links to it
    // alone (0125 §6).
    const article = source.posts.find((p) => p.id === source.articlePostId);
    if (!article || !source.daily) return { status: "edition_empty", recipients: 0, aiUsed: false };
    const mail = composeDailyMail(source.date, source.daily);
    const { html, links } = mailBodyDaily(source.date, article.slug, mail);
    const res = await store.editionSend(db, {
      editionId, subject: mail.subject, preview: mail.preview, body: html, links, utm: digestUtm(source.date),
    });
    return { status: res.status, recipients: res.recipients ?? 0, aiUsed: false };
  }
  const edition = { date: source.date, title: source.title, intro: source.intro };
  const mail = await composeEditionMail(engine, edition, source.posts);
  const { html, links } = mailBody(edition, mail.intro, source.posts, mail.blurbs);
  const res = await store.editionSend(db, {
    editionId, subject: mail.subject, preview: mail.preview, body: html, links, utm: digestUtm(source.date),
  });
  return { status: res.status, recipients: res.recipients ?? 0, aiUsed: mail.aiUsed };
}

/* ── 5. THE DAY'S ARTICLE ───────────────────────────────────────────────────── */

export type DailyReport = {
  outcome: "written" | "no_topics" | "ai_unavailable" | "provider_down";
  topics: number; merged: number;
  article?: store.DailyArticleResult; review?: string[];
};

/**
 * Today's SELECTED topics → ONE article (0125 §5). No valuable topic, no
 * article — never filler. No model, no article — and no pretending: the run
 * says so and tries again later. Whether it publishes is the database's call
 * (per topic); `publish` is only the request.
 */
export async function draftDaily(
  db: Client, settings: store.JobContext["settings"], engine: Engine | null, date: string,
  opts: { publish: boolean; sourcesFailed: boolean },
): Promise<DailyReport> {
  const candidates = await store.dailyCandidates(db, date);
  const { topics, merged } = buildTopics(candidates, settings);
  if (topics.length === 0) {
    // A run resumed after the day's article was written (its topics are now
    // USED) carries on with that article — the day is not closed without it.
    const written = await store.dailyArticleOf(db, date);
    if (!written) return { outcome: "no_topics", topics: 0, merged };
    const source = written.edition_id ? await store.editionMailSource(db, written.edition_id) : null;
    return { outcome: "written", topics: source?.daily?.topics.length ?? 0, merged: 0, article: written, review: source?.daily?.review.reasons ?? [] };
  }
  if (!engine) return { outcome: "ai_unavailable", topics: topics.length, merged };
  let copy: Awaited<ReturnType<typeof writeDaily>>;
  try {
    copy = await writeDaily(engine, date, topics);
  } catch (e) {
    if (e instanceof store.StoreError) throw e;
    if (isProviderDown(e)) return { outcome: "provider_down", topics: topics.length, merged };
    throw e;
  }
  const composed = composeDaily(date, topics, copy, { minTopics: settings.minTopics, sourcesFailed: opts.sourcesFailed });
  const article = await store.dailyArticle(db, {
    date, itemIds: composed.itemIds, post: composed.post, absorbed: composed.absorbed,
    publish: opts.publish && composed.reviewReasons.length === 0,
    reviewReason: composed.reviewReasons.join(","),
  });
  return { outcome: "written", topics: composed.itemIds.length, merged, article, review: composed.reviewReasons };
}

/* ── the daily run ─────────────────────────────────────────────────────────── */

type Counts = Record<string, number>;
const counts = (v: Json | undefined): Counts =>
  (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number")) : {}) as Counts;
const add = (a: Counts, b: Counts): Counts => {
  const out: Counts = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};

export type RunReport = {
  status: "done" | "partial" | "skipped";
  reason?: string;
  stage?: string;
  stats?: Record<string, Json>;
};

/**
 * One invocation of the day's run: claim the day, continue from its stage,
 * stop before the deadline. Throws on any failure after recording it in the
 * ledger, so the caller (the route) answers 500 and the scheduler retries on
 * the next tick — up to the ledger's attempt ceiling.
 *
 * STAGE 5: the day produces ONE article and at most ONE mail.
 *   INGEST   every enabled source, across as many invocations as it takes;
 *   ANALYZE  at most ANALYZE_CAP model calls, best-ranked items first;
 *   DRAFT    today's topics → one article (+ its edition);
 *   EDITION  the edition as the article left it;
 *   SEND     AUTOMATIC only, e-mail on, the article PUBLISHED — the database
 *            checks all of it again.
 * FAIL-SAFE: half the sources failing, any topic in doubt, too few topics —
 * the article waits for a person. No model — nothing is written, and the run
 * tries again later instead of finishing the day empty-handed.
 */
export async function runDaily(db: Client, trigger: "CRON" | "ADMIN", budgetMs: number): Promise<RunReport> {
  const b = budget(budgetMs);
  await store.editionsSync(db);
  const claim = await store.runClaim(db, trigger);
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };

  const runId = claim.run_id;
  let stage = claim.stage;
  const stats: Record<string, Json> = { ...(claim.stats ?? {}) };
  const date = claim.run_date || warsawDate();
  try {
    const ctx = await store.jobContext(db);
    const automatic = ctx.settings.mode === "AUTOMATIC";
    let engine: Engine | null | undefined;
    const getEngine = async () => (engine === undefined ? (engine = await grovnewsEngine(db)) : engine);

    if (stage === "INGEST") {
      const read = Array.isArray(stats.ingest_done)
        ? stats.ingest_done.filter((id): id is string => typeof id === "string")
        : [];
      const r = await ingestSources(db, ctx, b, undefined, new Set(read));
      stats.ingest = add(counts(stats.ingest), {
        sources: r.sources, succeeded: r.succeeded ?? 0, failed: r.failed, found: r.found ?? 0, inserted: r.inserted,
        duplicates: r.duplicates, stale: r.stale, skipped: r.skipped,
      });
      if ((r.remaining ?? 0) > 0) {
        // Out of time with sources still unread: the next tick continues.
        stats.ingest_done = [...read, ...(r.done ?? [])];
        await store.runUpdate(db, runId, { stage, stats, release: true });
        return { status: "partial", stage, stats };
      }
      stats.ingest_done = null;
      stage = "ANALYZE";
      await store.runUpdate(db, runId, { stage, stats });
    }

    if (stage === "ANALYZE") {
      const eng = await getEngine();
      const fresh = await store.jobContext(db);
      const prev = counts(stats.analyze);
      let total = prev.analyzed ?? 0;
      let failed = prev.failed ?? 0;
      // A resumed run starts the verdict over: an earlier call's AI outage is
      // not this call's outcome (null, not delete: the ledger merges stats).
      stats.ai = null;
      stats.outcome = null;
      for (;;) {
        // Every model call counts — one whose answer failed validation too.
        if (total + failed >= ANALYZE_CAP) { stats.analyze_capped = true; break; }
        const r = await analyzeQueue(db, fresh, eng, b, Math.min(30, ANALYZE_CAP - total - failed));
        total += r.analyzed;
        failed += r.failed;
        if (r.unavailable) { stats.ai = "unavailable"; break; }
        // An outage is not a reason to keep calling: the items stay waiting
        // and the next run (or an admin) picks them up.
        if (r.providerDown) { stats.ai = "provider_down"; break; }
        if (r.remaining === 0 && r.analyzed + r.failed === 0) break;
        if (b.left() < 60_000) {
          stats.analyze = { analyzed: total, failed };
          await store.runUpdate(db, runId, { stage, stats, release: true });
          return { status: "partial", stage, stats };
        }
      }
      stats.analyze = { analyzed: total, failed };
      if (stats.ai === "unavailable" || stats.ai === "provider_down") {
        // FAIL-SAFE: without a model nothing is judged, so nothing is written
        // or sent — and the day is not closed as if there were no news.
        stats.outcome = stats.ai === "unavailable" ? "ai_unavailable" : "provider_down";
        await store.runUpdate(db, runId, { stage, stats, release: true });
        return { status: "partial", stage, stats };
      }
      stats.selected = await store.selectTop(db);
      stage = "DRAFT";
      await store.runUpdate(db, runId, { stage, stats });
    }

    if (stage === "DRAFT") {
      const ingest = counts(stats.ingest);
      const sourcesFailed = (ingest.sources ?? 0) > 0 && (ingest.failed ?? 0) * 2 >= (ingest.sources ?? 0);
      const r = await draftDaily(db, ctx.settings, await getEngine(), date, { publish: automatic, sourcesFailed });
      if (r.outcome === "ai_unavailable" || r.outcome === "provider_down") {
        stats.outcome = r.outcome;
        await store.runUpdate(db, runId, { stage, stats, release: true });
        return { status: "partial", stage, stats };
      }
      if (r.outcome === "no_topics" || !r.article) {
        // No valuable topic today: no article, no mail — never filler.
        stats.article = { topics: 0 };
        stats.outcome = "no_topics";
        stage = "DONE";
      } else {
        stats.article = {
          id: r.article.post_id, status: r.article.status, created: r.article.created, topics: r.topics, merged: r.merged,
          review: r.review ?? [], edition: r.article.edition_id, edition_status: r.article.edition_status,
          attached: r.article.attached !== false,
        };
        stats.outcome = r.article.status === "PUBLISHED" ? "published" : "draft_review";
        // An edition someone built by hand for today keeps its own posts; the
        // article then waits for a person, and nothing is built or sent.
        if (r.article.attached === false) stats.outcome = "not_attached";
        stage = r.article.attached === false ? "DONE" : "EDITION";
      }
      await store.runUpdate(db, runId, { stage, stats });
    }

    let editionId: string | null = null;
    if (stage === "EDITION") {
      // The article's edition, as the article left it (a builder never adds
      // a second post to it — 0125 §5.5).
      const r = await store.buildEdition(db, date, automatic);
      editionId = r.edition_id;
      stats.edition = { id: r.edition_id, status: r.status, created: r.created, added: r.added };
      const sendable = automatic && r.status === "PUBLISHED" && ctx.settings.emailEnabled;
      if (automatic && r.status === "PUBLISHED" && !ctx.settings.emailEnabled) stats.outcome = "published_email_off";
      stage = sendable ? "SEND" : "DONE";
      await store.runUpdate(db, runId, { stage, stats });
    }

    if (stage === "SEND") {
      if (!editionId) {
        const again = await store.buildEdition(db, date, true);
        editionId = again.edition_id;
      }
      if (editionId) {
        const r = await autoSendEdition(db, await getEngine(), editionId);
        stats.send = r;
        stats.outcome = r.status === "queued" ? "published_queued" : `published_${r.status}`;
      }
      stage = "DONE";
    }

    await store.runUpdate(db, runId, { stage: "DONE", status: "DONE", stats });
    return { status: "done", stage: "DONE", stats };
  } catch (e) {
    await store.runUpdate(db, runId, { stage, stats, error: errorCode(e), release: true }).catch(() => undefined);
    throw e;
  }
}
