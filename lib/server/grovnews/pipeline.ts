import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import type { Json } from "@/lib/database.types";
import {
  FETCHED_TYPES, findSimilar, normalizeTitle, normalizeUrl, relatedCandidates, warsawDate,
} from "@/lib/grovnews-research";
import { SafeFetchError, fetchPageRespectingRobots, safeFetch } from "./fetch";
import { extractListing, parseFeed } from "./feed";
import { analyzeItem, grovnewsEngine, writeDigest, writeDraft, type Engine } from "./ai";
import {
  blurbText, composePost, digestLinks, digestUtm, fallbackBlurb, fallbackIntro, linkedSlugs, renderDigestHtml,
} from "./compose";
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
  const doc = source.type === "WEB_PAGE"
    ? await fetchPageRespectingRobots(source.url, { accept: ACCEPT.WEB_PAGE, maxBytes: 1_500_000 })
    : await safeFetch(source.url, { accept: ACCEPT[source.type] ?? ACCEPT.RSS, maxBytes: 2_000_000 });
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
  db: Client, ctx: store.JobContext, b: Budget, onlySourceId?: string,
): Promise<IngestReport> {
  const report: IngestReport = { sources: 0, failed: 0, inserted: 0, duplicates: 0, stale: 0, skipped: 0, errors: [] };
  const recent = [...ctx.recent];
  const sources = ctx.sources.filter((s) => (onlySourceId ? s.id === onlySourceId : true) && s.type !== "MANUAL");
  // Official and high-priority sources first, so when two report the same
  // story the official one is the original and the other its reference.
  sources.sort((a, x) => Number(x.official) - Number(a.official) || x.priority - a.priority);

  await pool(sources, 4, () => b.left() < 20_000, async (source) => {
    report.sources++;
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
    const res = await store.ingest(db, source.id, true, null, items);
    report.inserted += res.inserted;
    report.duplicates += res.duplicates;
    report.stale += res.stale;
    report.skipped += res.skipped;
    recent.push(...(res.items ?? []));
  });
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
  const edition = { date: source.date, title: source.title, intro: source.intro };
  const mail = await composeEditionMail(engine, edition, source.posts);
  const { html, links } = mailBody(edition, mail.intro, source.posts, mail.blurbs);
  const res = await store.editionSend(db, {
    editionId, subject: mail.subject, preview: mail.preview, body: html, links, utm: digestUtm(source.date),
  });
  return { status: res.status, recipients: res.recipients ?? 0, aiUsed: mail.aiUsed };
}

/* ── the daily run ─────────────────────────────────────────────────────────── */

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
 */
export async function runDaily(db: Client, trigger: "CRON" | "ADMIN", budgetMs: number): Promise<RunReport> {
  const b = budget(budgetMs);
  await store.editionsSync(db);
  const claim = await store.runClaim(db, trigger);
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };

  const runId = claim.run_id;
  let stage = claim.stage;
  const stats: Record<string, Json> = {};
  try {
    const ctx = await store.jobContext(db);
    const automatic = ctx.settings.mode === "AUTOMATIC";
    let engine: Engine | null | undefined;
    const getEngine = async () => (engine === undefined ? (engine = await grovnewsEngine(db)) : engine);

    if (stage === "INGEST") {
      const r = await ingestSources(db, ctx, b);
      stats.ingest = { sources: r.sources, failed: r.failed, inserted: r.inserted, duplicates: r.duplicates, stale: r.stale };
      stage = "ANALYZE";
      await store.runUpdate(db, runId, { stage, stats });
    }

    if (stage === "ANALYZE") {
      const eng = await getEngine();
      const fresh = await store.jobContext(db);
      let total = 0;
      let failed = 0;
      for (;;) {
        const r = await analyzeQueue(db, fresh, eng, b);
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
      stats.selected = await store.selectTop(db);
      stage = "DRAFT";
      await store.runUpdate(db, runId, { stage, stats });
    }

    if (stage === "DRAFT") {
      const r = await draftQueue(db, await getEngine(), b, automatic);
      stats.drafts = { created: r.created, published: r.published, failed: r.failed };
      if (r.providerDown) stats.ai = "provider_down";
      if (!r.unavailable && !r.providerDown && b.left() < 45_000 && (await store.draftWork(db, 1)).length > 0) {
        await store.runUpdate(db, runId, { stage, stats, release: true });
        return { status: "partial", stage, stats };
      }
      stage = "EDITION";
      await store.runUpdate(db, runId, { stage, stats });
    }

    let editionId: string | null = null;
    if (stage === "EDITION") {
      const r = await store.buildEdition(db, claim.run_date || warsawDate(), automatic);
      editionId = r.edition_id;
      stats.edition = { id: r.edition_id, status: r.status, created: r.created, added: r.added };
      stage = automatic && r.status === "PUBLISHED" ? "SEND" : "DONE";
      await store.runUpdate(db, runId, { stage, stats });
    }

    if (stage === "SEND") {
      if (!editionId) {
        const again = await store.buildEdition(db, claim.run_date || warsawDate(), true);
        editionId = again.edition_id;
      }
      if (editionId) {
        const r = await autoSendEdition(db, await getEngine(), editionId);
        stats.send = r;
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
