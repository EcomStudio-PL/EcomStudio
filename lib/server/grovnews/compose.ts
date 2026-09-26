import "server-only";
import pl from "@/lib/i18n/dictionaries/pl.json";
import { makeT } from "@/lib/i18n/t";
import { SITE_URL } from "@/lib/site";
import { estimateReadMinutes, slugify, type PostSource } from "@/lib/grovnews";
import { cleanText, editionDateLabel } from "@/lib/grovnews-research";
import { collectUrls } from "@/lib/server/newsletter/render";
import type { Draft } from "./ai";
import type { DraftWork, PostPayload } from "./store";

/**
 * WHAT GROVNEWS WRITES, ASSEMBLED — a post in the Stage 1 text format, and the
 * day's mail as e-mail-safe HTML.
 *
 * GrovNews content is written in Polish (the market it covers), so the fixed
 * words — section headings, the mail's buttons — come from the Polish
 * dictionary rather than from whichever language the admin's browser uses.
 */
const t = makeT(pl as Record<string, unknown>);

/* ── a post ────────────────────────────────────────────────────────────────── */

/** Sources: the item's own link first, then where else the same story was
 *  found, official reports ahead of the rest. Always from the research rows,
 *  never from model output. */
export function postSources(item: Pick<DraftWork, "url" | "title" | "source_name" | "official" | "related">): PostSource[] {
  const label = (source: string, title: string) => cleanText(source ? `${source}: ${title}` : title, 200).replace(/\n/g, " ");
  const out: PostSource[] = [];
  const seen = new Set<string>();
  const push = (url: string, title: string) => {
    if (!/^https:\/\//i.test(url) || seen.has(url) || out.length >= 8) return;
    seen.add(url);
    out.push({ url, title: title || null });
  };
  push(item.url, label(item.source_name, item.title));
  for (const r of [...item.related].sort((a, b) => Number(b.official) - Number(a.official))) {
    push(r.url, label(r.source, r.title));
  }
  return out;
}

/** The Stage 1 content format: `## ` headings, blank-line paragraphs, `- `
 *  lists. The model supplies the words; the structure is fixed here. */
export function draftContent(d: Draft): string {
  const section = (key: string, body: string) => body.trim() ? `## ${t(`grovnewsAdm.content.${key}`)}\n\n${body.trim()}` : "";
  const steps = d.whatToDo.length > 1 ? d.whatToDo.map((s) => `- ${s}`).join("\n") : (d.whatToDo[0] ?? "");
  return [
    section("whatHappened", d.whatHappened),
    section("whoIsAffected", d.whoIsAffected),
    section("sinceWhen", d.sinceWhen),
    section("whyItMatters", d.whyItMatters),
    section("whatToDo", steps),
  ].filter(Boolean).join("\n\n");
}

export function composePost(d: Draft, item: DraftWork): PostPayload {
  const content = draftContent(d);
  const slug = slugify(d.title, 100) || slugify(item.title, 100) || "grovnews";
  return {
    title: d.title.slice(0, 200),
    slug,
    excerpt: d.lead.slice(0, 600),
    content,
    tags: [...new Set(d.tags)].slice(0, 6),
    sources: postSources(item),
    read_minutes: estimateReadMinutes(content),
    language: "pl",
  };
}

/* ── the mail ──────────────────────────────────────────────────────────────── */

export type DigestEntry = { slug: string; title: string; blurb: string };
export type DigestDocument = { editionDate: string; title: string; intro: string; entries: DigestEntry[] };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const paragraphs = (text: string, style: string) =>
  text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="${style}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");

const base = () => SITE_URL.replace(/\/+$/, "");
export const postUrl = (slug: string) => `${base()}/grovnews/${slug}`;
export const editionUrl = () => `${base()}/grovnews`;

/**
 * The mail body. Inline styles only, from the properties the newsletter's
 * sanitiser keeps; no images, no scripts, nothing remote. Every link goes to
 * a GrovNews post of THIS edition or to /grovnews — the database refuses to
 * queue a body that links to any other post (0121 §6.10). The newsletter's
 * renderer adds the tracking, the unsubscribe footer and the text part.
 */
export function renderDigestHtml(doc: DigestDocument): string {
  const text = "margin:0 0 12px;font-size:15px;line-height:1.6;color:#1f2937";
  const items = doc.entries.map((e, i) => `
<div style="padding:18px 0;border-top:1px solid #e5e7eb">
<p style="margin:0 0 8px;font-size:18px;font-weight:bold;line-height:1.35;color:#111827">${i + 1}. ${esc(e.title)}</p>
${paragraphs(e.blurb, text)}
<p style="margin:4px 0 0"><a href="${esc(postUrl(e.slug))}" style="color:#7c3aed;font-weight:bold;text-decoration:none">${esc(t("grovnewsAdm.mail.readFull"))} →</a></p>
</div>`).join("\n");
  return `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b7280">GrovNews · ${esc(editionDateLabel(doc.editionDate))}</p>
<p style="margin:0 0 14px;font-size:24px;font-weight:bold;line-height:1.3;color:#111827">${esc(doc.title)}</p>
${paragraphs(doc.intro, text)}
${items}
<div style="padding:22px 0 8px;border-top:1px solid #e5e7eb">
<p style="margin:0"><a href="${esc(editionUrl())}" style="display:inline-block;padding:12px 20px;border-radius:10px;background-color:#7c3aed;color:#ffffff;font-weight:bold;text-decoration:none">${esc(t("grovnewsAdm.mail.openEdition"))}</a></p>
</div>
</div>`;
}

/** One blurb as stored on the edition: the model's paragraphs, then the
 *  "why it matters" line under its own label. */
export function blurbText(blurb: string, why: string): string {
  const body = blurb.trim();
  return why.trim() ? `${body}\n\n${t("grovnewsAdm.mail.whyLabel")}: ${why.trim()}` : body;
}

/** No model, or the model failed: the post's own mail summary or lead. */
export function fallbackBlurb(post: { emailSummary: string | null; excerpt: string }): string {
  return cleanText(post.emailSummary?.trim() || post.excerpt, 900);
}

export function fallbackIntro(count: number): string {
  return t("grovnewsAdm.mail.defaultIntro", { count });
}

export function digestUtm(editionDate: string) {
  return { source: "grovnews", medium: "email", campaign: `grovnews-${editionDate}` };
}

/** The links the newsletter must register for click tracking — computed by
 *  the newsletter's own collector, so they match what its renderer looks up. */
export function digestLinks(html: string, editionDate: string): string[] {
  return collectUrls({ editor: "html", blocks: [], bodyHtml: html }, digestUtm(editionDate));
}

/** The slugs a mail body links to — checked against the edition before any
 *  send (the database checks the same thing again). */
export function linkedSlugs(html: string): string[] {
  return [...new Set([...html.matchAll(/\/grovnews\/([a-z0-9-]+)/g)].map((m) => m[1]))];
}
