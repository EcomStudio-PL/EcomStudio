import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site";
import {
  LANGUAGES, SLUG_RE, estimateReadMinutes, isHttpsUrl, isUuid, parseSources, parseTags, readSources, slugify,
  type PostLanguage, type PostSource,
} from "@/lib/grovnews";

/**
 * GROVNEWS BLOG — the rules of the PUBLIC SEO layer, in one client-safe place.
 *
 * A public article is its own document (supabase/migrations/0124): a premium
 * post may be where it came from, but nothing here ever reads a premium post
 * for a visitor. What the public pages get is what the three public database
 * functions hand an anonymous client, re-typed below; what an admin submits is
 * re-validated below against the same limits the table's constraints enforce.
 *
 * Also here, because the admin editor, the pages and the tests must agree on
 * them: the article's canonical address, its metadata and JSON-LD, the
 * related-articles pick, the headline check ("clickable ≠ misleading"), the
 * copy guard (a public text must not be the premium text re-posted) and the
 * numbers an AI draft used that its material never stated.
 */

export const SCHEMA_TYPES = ["Article", "NewsArticle"] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

export type FaqItem = { q: string; a: string };
export type BlogCategory = { slug: string; name: string };

/** One card of the /blog list — exactly what grovnews_public_feed returns. */
export type BlogCard = {
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string | null;
  coverAlt: string | null;
  publishedAt: string;
  readMinutes: number;
  language: PostLanguage;
  category: BlogCategory | null;
};

/** One article — exactly what grovnews_public_article returns. */
export type BlogArticle = BlogCard & {
  content: string;
  tags: string[];
  sources: PostSource[];
  faq: FaqItem[];
  relatedSlugs: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  noindex: boolean;
  schemaType: SchemaType;
  updatedAt: string;
};

export const blogPath = (slug: string) => `/blog/${slug}`;
export const blogCategoryPath = (slug: string) => `/blog/kategoria/${slug}`;

/** The share image when an article has no cover: the brand, never nothing. */
export const FALLBACK_OG_IMAGE = "/brand/app-icon.png";
const OG_LOCALE: Record<PostLanguage, string> = { pl: "pl_PL", en: "en_US", de: "de_DE" };

/* ── reading what the database returns ─────────────────────────────────────── */

type Row = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const language = (v: unknown): PostLanguage =>
  (LANGUAGES as readonly string[]).includes(text(v)) ? (v as PostLanguage) : "pl";

function category(v: unknown): BlogCategory | null {
  if (!v || typeof v !== "object") return null;
  const slug = text((v as Row).slug);
  const name = text((v as Row).name);
  return slug && name ? { slug, name } : null;
}

/** Stored FAQ, read defensively: an entry without both halves is dropped. */
export function readFaq(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const q = text((v as Row).q).trim();
    const a = text((v as Row).a).trim();
    return q && a ? [{ q: q.slice(0, 300), a: a.slice(0, 2000) }] : [];
  }).slice(0, 10);
}

export function toBlogCard(raw: unknown): BlogCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Row;
  const slug = text(r.slug);
  const publishedAt = text(r.published_at);
  if (!SLUG_RE.test(slug) || !text(r.title) || !publishedAt) return null;
  const cover = textOrNull(r.cover_url);
  return {
    slug, title: text(r.title), excerpt: text(r.excerpt),
    // https only on the way out as well as on the way in.
    coverUrl: cover && isHttpsUrl(cover) ? cover : null,
    coverAlt: textOrNull(r.cover_alt),
    publishedAt,
    readMinutes: Math.min(240, Math.max(1, Math.round(Number(r.read_minutes)) || 1)),
    language: language(r.language),
    category: category(r.category),
  };
}

export function toBlogArticle(raw: unknown): BlogArticle | null {
  const card = toBlogCard(raw);
  if (!card) return null;
  const r = raw as Row;
  const canonical = textOrNull(r.canonical_url);
  return {
    ...card,
    content: text(r.content),
    tags: strings(r.tags),
    sources: readSources(r.sources),
    faq: readFaq(r.faq),
    relatedSlugs: strings(r.related_slugs).filter((s) => SLUG_RE.test(s)),
    seoTitle: textOrNull(r.seo_title),
    seoDescription: textOrNull(r.seo_description),
    canonicalUrl: canonical && isHttpsUrl(canonical) ? canonical : null,
    ogTitle: textOrNull(r.og_title),
    ogDescription: textOrNull(r.og_description),
    noindex: r.noindex === true,
    schemaType: (SCHEMA_TYPES as readonly string[]).includes(text(r.schema_type)) ? (r.schema_type as SchemaType) : "Article",
    updatedAt: text(r.updated_at) || card.publishedAt,
  };
}

/* ── what an admin submits ─────────────────────────────────────────────────── */

export type PublicArticleInput = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  categoryId: string | null;
  tags: string[];
  coverUrl: string | null;
  coverAlt: string | null;
  sources: PostSource[];
  faq: FaqItem[];
  relatedSlugs: string[];
  language: PostLanguage;
  schemaType: SchemaType;
  noindex: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  internalNote: string | null;
  readMinutes: number;
};

export type PublicArticleInputError =
  | "title" | "slug" | "excerpt" | "content" | "cover" | "canonical" | "language" | "category" | "faq";

/** /blog/kategoria/<slug> is the category page: an article cannot own it. */
export const RESERVED_BLOG_SLUGS: ReadonlySet<string> = new Set(["kategoria"]);

const optional = (v: unknown, max: number) => {
  const s = text(v).trim();
  return s ? s.slice(0, max) : null;
};

/** FAQ as the editor sends it: an array of {q, a}. A half-filled row is an
 *  error (the admin meant something), an empty one is ignored. */
function parseFaqInput(value: unknown): FaqItem[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: FaqItem[] = [];
  for (const v of value) {
    const q = text((v as Row | null)?.q).trim();
    const a = text((v as Row | null)?.a).trim();
    if (!q && !a) continue;
    if (!q || !a || q.length > 300 || a.length > 2000) return null;
    out.push({ q, a });
  }
  return out.length > 10 ? null : out;
}

/** Related articles by slug: comma-separated or an array, valid slugs only,
 *  never the article itself, at most six. */
export function parseRelatedSlugs(value: unknown, self: string): string[] {
  const list = Array.isArray(value) ? value.map(text) : text(value).split(",");
  const seen = new Set<string>();
  for (const raw of list) {
    const s = raw.trim().toLowerCase();
    if (s && s !== self && SLUG_RE.test(s) && s.length <= 120) seen.add(s);
    if (seen.size >= 6) break;
  }
  return [...seen];
}

/**
 * The server's own reading of an editor submission — every field re-typed and
 * bounded, so a bad value is a clear error here instead of a constraint
 * violation in the database.
 */
export function validatePublicArticleInput(raw: unknown):
  { ok: true; value: PublicArticleInput } | { ok: false; error: PublicArticleInputError } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const title = text(r.title).trim();
  if (!title || title.length > 200) return { ok: false, error: "title" };
  const slug = (text(r.slug).trim() || slugify(title)).toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 120 || RESERVED_BLOG_SLUGS.has(slug)) return { ok: false, error: "slug" };
  const excerpt = text(r.excerpt).trim();
  if (excerpt.length > 600) return { ok: false, error: "excerpt" };
  const content = text(r.content);
  if (content.length > 200000) return { ok: false, error: "content" };
  const cover = text(r.coverUrl).trim();
  if (cover && !isHttpsUrl(cover)) return { ok: false, error: "cover" };
  const canonical = text(r.canonicalUrl).trim();
  if (canonical && (!isHttpsUrl(canonical) || canonical.length > 2000)) return { ok: false, error: "canonical" };
  const categoryId = r.categoryId ? text(r.categoryId) : null;
  if (categoryId !== null && !isUuid(categoryId)) return { ok: false, error: "category" };
  const lang = text(r.language) || "pl";
  if (!(LANGUAGES as readonly string[]).includes(lang)) return { ok: false, error: "language" };
  const faq = parseFaqInput(r.faq);
  if (faq === null) return { ok: false, error: "faq" };
  const schema = text(r.schemaType);
  const tags = Array.isArray(r.tags) ? parseTags(r.tags.map(text).join(",")) : parseTags(text(r.tags));
  const sources = Array.isArray(r.sources) ? readSources(r.sources) : parseSources(text(r.sources));
  return {
    ok: true,
    value: {
      title, slug, excerpt, content, categoryId, tags, sources, faq,
      coverUrl: cover || null,
      coverAlt: cover ? optional(r.coverAlt, 300) : null,
      relatedSlugs: parseRelatedSlugs(r.relatedSlugs, slug),
      language: lang as PostLanguage,
      schemaType: (SCHEMA_TYPES as readonly string[]).includes(schema) ? (schema as SchemaType) : "Article",
      noindex: r.noindex === true,
      seoTitle: optional(r.seoTitle, 200),
      seoDescription: optional(r.seoDescription, 400),
      canonicalUrl: canonical || null,
      ogTitle: optional(r.ogTitle, 200),
      ogDescription: optional(r.ogDescription, 400),
      internalNote: optional(r.internalNote, 2000),
      readMinutes: estimateReadMinutes(content),
    },
  };
}

/* ── the article's address, metadata and structured data ───────────────────── */

/** ONE canonical per article: the admin's https override, else its own path. */
export function articleCanonical(a: Pick<BlogArticle, "slug" | "canonicalUrl">): string {
  return a.canonicalUrl && isHttpsUrl(a.canonicalUrl) ? a.canonicalUrl : blogPath(a.slug);
}

const firstText = (...values: (string | null | undefined)[]) =>
  values.map((v) => v?.trim()).find((v): v is string => Boolean(v));

/** The page's metadata. Relative paths resolve against the root layout's
 *  metadataBase (lib/site.ts), so no domain is written down here. */
export function articleMetadata(a: BlogArticle): Metadata {
  const title = firstText(a.seoTitle, a.title) ?? a.title;
  const description = firstText(a.seoDescription, a.excerpt);
  const canonical = articleCanonical(a);
  const ogTitle = firstText(a.ogTitle) ?? title;
  const ogDescription = firstText(a.ogDescription) ?? description;
  const image = a.coverUrl ?? FALLBACK_OG_IMAGE;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical },
    // noindex is honoured here and by the sitemap, from the same column.
    robots: { index: !a.noindex, follow: true },
    openGraph: {
      type: "article",
      siteName: "GrovBase",
      url: canonical,
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      images: [{ url: image, ...(a.coverUrl && a.coverAlt ? { alt: a.coverAlt } : {}) }],
      locale: OG_LOCALE[a.language],
      publishedTime: a.publishedAt,
      modifiedTime: a.updatedAt,
      ...(a.category ? { section: a.category.name } : {}),
      ...(a.tags.length ? { tags: a.tags } : {}),
    },
    twitter: {
      card: a.coverUrl ? "summary_large_image" : "summary",
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      images: [image],
    },
  };
}

const absolute = (pathOrUrl: string) => (isHttpsUrl(pathOrUrl) ? pathOrUrl : absoluteUrl(pathOrUrl));

/**
 * The structured data a crawler reads: the article itself, the breadcrumb the
 * page shows, and — ONLY when the page shows one — its FAQ. Nothing describes
 * content a visitor cannot see, and there is no review or rating of anything.
 */
export function articleJsonLd(a: BlogArticle, labels: { home: string; blog: string }): Record<string, unknown>[] {
  const pageUrl = absoluteUrl(blogPath(a.slug));
  const description = firstText(a.seoDescription, a.excerpt);
  const image = absolute(a.coverUrl ?? FALLBACK_OG_IMAGE);
  const crumbs = [
    { name: labels.home, url: absoluteUrl("/") },
    { name: labels.blog, url: absoluteUrl("/blog") },
    ...(a.category ? [{ name: a.category.name, url: absoluteUrl(blogCategoryPath(a.category.slug)) }] : []),
    { name: a.title, url: pageUrl },
  ];
  const out: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": a.schemaType,
      headline: a.title.length > 110 ? `${a.title.slice(0, 109).trimEnd()}…` : a.title,
      ...(description ? { description } : {}),
      image: [image],
      datePublished: a.publishedAt,
      dateModified: a.updatedAt,
      inLanguage: a.language,
      author: { "@type": "Organization", name: "GrovNews", url: absoluteUrl("/blog") },
      publisher: {
        "@type": "Organization", name: "GrovBase", url: absoluteUrl("/"),
        logo: { "@type": "ImageObject", url: absoluteUrl(FALLBACK_OG_IMAGE) },
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
      ...(a.category ? { articleSection: a.category.name } : {}),
      ...(a.tags.length ? { keywords: a.tags.join(", ") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
    },
  ];
  if (a.faq.length > 0) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    });
  }
  return out;
}

// Built from code points: the raw characters are line breaks to some tools
// and would not survive the trip into a repository intact.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

/**
 * JSON for a <script type="application/ld+json">. Every character that could
 * end the script element or start markup is escaped, so no stored text — an
 * admin's, an AI's — can break out of it.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

/** Up to `max` other published articles: the admin's picks first (only those
 *  that are published — the list comes from the public feed), then the same
 *  category, then the newest. */
export function relatedArticles(
  current: Pick<BlogArticle, "slug" | "relatedSlugs" | "category">, feed: readonly BlogCard[], max = 3,
): BlogCard[] {
  const others = feed.filter((c) => c.slug !== current.slug);
  const picked: BlogCard[] = [];
  const add = (c: BlogCard | undefined) => { if (c && !picked.includes(c) && picked.length < max) picked.push(c); };
  for (const slug of current.relatedSlugs) add(others.find((c) => c.slug === slug));
  if (current.category) for (const c of others) if (c.category?.slug === current.category.slug) add(c);
  for (const c of others) add(c);
  return picked;
}

/* ── editorial checks ──────────────────────────────────────────────────────── */

export type HeadlineWarning = "clickbait" | "caps" | "exclaim" | "long";

// Words that promise more than a source ever does. A warning, not a ban: the
// admin decides — but the admin is told.
const CLICKBAIT = /(?<![\p{L}\p{N}])(szok|shock|schock|nie uwierzysz|you won'?t believe|koniec (allegro|olx|amazon|e-?commerce|sprzedaży)|wszyscy sprzedawcy|every seller will|alle händler)/iu;

/** "Clickable ≠ misleading": what in a headline reads as bait. */
export function headlineWarnings(title: string): HeadlineWarning[] {
  const out: HeadlineWarning[] = [];
  if (CLICKBAIT.test(title)) out.push("clickbait");
  if ((title.match(/(?<![\p{L}])\p{Lu}{5,}(?![\p{L}])/gu) ?? []).length > 0) out.push("caps");
  if (title.includes("!")) out.push("exclaim");
  if (title.length > 100) out.push("long");
  return out;
}

export type SeoCheck = { key: string; ok: boolean };

/** The six present-or-absent checks the CMS SEO panel shows, answered for a
 *  public article (keys shared with components/admin/cms/seo-preview.tsx). */
export function articleSeoChecks(a: {
  seoTitle: string; seoDescription: string; content: string; coverUrl: string; coverAlt: string; canonicalUrl: string;
}): SeoCheck[] {
  return [
    { key: "title", ok: Boolean(a.seoTitle.trim()) },
    { key: "description", ok: Boolean(a.seoDescription.trim()) },
    { key: "heading", ok: /^##\s+\S/m.test(a.content) },
    { key: "ogImage", ok: Boolean(a.coverUrl.trim()) },
    // Always emitted (the article's own path unless overridden); only a
    // malformed override is a problem.
    { key: "canonical", ok: !a.canonicalUrl.trim() || isHttpsUrl(a.canonicalUrl.trim()) },
    { key: "alt", ok: !a.coverUrl.trim() || Boolean(a.coverAlt.trim()) },
  ];
}

const normalise = (s: string) =>
  s.toLowerCase().replace(/[*#>`_[\]()]/g, " ").replace(/\s+/g, " ").trim();

/**
 * How much of a premium text reappears WORD FOR WORD in a public one: the
 * share of the premium's sentences (eight words or more) found verbatim.
 * A public version is a new text about the same facts — not the paid article
 * re-posted — so publishing is refused above COPY_LIMIT.
 */
export function copyOverlap(publicText: string, premiumText: string): number {
  const pub = normalise(publicText);
  const sentences = premiumText.split(/(?<=[.!?])\s+|\n+/).map(normalise)
    .filter((s) => s.split(" ").length >= 8);
  if (sentences.length === 0) return 0;
  return sentences.filter((s) => pub.includes(s)).length / sentences.length;
}

export const COPY_LIMIT = 0.3;

/**
 * Numbers (amounts, dates, percentages) an AI draft states that its material
 * never did. Shown to the admin before anything is saved: a number nobody can
 * trace is the most likely invented fact.
 */
export function unsupportedNumbers(draft: string, material: string): string[] {
  const numbers = (s: string) =>
    new Set((s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
  const known = numbers(material);
  return [...numbers(draft)].filter((n) => !known.has(n));
}
