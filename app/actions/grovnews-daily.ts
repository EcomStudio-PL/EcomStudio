"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { estimateReadMinutes, isUuid } from "@/lib/grovnews";
import { cleanText, readDailyRecord, type DailyRecord, type DailyTopicRecord } from "@/lib/grovnews-research";
import * as store from "@/lib/server/grovnews/store";
import { grovnewsEngine } from "@/lib/server/grovnews/ai";
import {
  composeDailyMail, joinArticle, mailBodyDaily, mailText, splitArticle, toTopic, topicReview, topicSection, writeDaily, type Topic,
} from "@/lib/server/grovnews/daily";
import { saveStepAction } from "@/app/actions/newsletter";

/**
 * GROVNEWS STAGE 5 — REVIEW MODE for the day's ONE article (admin only).
 *
 * The article is an ordinary post (edited in the post editor); what this
 * adds is what a person needs to review a day at once: approve and publish
 * it, drop a topic, have one section rewritten, add a story the job left
 * out, and edit the mail's short copy. None of it sends anything — the mail
 * goes out through the existing edition screen, after the article is live.
 *
 * Every export re-checks the ADMIN ROLE first; RLS (0121/0125) and the
 * edition/post guards check again underneath. Topic edits are allowed only
 * while the article and its edition are still drafts.
 */

type Fail<E extends string = never> = { ok: false; error: "forbidden" | "invalid" | "generic" | E };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const forbidden = (e: unknown) => e instanceof Error && e.message === "forbidden";
const failed = (e: unknown): Fail => ({ ok: false, error: forbidden(e) ? "forbidden" : "generic" });

type Db = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

function revalidateDaily() {
  revalidatePath("/admin/newsletter/grovnews", "layout");
  revalidatePath("/grovnews", "layout");
}

type Loaded = {
  ed: { id: string; status: string; edition_date: string; campaign_id: string | null; article_post_id: string };
  post: { id: string; content: string; status: string; slug: string };
  record: DailyRecord;
};

/** The edition, its article and its record — or null when this is not an
 *  article edition. */
async function loadArticle(supabase: Db, editionId: string): Promise<Loaded | null> {
  const { data: ed } = await supabase.from("grovnews_editions")
    .select("id, status, edition_date, campaign_id, article_post_id, daily").eq("id", editionId).maybeSingle();
  if (!ed?.article_post_id) return null;
  const record = readDailyRecord(ed.daily);
  const { data: post } = await supabase.from("grovnews_posts").select("id, content, status, slug").eq("id", ed.article_post_id).maybeSingle();
  if (!record || !post) return null;
  return { ed: { ...ed, article_post_id: ed.article_post_id }, post, record };
}

/** Topics change only while nothing is published yet. */
const editable = (l: Loaded) => l.ed.status === "DRAFT" && l.post.status === "DRAFT";

/** A story and every report of it, read as the admin (RLS), in the shape the
 *  job's own candidates have. */
async function candidateFor(supabase: Db, itemId: string): Promise<store.DailyCandidate | null> {
  const cols = "id, canonical_url, source_title, source_excerpt, source_published_at, discovered_at, ai_title, ai_summary, ai_reason, relevance_score, importance_score, sensitive, review_required, review_reason, status, post_id, duplicate_of, source_id, category:grovnews_categories(slug), source:grovnews_sources(name, official_source, priority, language)";
  type Row = {
    id: string; canonical_url: string; source_title: string; source_excerpt: string; source_published_at: string | null;
    discovered_at: string; ai_title: string | null; ai_summary: string | null; ai_reason: string | null;
    relevance_score: number | null; importance_score: number | null; sensitive: boolean; review_required: boolean;
    review_reason: string | null; status: string; post_id: string | null; duplicate_of: string | null; source_id: string | null;
    category: { slug: string } | null; source: { name: string; official_source: boolean; priority: number; language: string } | null;
  };
  const { data: item } = await supabase.from("grovnews_research_items").select(cols).eq("id", itemId).maybeSingle();
  if (!item) return null;
  const i = item as unknown as Row;
  const { data: dups } = await supabase.from("grovnews_research_items").select(cols).eq("duplicate_of", itemId).limit(20);
  const lang = i.source?.language;
  return {
    id: i.id, url: i.canonical_url, title: i.source_title, excerpt: i.source_excerpt, published_at: i.source_published_at,
    discovered_at: i.discovered_at, ai_title: i.ai_title, ai_summary: i.ai_summary, ai_reason: i.ai_reason,
    relevance: i.relevance_score, importance: i.importance_score, sensitive: i.sensitive, review_required: i.review_required,
    review_reason: i.review_reason, category: i.category?.slug ?? null, source_name: i.source?.name ?? "",
    official: i.source?.official_source ?? false, priority: i.source?.priority ?? 50,
    language: lang === "en" || lang === "de" ? lang : "pl", source_id: i.source_id,
    related: ((dups ?? []) as unknown as Row[]).map((d) => ({
      id: d.id, url: d.canonical_url, title: d.source_title, excerpt: d.source_excerpt.slice(0, 600), published_at: d.source_published_at,
      source: d.source?.name ?? "", official: d.source?.official_source ?? false, priority: d.source?.priority ?? 50, source_id: d.source_id,
    })),
  };
}

/** The article-level review reasons, with "some topic needs review"
 *  recomputed from the topics that remain. */
function withReview(record: DailyRecord, topics: DailyTopicRecord[]): DailyRecord {
  const reasons = record.review.reasons.filter((r) => r !== "topic_review");
  if (topics.some((tp) => tp.review)) reasons.unshift("topic_review");
  return { ...record, topics, review: { required: reasons.length > 0, reasons } };
}

function postSourcesOf(topics: readonly DailyTopicRecord[]) {
  const seen = new Set<string>();
  return topics.flatMap((tp) => tp.sources)
    .sort((a, b) => Number(b.official) - Number(a.official))
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .slice(0, 30)
    .map((s) => ({ url: s.url, title: cleanText(s.source ? `${s.source}: ${s.title}` : s.title, 200).replace(/\n/g, " ") || null }));
}

/** Write the article's new text and record together (post first: it is the
 *  one a guard may refuse). */
async function saveArticle(supabase: Db, l: Loaded, content: string, record: DailyRecord): Promise<boolean> {
  const { error: pe } = await supabase.from("grovnews_posts").update({
    content, sources: postSourcesOf(record.topics), estimated_read_minutes: estimateReadMinutes(content),
  }).eq("id", l.post.id).eq("status", "DRAFT");
  if (pe) return false;
  const { error: ee } = await supabase.from("grovnews_editions").update({ daily: record as never }).eq("id", l.ed.id).eq("status", "DRAFT");
  return !ee;
}

/** One topic written by the model, checked like the day's article is. */
async function writeTopic(supabase: Db, date: string, topic: Topic, n: number):
  Promise<{ section: string; record: DailyTopicRecord } | "aiUnavailable" | "aiFailed"> {
  const engine = await grovnewsEngine(supabase);
  if (!engine) return "aiUnavailable";
  let copy;
  try {
    copy = (await writeDaily(engine, date, [topic])).topics[0];
  } catch {
    return "aiFailed";
  }
  if (!copy) return "aiFailed";
  const reasons = topicReview(topic, copy, date);
  const sources = [topic.primary, ...topic.supporting]
    .map((s) => ({ url: s.url, title: cleanText(s.title, 300).replace(/\n/g, " "), source: s.source, official: s.official }))
    .sort((a, b) => Number(b.official) - Number(a.official));
  return {
    section: topicSection(n, copy, sources),
    record: {
      itemId: topic.itemId, title: copy.title, short: copy.short || copy.title, mail: copy.mail || copy.short || copy.title,
      category: topic.category, confidence: topic.confidence, official: topic.official, sources: sources.slice(0, 12),
      review: reasons.length > 0, reviewReason: reasons.length ? reasons.join("; ").slice(0, 300) : null,
    },
  };
}

/* ── approve ───────────────────────────────────────────────────────────────── */

/** The reviewer's yes: publish the article, then its edition. Nothing is
 *  mailed here — the mail is prepared and sent from the edition screen, and
 *  only now can it be (it links to a published article). */
export async function approveDailyArticleAction(editionId: string): Promise<{ ok: true } | Fail<"notArticle" | "locked">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(editionId)) return { ok: false, error: "invalid" };
    const l = await loadArticle(supabase, editionId);
    if (!l) return { ok: false, error: "notArticle" };
    if (!["DRAFT", "READY"].includes(l.ed.status)) return { ok: false, error: "locked" };
    if (l.post.status === "DRAFT") {
      const { error } = await supabase.from("grovnews_posts")
        .update({ status: "PUBLISHED", published_at: new Date().toISOString() }).eq("id", l.post.id).eq("status", "DRAFT");
      if (error) return { ok: false, error: "generic" };
    } else if (l.post.status !== "PUBLISHED") {
      return { ok: false, error: "locked" };
    }
    if (l.ed.status === "DRAFT") {
      const { error } = await supabase.from("grovnews_editions").update({ status: "READY" }).eq("id", editionId).eq("status", "DRAFT");
      if (error) return { ok: false, error: "generic" };
    }
    const { error } = await supabase.from("grovnews_editions")
      .update({ status: "PUBLISHED", published_at: new Date().toISOString() }).eq("id", editionId).eq("status", "READY");
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.daily_approved", entityType: "grovnews_edition", entityId: editionId,
      after: { post: l.post.id, topics: l.record.topics.length, review: l.record.review.reasons },
    });
    revalidateDaily();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/* ── topics ────────────────────────────────────────────────────────────────── */

/** Drop one topic: its section leaves the article, its story goes back to the
 *  inbox as rejected. The last topic cannot be dropped (archive the edition
 *  instead). */
export async function removeDailyTopicAction(editionId: string, itemId: string):
  Promise<{ ok: true } | Fail<"notArticle" | "locked" | "lastTopic" | "structure">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(editionId) || !isUuid(itemId)) return { ok: false, error: "invalid" };
    const l = await loadArticle(supabase, editionId);
    if (!l) return { ok: false, error: "notArticle" };
    if (!editable(l)) return { ok: false, error: "locked" };
    const idx = l.record.topics.findIndex((tp) => tp.itemId === itemId);
    if (idx < 0) return { ok: false, error: "invalid" };
    if (l.record.topics.length <= 1) return { ok: false, error: "lastTopic" };
    const parts = splitArticle(l.post.content);
    // The sections must still line up with the topics (an admin may have
    // restructured the text by hand — then this refuses rather than guess).
    if (parts.sections.length !== l.record.topics.length) return { ok: false, error: "structure" };
    parts.sections.splice(idx, 1);
    const topics = l.record.topics.filter((_, i) => i !== idx);
    const record = withReview(l.record, topics);
    if (!(await saveArticle(supabase, l, joinArticle(parts, topics.map((tp) => tp.short)), record))) return { ok: false, error: "generic" };
    await supabase.from("grovnews_research_items")
      .update({ post_id: null, status: "REJECTED", review_reason: "removed_from_daily" }).eq("id", itemId).eq("post_id", l.post.id);
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.daily_topic_removed", entityType: "grovnews_edition", entityId: editionId, after: { item: itemId },
    });
    revalidateDaily();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** Have one section rewritten from its sources (one model call). */
export async function regenerateDailyTopicAction(editionId: string, itemId: string):
  Promise<{ ok: true } | Fail<"notArticle" | "locked" | "structure" | "noServerKey" | "aiUnavailable" | "aiFailed">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(editionId) || !isUuid(itemId)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return { ok: false, error: "noServerKey" };
    const l = await loadArticle(supabase, editionId);
    if (!l) return { ok: false, error: "notArticle" };
    if (!editable(l)) return { ok: false, error: "locked" };
    const idx = l.record.topics.findIndex((tp) => tp.itemId === itemId);
    if (idx < 0) return { ok: false, error: "invalid" };
    const parts = splitArticle(l.post.content);
    if (parts.sections.length !== l.record.topics.length) return { ok: false, error: "structure" };
    const candidate = await candidateFor(supabase, itemId);
    if (!candidate) return { ok: false, error: "invalid" };
    // The topic keeps every report it was written from — including those of a
    // same-story item the job merged into it, which the item's own duplicates
    // do not list.
    const listed = new Set([candidate.url, ...candidate.related.map((r) => r.url)]);
    candidate.related.push(...l.record.topics[idx].sources.filter((s) => !listed.has(s.url)).map((s) => ({
      id: "", url: s.url, title: s.title, excerpt: "", published_at: null, source: s.source, official: s.official,
      priority: 50, source_id: null,
    })));
    const written = await writeTopic(supabase, l.ed.edition_date, toTopic(candidate), idx + 1);
    if (typeof written === "string") return { ok: false, error: written };
    parts.sections[idx] = written.section;
    const topics = l.record.topics.map((tp, i) => (i === idx ? written.record : tp));
    const record = withReview(l.record, topics);
    if (!(await saveArticle(supabase, l, joinArticle(parts, topics.map((tp) => tp.short)), record))) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.daily_topic_regenerated", entityType: "grovnews_edition", entityId: editionId,
      after: { item: itemId, review: written.record.review },
    });
    revalidateDaily();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** Add a story the job did not pick (analysed, recent, unused), written as
 *  one more section — up to the configured maximum of topics. */
export async function addDailyTopicAction(editionId: string, itemId: string):
  Promise<{ ok: true } | Fail<"notArticle" | "locked" | "structure" | "full" | "used" | "noServerKey" | "aiUnavailable" | "aiFailed">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(editionId) || !isUuid(itemId)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return { ok: false, error: "noServerKey" };
    const l = await loadArticle(supabase, editionId);
    if (!l) return { ok: false, error: "notArticle" };
    if (!editable(l)) return { ok: false, error: "locked" };
    const { data: settings } = await supabase.from("grovnews_settings").select("max_topics").eq("id", true).maybeSingle();
    if (l.record.topics.length >= (settings?.max_topics ?? 5)) return { ok: false, error: "full" };
    if (l.record.topics.some((tp) => tp.itemId === itemId)) return { ok: false, error: "used" };
    const parts = splitArticle(l.post.content);
    if (parts.sections.length !== l.record.topics.length) return { ok: false, error: "structure" };
    const candidate = await candidateFor(supabase, itemId);
    if (!candidate) return { ok: false, error: "invalid" };
    const { data: item } = await supabase.from("grovnews_research_items").select("status, post_id").eq("id", itemId).maybeSingle();
    if (!item || item.post_id || !["ANALYZED", "SELECTED"].includes(item.status)) return { ok: false, error: "used" };
    const written = await writeTopic(supabase, l.ed.edition_date, toTopic(candidate), l.record.topics.length + 1);
    if (typeof written === "string") return { ok: false, error: written };
    // Claim the story first: two admins adding it at once get one section.
    const { data: claimed } = await supabase.from("grovnews_research_items")
      .update({ post_id: l.post.id, status: "USED", selected_at: new Date().toISOString() })
      .eq("id", itemId).is("post_id", null).select("id").maybeSingle();
    if (!claimed) return { ok: false, error: "used" };
    parts.sections.push(written.section);
    const topics = [...l.record.topics, written.record];
    const record = withReview(l.record, topics);
    if (!(await saveArticle(supabase, l, joinArticle(parts, topics.map((tp) => tp.short)), record))) {
      await supabase.from("grovnews_research_items").update({ post_id: null, status: item.status }).eq("id", itemId);
      return { ok: false, error: "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.daily_topic_added", entityType: "grovnews_edition", entityId: editionId, after: { item: itemId },
    });
    revalidateDaily();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/* ── the mail's copy ───────────────────────────────────────────────────────── */

/**
 * Edit the mail's intro and each topic's short summary. Allowed until the mail
 * is queued; if a draft campaign already exists, its body is rebuilt from the
 * edited copy (still one link, to the article).
 */
export async function saveDailyMailAction(editionId: string, input: { intro: string; mails: Record<string, string> }):
  Promise<{ ok: true } | Fail<"notArticle" | "locked" | "campaignLocked" | "newsletter">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(editionId) || !input || typeof input !== "object") return { ok: false, error: "invalid" };
    const l = await loadArticle(supabase, editionId);
    if (!l) return { ok: false, error: "notArticle" };
    if (!["DRAFT", "READY", "PUBLISHED"].includes(l.ed.status)) return { ok: false, error: "locked" };
    if (l.ed.campaign_id) {
      const { data: k } = await supabase.from("newsletter_campaigns").select("status").eq("id", l.ed.campaign_id).maybeSingle();
      if (k && k.status !== "draft") return { ok: false, error: "campaignLocked" };
    }
    const intro = mailText(input.intro, 600);
    if (!intro) return { ok: false, error: "invalid" };
    const topics = l.record.topics.map((tp) => {
      const given = input.mails?.[tp.itemId];
      const mail = typeof given === "string" ? mailText(given, 600) : tp.mail;
      return { ...tp, mail: mail || tp.mail };
    });
    const record: DailyRecord = { ...l.record, mailIntro: intro, topics };
    const { error } = await supabase.from("grovnews_editions").update({ daily: record as never }).eq("id", editionId)
      .in("status", ["DRAFT", "READY", "PUBLISHED"]);
    if (error) return { ok: false, error: "generic" };
    if (l.ed.campaign_id && l.ed.status === "PUBLISHED" && l.post.status === "PUBLISHED") {
      const mail = composeDailyMail(l.ed.edition_date, record);
      const { html } = mailBodyDaily(l.ed.edition_date, l.post.slug, mail);
      const step = await saveStepAction({
        campaignId: l.ed.campaign_id, stepIndex: 0, variant: "A", subject: mail.subject, preheader: mail.preview, editor: "html", bodyHtml: html,
      });
      if (!step.ok) return { ok: false, error: "newsletter" };
      await supabase.from("grovnews_editions").update({ email_body: html, email_subject: mail.subject, email_preview: mail.preview || null })
        .eq("id", editionId);
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.daily_mail_saved", entityType: "grovnews_edition", entityId: editionId, after: { topics: topics.length },
    });
    revalidateDaily();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}
