/**
 * GROVNEWS — the domain rules, in one client-safe place.
 *
 * Statuses, sources, the access window, the grant presets, slugs, read time,
 * input validation and the article's content format. No database and no role
 * in here: lib/services/grovnews.ts does the queries, app/actions/grovnews.ts
 * the admin writes, and supabase/migrations/0119_grovnews.sql the enforcement.
 * Everything below is pure, so the admin screens, the reader and the tests all
 * apply the SAME rule rather than three copies of it.
 */

export const POST_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const ENTITLEMENT_STATUSES = ["ACTIVE", "EXPIRED", "REVOKED"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const ENTITLEMENT_SOURCES = ["ADMIN_GRANT", "LAUNCH_BONUS", "PAID", "PROMO"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** What an admin may grant by hand. PAID is not here: a paid entitlement is
 *  written by a payment, never typed in. */
export const ADMIN_GRANT_SOURCES: readonly EntitlementSource[] = ["ADMIN_GRANT", "PROMO", "LAUNCH_BONUS"];

export const LANGUAGES = ["pl", "en", "de"] as const;
export type PostLanguage = (typeof LANGUAGES)[number];

export const GRANT_PRESETS = ["7", "30", "90", "365", "forever", "custom"] as const;
export type GrantPreset = (typeof GRANT_PRESETS)[number];

export type PostSource = { url: string; title: string | null };

export type EntitlementWindow = {
  status: string;
  starts_at: string;
  expires_at: string | null;
};

/** What an entitlement means right now — status AND the time window. */
export type EffectiveStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";

export function effectiveStatus(e: EntitlementWindow, now: Date = new Date()): EffectiveStatus {
  if (e.status === "REVOKED") return "REVOKED";
  if (e.status !== "ACTIVE") return "EXPIRED";
  if (e.expires_at && new Date(e.expires_at).getTime() <= now.getTime()) return "EXPIRED";
  if (new Date(e.starts_at).getTime() > now.getTime()) return "SCHEDULED";
  return "ACTIVE";
}

/** The same test the database runs in grovnews_has_access(). */
export function isEntitlementActive(e: EntitlementWindow, now: Date = new Date()): boolean {
  return effectiveStatus(e, now) === "ACTIVE";
}

/** Any of a user's entitlements active → access. */
export function hasActiveEntitlement(rows: readonly EntitlementWindow[], now: Date = new Date()): boolean {
  return rows.some((r) => isEntitlementActive(r, now));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The expiry a preset gives, counted from `from`. `forever` is open-ended
 * (null); `custom` has no answer of its own — the caller supplies the date.
 */
export function presetExpiry(preset: GrantPreset, from: Date): Date | null | "custom" {
  if (preset === "forever") return null;
  if (preset === "custom") return "custom";
  return new Date(from.getTime() + Number(preset) * DAY_MS);
}

/**
 * EXTENDING never shortens and never starts from the past: the days are added
 * to whichever is later, now or the current expiry. An open-ended one stays
 * open-ended.
 */
export function extendExpiry(current: string | null, days: number, now: Date = new Date()): Date | null {
  if (current === null) return null;
  const base = Math.max(now.getTime(), new Date(current).getTime());
  return new Date(base + days * DAY_MS);
}

/* ── text ──────────────────────────────────────────────────────────────────── */

const FOLD: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  ä: "a", ö: "o", ü: "u", ß: "ss",
};

/** URL-safe, lowercase, hyphenated — and stable: the same title always gives
 *  the same slug, and the slug is only regenerated when the admin asks. */
export function slugify(text: string, max = 120): string {
  const folded = text.toLowerCase().replace(/[ąćęłńóśźżäöüß]/g, (c) => FOLD[c] ?? c)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** ~200 words a minute, never less than one. */
export function estimateReadMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(240, Math.max(1, Math.ceil(words / 200)));
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sources, one per line: `https://…` or `Title | https://…`. Anything that is
 * not an https URL is dropped rather than stored — a source is a link the
 * reader can follow, and `javascript:` is not one.
 */
export function parseSources(text: string): PostSource[] {
  const out: PostSource[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bar = line.lastIndexOf("|");
    const title = bar > 0 ? line.slice(0, bar).trim() : "";
    const url = (bar > 0 ? line.slice(bar + 1) : line).trim();
    if (!isHttpsUrl(url)) continue;
    out.push({ url, title: title ? title.slice(0, 200) : null });
    if (out.length >= 30) break;
  }
  return out;
}

export function sourcesToText(sources: readonly PostSource[]): string {
  return sources.map((s) => (s.title ? `${s.title} | ${s.url}` : s.url)).join("\n");
}

/** Stored sources are jsonb; read them defensively. */
export function readSources(value: unknown): PostSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const url = (v as { url?: unknown }).url;
    const title = (v as { title?: unknown }).title;
    return typeof url === "string" && isHttpsUrl(url)
      ? [{ url, title: typeof title === "string" && title ? title : null }]
      : [];
  });
}

/** Tags: comma-separated, trimmed, lowercased, unique, at most 20. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(",")) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (tag) seen.add(tag);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

/* ── the post an admin submits ─────────────────────────────────────────────── */

export type PostInput = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  categoryId: string | null;
  tags: string[];
  coverUrl: string | null;
  sources: PostSource[];
  readMinutes: number;
  language: PostLanguage;
  emailSummary: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type PostInputError =
  | "title" | "slug" | "excerpt" | "content" | "cover" | "readMinutes" | "language" | "category";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const str = (v: unknown) => (typeof v === "string" ? v : "");
const optional = (v: unknown, max: number) => {
  const s = str(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * The server's own reading of an editor submission. Nothing the browser sends
 * is trusted as-is: every field is re-typed, bounded and checked against the
 * same limits the table's constraints enforce, so a bad value is a clear error
 * here instead of a constraint violation there.
 */
export function validatePostInput(raw: unknown): { ok: true; value: PostInput } | { ok: false; error: PostInputError } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = str(r.title).trim();
  if (!title || title.length > 200) return { ok: false, error: "title" };
  const slug = (str(r.slug).trim() || slugify(title)).toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 120) return { ok: false, error: "slug" };
  const excerpt = str(r.excerpt).trim();
  if (excerpt.length > 600) return { ok: false, error: "excerpt" };
  const content = str(r.content);
  if (content.length > 200000) return { ok: false, error: "content" };
  const cover = str(r.coverUrl).trim();
  if (cover && !isHttpsUrl(cover)) return { ok: false, error: "cover" };
  const categoryId = r.categoryId ? str(r.categoryId) : null;
  if (categoryId !== null && !isUuid(categoryId)) return { ok: false, error: "category" };
  const language = str(r.language) || "pl";
  if (!(LANGUAGES as readonly string[]).includes(language)) return { ok: false, error: "language" };
  const minutesRaw = Number(r.readMinutes);
  const readMinutes = Number.isFinite(minutesRaw) && minutesRaw > 0
    ? Math.round(minutesRaw) : estimateReadMinutes(content);
  if (readMinutes < 1 || readMinutes > 240) return { ok: false, error: "readMinutes" };
  const tags = Array.isArray(r.tags) ? parseTags(r.tags.map(str).join(",")) : parseTags(str(r.tags));
  const sources = Array.isArray(r.sources) ? readSources(r.sources) : parseSources(str(r.sources));
  return {
    ok: true,
    value: {
      title, slug, excerpt, content, categoryId, tags, coverUrl: cover || null, sources, readMinutes,
      language: language as PostLanguage,
      emailSummary: optional(r.emailSummary, 2000),
      seoTitle: optional(r.seoTitle, 200),
      seoDescription: optional(r.seoDescription, 400),
    },
  };
}

/* ── the article's content ─────────────────────────────────────────────────── */

/**
 * THE FORMAT IS PLAIN TEXT WITH A FEW MARKS, rendered by React — never HTML.
 * A blank line separates paragraphs; `## ` and `### ` start headings; lines
 * starting `- ` form a list; `> ` a quote; `**bold**` and `[text](https://…)`
 * work inline. Because nothing is ever injected as markup, no content an admin
 * pastes (or a future AI writes) can run script in a reader's browser, and no
 * editor library is needed to produce it.
 */
export type Inline = { kind: "text" | "bold"; text: string } | { kind: "link"; text: string; href: string };
export type Block =
  | { kind: "h2" | "h3" | "p" | "quote"; inline: Inline[] }
  | { kind: "list"; items: Inline[][] };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  // Bounded quantifiers: an unmatched "[" or "**" scans at most a few hundred
  // characters, so no text (however hostile) makes rendering quadratic.
  const re = /\*\*([^*\n]{1,500})\*\*|\[([^\]\n]{1,300})\]\((https:\/\/[^\s)]{1,2000})\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "link", text: m[2], href: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseContent(content: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of content.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      blocks.push({ kind: "list", items: lines.map((l) => parseInline(l.replace(/^\s*[-*] /, ""))) });
      continue;
    }
    const first = lines[0];
    if (lines.length === 1 && first.startsWith("### ")) blocks.push({ kind: "h3", inline: parseInline(first.slice(4)) });
    else if (lines.length === 1 && first.startsWith("## ")) blocks.push({ kind: "h2", inline: parseInline(first.slice(3)) });
    else if (lines.every((l) => l.startsWith(">"))) {
      blocks.push({ kind: "quote", inline: parseInline(lines.map((l) => l.replace(/^>\s?/, "")).join(" ")) });
    } else blocks.push({ kind: "p", inline: parseInline(lines.join(" ")) });
  }
  return blocks;
}
