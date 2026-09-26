"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import type { Client } from "@/lib/services/workspace";
import { POST_STATUSES, isUuid, readSources, type PostStatus } from "@/lib/grovnews";
import {
  COPY_LIMIT, blogPath, copyOverlap, placeholderSlug, readFaq, validatePublicArticleInput,
  type FaqItem, type PublicArticleInputError,
} from "@/lib/grovnews-blog";
import { normalizePath } from "@/lib/server/redirects";
import { BLOG_TAG } from "@/lib/server/grovnews-blog";
import * as store from "@/lib/server/grovnews/store";
import { grovnewsEngine } from "@/lib/server/grovnews/ai";
import { writePublicSeoDraft, type PublicSeoDraft } from "@/lib/server/grovnews/public-seo";

/**
 * GROVNEWS BLOG — admin writes for the PUBLIC SEO layer. Every action here
 * re-checks the ADMIN ROLE on the server before anything else; the RLS policy
 * of migration 0124 enforces it a second time underneath. Nothing the browser
 * sends is trusted as-is.
 *
 * NOTHING HERE PUBLISHES ON ITS OWN. Creating from a GrovNews post makes a
 * DRAFT; the AI fills the editor and saves nothing; only the explicit
 * publish action puts an article on /blog — and only when its text is not
 * the premium post re-posted (the copy guard below).
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

const TABLE = "grovnews_public_articles";

function revalidateBlog() {
  revalidateTag(BLOG_TAG);
  revalidatePath("/blog", "layout");
  revalidatePath("/admin/newsletter/grovnews/blog", "layout");
}

/**
 * A public version is a NEW text about the same facts. When the article came
 * from a premium post, too much of that post's text word for word is refused
 * — the one way a paid article could otherwise end up free on /blog. Every
 * text the page shows or announces is checked: the lead, the body, the FAQ
 * and the search/share descriptions.
 */
type PublicText = { excerpt: string; content: string; faq: FaqItem[]; seoDescription: string | null; ogDescription: string | null };
const publicText = (a: PublicText) =>
  [a.excerpt, a.content, ...a.faq.flatMap((f) => [f.q, f.a]), a.seoDescription ?? "", a.ogDescription ?? ""].join("\n\n");

async function tooCloseToPremium(supabase: Client, postId: string | null, text: PublicText): Promise<boolean> {
  if (!postId) return false;
  const { data: post } = await supabase.from("grovnews_posts").select("excerpt, content").eq("id", postId).maybeSingle();
  if (!post) return false;
  return copyOverlap(publicText(text), `${post.excerpt}\n\n${post.content}`) > COPY_LIMIT;
}

/**
 * THE EXISTING REDIRECT TABLE (cms_redirects, read by the middleware) keeps
 * old links alive — nothing new is built for it:
 *   · a redirect FROM this article's own address would hide the article (the
 *     middleware redirects before the page renders), so it is switched off
 *     when the article is live;
 *   · when a once-published article is renamed, its old address points to the
 *     new one, and anything that pointed to the old address follows. 307, the
 *     table's own convention for rows that get re-pointed: a rename can be
 *     undone, and a browser that cached a 301 would loop forever.
 */
async function freeAddress(supabase: Client, slug: string) {
  await supabase.from("cms_redirects").update({ enabled: false }).eq("source", normalizePath(blogPath(slug))).eq("enabled", true);
}

async function breakLoop(supabase: Client, slug: string, previous: string) {
  await supabase.from("cms_redirects").update({ enabled: false })
    .eq("source", normalizePath(blogPath(slug))).eq("target", blogPath(previous)).eq("enabled", true);
}

async function moveAddress(supabase: Client, adminId: string, id: string, from: string, to: string) {
  const source = normalizePath(blogPath(from));
  const target = blogPath(to);
  await supabase.from("cms_redirects").update({ target }).eq("target", source).neq("source", normalizePath(target));
  await supabase.from("cms_redirects").upsert(
    { source, target, status_code: 307, enabled: true, note: `grovnews_public_article:${id}`, created_by: adminId },
    { onConflict: "source" },
  );
}

/* ── save ──────────────────────────────────────────────────────────────────── */

export async function savePublicArticleAction(id: string | null, raw: unknown):
  Promise<{ ok: true; id: string; slug: string } | Fail<PublicArticleInputError | "slug_taken" | "too_close" | "incomplete" | "stale">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (id !== null && !isUuid(id)) return { ok: false, error: "invalid" };
    const parsed = validatePublicArticleInput(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const v = parsed.value;
    let current: { slug: string; status: string; published_at: string | null; source_grovnews_post_id: string | null } | null = null;
    if (id) {
      const { data } = await supabase.from(TABLE).select("slug, status, published_at, source_grovnews_post_id").eq("id", id).maybeSingle();
      if (!data) return { ok: false, error: "invalid" };
      current = data;
      // An article that is live stays a publishable, new text after the edit.
      if (data.status === "PUBLISHED") {
        if (!v.content.trim() || !v.excerpt) return { ok: false, error: "incomplete" };
        if (await tooCloseToPremium(supabase, data.source_grovnews_post_id, v)) return { ok: false, error: "too_close" };
      }
    }
    const row = {
      title: v.title, slug: v.slug, excerpt: v.excerpt, content: v.content, category_id: v.categoryId, tags: v.tags,
      cover_url: v.coverUrl, cover_alt: v.coverAlt, sources: v.sources, faq: v.faq, related_slugs: v.relatedSlugs,
      language: v.language, schema_type: v.schemaType, noindex: v.noindex,
      seo_title: v.seoTitle, seo_description: v.seoDescription, canonical_url: v.canonicalUrl,
      og_title: v.ogTitle, og_description: v.ogDescription, internal_note: v.internalNote,
      estimated_read_minutes: v.readMinutes,
    };
    // Compare-and-set on the status that was checked above: a publish that
    // landed in between (and so skipped this save's guard) makes this 0 rows.
    const res = id && current
      ? await supabase.from(TABLE).update(row).eq("id", id).eq("status", current.status).select("id, slug").maybeSingle()
      : await supabase.from(TABLE).insert({ ...row, status: "DRAFT", created_by: adminId }).select("id, slug").single();
    if (res.error) return { ok: false, error: res.error.code === "23505" ? "slug_taken" : "generic" };
    if (!res.data) return { ok: false, error: current ? "stale" : "invalid" };
    if (current && current.slug !== v.slug) {
      // A live article takes its new address over; one that is not served
      // only breaks a redirect that would loop back to its own old address
      // (publishing frees the address later) — anyone else's is left alone.
      if (current.status === "PUBLISHED") await freeAddress(supabase, v.slug);
      else await breakLoop(supabase, v.slug, current.slug);
      if (current.published_at) await moveAddress(supabase, adminId, res.data.id, current.slug, v.slug);
    } else if (current?.status === "PUBLISHED") {
      await freeAddress(supabase, v.slug);
    }
    await logAudit(supabase, {
      actorId: adminId, action: id ? "grovnews.blog_updated" : "grovnews.blog_created",
      entityType: "grovnews_public_article", entityId: res.data.id,
      after: { slug: v.slug, title: v.title, ...(current && current.slug !== v.slug ? { previous_slug: current.slug } : {}) },
    });
    revalidateBlog();
    return { ok: true, id: res.data.id, slug: res.data.slug };
  } catch (e) {
    return failed(e);
  }
}

/* ── publish / back to draft / archive ─────────────────────────────────────── */

/**
 * Publishing stamps `published_at` the first time only, so re-publishing an
 * archived article does not present it as news. It needs a lead and a body,
 * and passes the copy guard.
 */
export async function setPublicArticleStatusAction(id: string, status: PostStatus):
  Promise<{ ok: true } | Fail<"too_close" | "incomplete" | "stale">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || !(POST_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "invalid" };
    const { data: current } = await supabase.from(TABLE)
      .select("slug, status, published_at, updated_at, excerpt, content, faq, seo_description, og_description, source_grovnews_post_id")
      .eq("id", id).maybeSingle();
    if (!current) return { ok: false, error: "invalid" };
    if (status === "PUBLISHED") {
      if (!current.content.trim() || !current.excerpt.trim()) return { ok: false, error: "incomplete" };
      if (await tooCloseToPremium(supabase, current.source_grovnews_post_id, {
        excerpt: current.excerpt, content: current.content, faq: readFaq(current.faq),
        seoDescription: current.seo_description, ogDescription: current.og_description,
      })) {
        return { ok: false, error: "too_close" };
      }
    }
    const patch: { status: PostStatus; published_at?: string } = { status };
    if (status === "PUBLISHED" && !current.published_at) patch.published_at = new Date().toISOString();
    // Compare-and-set on the version that was checked: a save that changed
    // the text in between bumps updated_at, and this publish matches 0 rows.
    const { data: moved, error } = await supabase.from(TABLE).update(patch)
      .eq("id", id).eq("updated_at", current.updated_at).select("id").maybeSingle();
    if (error) return { ok: false, error: "generic" };
    if (!moved) return { ok: false, error: "stale" };
    if (status === "PUBLISHED") await freeAddress(supabase, current.slug);
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.blog_status", entityType: "grovnews_public_article", entityId: id,
      before: { status: current.status }, after: { status },
    });
    revalidateBlog();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/* ── from a GrovNews post ──────────────────────────────────────────────────── */

/**
 * "Utwórz wersję publiczną SEO": a DRAFT that takes the post's topic (as a
 * working title), category, tags, sources and language — and NOT its text.
 * The lead and the body start empty; the admin writes them, or asks the AI
 * for a new draft from the post. One public version per post: asking again
 * opens the one that exists.
 */
export async function createPublicFromPostAction(postId: string):
  Promise<{ ok: true; id: string; existed: boolean } | Fail<"not_published">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(postId)) return { ok: false, error: "invalid" };
    const { data: post } = await supabase.from("grovnews_posts")
      .select("id, title, status, category_id, tags, sources, language").eq("id", postId).maybeSingle();
    if (!post) return { ok: false, error: "invalid" };
    if (post.status !== "PUBLISHED") return { ok: false, error: "not_published" };
    const existing = async () =>
      (await supabase.from(TABLE).select("id").eq("source_grovnews_post_id", postId).maybeSingle()).data?.id ?? null;
    const found = await existing();
    if (found) return { ok: true, id: found, existed: true };
    // The address is a neutral placeholder, never the premium headline: it
    // follows the public title in the editor until the article is published.
    for (let n = 1; n <= 5; n++) {
      const { data, error } = await supabase.from(TABLE).insert({
        title: post.title, slug: placeholderSlug(postId, n), excerpt: "", content: "",
        category_id: post.category_id, tags: post.tags ?? [], sources: readSources(post.sources), language: post.language,
        source_grovnews_post_id: postId, status: "DRAFT", created_by: adminId,
      }).select("id").single();
      if (data) {
        await logAudit(supabase, {
          actorId: adminId, action: "grovnews.blog_created_from_post", entityType: "grovnews_public_article",
          entityId: data.id, after: { source_post: postId },
        });
        revalidateBlog();
        return { ok: true, id: data.id, existed: false };
      }
      if (error?.code !== "23505") return { ok: false, error: "generic" };
      // A parallel click made the version first — open that one.
      const raced = await existing();
      if (raced) return { ok: true, id: raced, existed: true };
    }
    return { ok: false, error: "generic" };
  } catch (e) {
    return failed(e);
  }
}

/* ── the AI draft ──────────────────────────────────────────────────────────── */

/**
 * A NEW public text, written by the configured AI from the approved post, its
 * sources and the research facts behind it — handed back to the editor, never
 * saved here. No provider configured is an honest "unavailable".
 */
export async function generatePublicSeoDraftAction(id: string):
  Promise<{ ok: true; draft: PublicSeoDraft } | Fail<"no_source" | "not_published" | "noServerKey" | "aiUnavailable" | "aiFailed">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return { ok: false, error: "noServerKey" };
    const { data: article } = await supabase.from(TABLE).select("id, language, source_grovnews_post_id").eq("id", id).maybeSingle();
    if (!article) return { ok: false, error: "invalid" };
    if (!article.source_grovnews_post_id) return { ok: false, error: "no_source" };
    const { data: post } = await supabase.from("grovnews_posts")
      .select("id, title, excerpt, content, status, tags, sources, category:grovnews_categories(name)")
      .eq("id", article.source_grovnews_post_id).maybeSingle();
    if (!post) return { ok: false, error: "no_source" };
    if (post.status !== "PUBLISHED") return { ok: false, error: "not_published" };
    const [{ data: facts }, { data: candidates }] = await Promise.all([
      supabase.from("grovnews_research_items").select("ai_title, source_title, ai_summary").eq("post_id", post.id).limit(8),
      supabase.from(TABLE).select("slug, title").eq("status", "PUBLISHED").neq("id", id)
        .order("published_at", { ascending: false }).limit(40),
    ]);
    const engine = await grovnewsEngine(supabase);
    if (!engine) return { ok: false, error: "aiUnavailable" };
    const category = (post as unknown as { category: { name: string } | null }).category;
    let draft: PublicSeoDraft;
    try {
      draft = await writePublicSeoDraft(engine, {
        language: article.language,
        post: { title: post.title, excerpt: post.excerpt, content: post.content, category: category?.name ?? null, tags: post.tags ?? [] },
        sources: readSources(post.sources),
        facts: (facts ?? []).map((f) => ({ title: f.ai_title ?? f.source_title ?? "", summary: f.ai_summary ?? "" }))
          .filter((f) => f.summary),
        candidates: candidates ?? [],
      });
    } catch (e) {
      if (e instanceof store.StoreError) throw e;
      return { ok: false, error: "aiFailed" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.blog_ai_draft", entityType: "grovnews_public_article", entityId: id,
      after: { source_post: post.id, warnings: draft.warnings.headline.length + draft.warnings.numbers.length },
    });
    return { ok: true, draft };
  } catch (e) {
    return failed(e);
  }
}
