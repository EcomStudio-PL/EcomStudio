/**
 * GROVNEWS STAGE 2 — the research, edition and automation rules, in one
 * client-safe place (Stage 1's rules stay in lib/grovnews.ts).
 *
 * Pure functions only: no database, no network, no role. The admin screens,
 * the daily job (lib/server/grovnews/*) and the tests apply the SAME rule, and
 * the rules that decide anything irreversible — publishing, sending — are
 * enforced a second time by the database (migration 0121), so this file is
 * the explanation, not the only lock.
 */
import { slugify } from "@/lib/grovnews";

/* ── vocabularies ──────────────────────────────────────────────────────────── */

export const SOURCE_TYPES = ["RSS", "ATOM", "PUBLIC_FEED", "API", "MANUAL", "WEB_PAGE"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** What the daily job actually downloads. API needs an adapter (none is
 *  registered until a provider with a real key exists); MANUAL is never
 *  fetched — its items are typed in by an admin. */
export const FETCHED_TYPES: readonly SourceType[] = ["RSS", "ATOM", "PUBLIC_FEED", "WEB_PAGE"];

export const ITEM_STATUSES = ["NEW", "ANALYZED", "SELECTED", "REJECTED", "USED", "DUPLICATE"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const EDITION_STATUSES = ["DRAFT", "READY", "PUBLISHED", "QUEUED", "SENT", "FAILED", "ARCHIVED"] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

export const MODES = ["REVIEW", "AUTOMATIC"] as const;
export type GrovNewsMode = (typeof MODES)[number];

export const RUN_STAGES = ["INGEST", "ANALYZE", "DRAFT", "EDITION", "SEND", "DONE"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/** Law and tax: a higher bar before anything is published (see 0121 §6.7). */
export const SENSITIVE_CATEGORY_SLUGS: readonly string[] = ["prawo", "podatki"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/* ── text ──────────────────────────────────────────────────────────────────── */

const NEWLINE = String.fromCharCode(10);

/**
 * One value made safe to store or to put in a prompt: no control characters
 * (newlines survive — paragraphs mean something), no runs of spaces, capped.
 * A code-point loop rather than a character class, for the reason given on
 * the newsletter's own `clean`: a regex of raw escapes is the line that gets
 * mangled on its way into a repository.
 */
export function cleanText(value: unknown, max: number): string {
  let out = "";
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    out += ch === NEWLINE ? NEWLINE : code < 32 || code === 127 ? " " : ch;
  }
  return out
    .replace(/ {2,}/g, " ")
    .replace(new RegExp(`${NEWLINE}{3,}`, "g"), NEWLINE + NEWLINE)
    .trim()
    .slice(0, max);
}

const ZWSP = String.fromCharCode(0x200b);

/**
 * Model output never carries a link: sources come from the research items,
 * not from what a model remembers. Markdown links keep their text; URLs,
 * www-addresses and domains WITH a path are removed; a bare domain or an
 * e-mail address that remains ("Allegro.pl" in a sentence is ordinary copy)
 * is defused with a zero-width space after its dot / at-sign, so no mail
 * client turns it into a link — the text reads the same, nothing is clickable.
 */
export function stripLinks(text: string): string {
  // Every dot of a label chain is defused, not only the last one — otherwise
  // "biznes.gov.pl" keeps a linkable "biznes.gov".
  const defuse = (labels: string) => labels.replace(/\./g, `.${ZWSP}`);
  return text
    // Look-alike dots (fullwidth, ideographic) are dots.
    .replace(/[\uFF0E\u3002\uFF61]/g, ".")
    .replace(/\[([^\]\n]{1,300})\]\([^)\s]{1,2000}\)/g, "$1")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, "")
    // Labels may be digits, non-ASCII letters or carry combining marks
    // (1688.com, łódź.pl).
    .replace(/(?<![\p{L}\p{M}\p{N}-])(?:[\p{L}\p{M}\p{N}-]{1,63}\.)+[a-z]{2,24}\/[^\s<>()]*/giu, "")
    .replace(/(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\/[^\s<>()]*/gu, "")
    .replace(/([\p{L}\p{M}\p{N}._%+-]{1,64})@((?:[\p{L}\p{M}\p{N}-]{1,63}\.)+)([a-z]{2,24})(?![a-z])/giu,
      (_m: string, user: string, labels: string, tld: string) => `${user}@${ZWSP}${defuse(labels)}${tld}`)
    // A letters-only TLD never matches a decimal (3.5), so every label.tld is
    // defused — digits-only labels too.
    .replace(/(?<![\p{L}\p{M}\p{N}-])((?:[\p{L}\p{M}\p{N}-]{1,63}\.)+)([a-z]{2,24})(?![a-z])/giu,
      (_m: string, labels: string, tld: string) => `${defuse(labels)}${tld}`)
    .replace(/ {2,}/g, " ");
}

/* ── URLs ──────────────────────────────────────────────────────────────────── */

const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src|cmpid|at_medium|at_campaign|spm)$/i;

/**
 * The dedupe key for a link. Same article, same key — whether it arrived
 * over http or https, with or without www, with a fragment, a trailing slash
 * or somebody's campaign tags. Returns null for anything that is not an
 * http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return `https://${host}${path === "/" ? "" : path}${query}`.slice(0, 2000);
}

/** GrovBase's own platform: the app itself, its database project and its
 *  deployments. Public names, but never a news source — pointing the fetcher
 *  at them would only make it call our own backend. */
const PLATFORM_SUFFIXES = ["grovbase.com", "supabase.co", "supabase.in", "supabase.net", "vercel.app", "vercel.sh"];

/** Hosts an admin may never point a source at, whatever DNS says. The fetcher
 *  re-checks every resolved address; this catches the obvious at save time. */
export function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")
      || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (/^[\d.]+$/.test(h) || h.includes(":")) return true; // IP literals: a source is a name, not an address
  if (PLATFORM_SUFFIXES.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return !h.includes(".");
}

/** A source URL an admin may save: https, a public-looking host name, the
 *  standard port, no credentials. */
export function isAcceptableSourceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  if (String(raw).length > 2000) return false;
  // The URL parser silently drops tabs and newlines; an address that needs
  // that is not one to store (or to sign).
  if (/[\u0000-\u001f\u007f]/.test(String(raw).trim())) return false;
  return !isForbiddenHost(url.hostname);
}

/* ── titles and duplicates ─────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  // pl
  "oraz", "jest", "jak", "czy", "dla", "nie", "sie", "przez", "przy", "tak", "juz", "ale", "lub",
  "jego", "jej", "ich", "ten", "tym", "tego", "ktore", "ktory", "ktora", "bedzie", "sa", "od", "do",
  "na", "we", "po", "za", "co", "to", "ze", "nowe", "nowy", "nowa",
  // en
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "will", "has", "have", "new",
  "into", "about", "your", "you", "how", "what", "why",
  // de
  "und", "der", "die", "das", "mit", "fur", "von", "ist", "ein", "eine", "auf", "den", "dem", "neue",
]);

/** A title reduced to comparable words: folded, lowercased, stopwords out. */
export function normalizeTitle(title: string): string {
  return slugify(String(title ?? ""), 500)
    .split("-")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .join(" ");
}

/** Jaccard similarity of two normalised titles, 0..1. Titles too short to
 *  compare only match when identical. */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = new Set(a.split(" "));
  const sb = new Set(b.split(" "));
  if (sa.size < 3 || sb.size < 3) return 0;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  return common / (sa.size + sb.size - common);
}

/** Above this, two titles are the same story (tested in grovnews2-tests). */
export const DUPLICATE_SIMILARITY = 0.6;

/** The closest earlier story, if it is close enough to be the same one. */
export function findSimilar(
  titleNorm: string, recent: readonly { id: string; title: string }[], threshold = DUPLICATE_SIMILARITY,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const r of recent) {
    const score = titleSimilarity(titleNorm, r.title);
    if (score >= threshold && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id ?? null;
}

/** Candidates worth showing a model for a semantic duplicate check: shares
 *  words with the title, most similar first. */
export function relatedCandidates(
  titleNorm: string, recent: readonly { id: string; title: string }[], limit = 12,
): { id: string; title: string }[] {
  const words = new Set(titleNorm.split(" ").filter(Boolean));
  return recent
    .map((r) => ({ r, overlap: r.title.split(" ").filter((w) => words.has(w)).length }))
    .filter((x) => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map((x) => x.r);
}

/* ── settings ──────────────────────────────────────────────────────────────── */

export type GrovNewsSettings = {
  mode: GrovNewsMode;
  dailyEnabled: boolean;
  runHour: number;
  timezone: "Europe/Warsaw";
  minRelevance: number;
  minImportance: number;
  maxTopics: number;
  autoPublishOfficialSensitive: boolean;
  /** Below this many valuable topics the day's article waits for a person
   *  (0125 §4) — it is still written, never padded. */
  minTopics: number;
  /** How old a story may be and still count as today's news. */
  lookbackHours: number;
  /** AUTOMATIC mode mails the day's article only while this is on. */
  emailEnabled: boolean;
};

export const DEFAULT_SETTINGS: GrovNewsSettings = {
  mode: "REVIEW", dailyEnabled: false, runHour: 6, timezone: "Europe/Warsaw",
  minRelevance: 60, minImportance: 60, maxTopics: 5, autoPublishOfficialSensitive: false,
  minTopics: 3, lookbackHours: 36, emailEnabled: true,
};

export const LOOKBACK_RANGE = { min: 12, max: 168 } as const;

const int = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function validateSettingsInput(raw: unknown): { ok: true; value: GrovNewsSettings } | { ok: false } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = (MODES as readonly string[]).includes(String(r.mode)) ? (r.mode as GrovNewsMode) : null;
  const runHour = int(r.runHour, 0, 23);
  const minRelevance = int(r.minRelevance, 0, 100);
  const minImportance = int(r.minImportance, 0, 100);
  const maxTopics = int(r.maxTopics, 1, 10);
  const minTopics = int(r.minTopics ?? DEFAULT_SETTINGS.minTopics, 1, 10);
  const lookbackHours = int(r.lookbackHours ?? DEFAULT_SETTINGS.lookbackHours, LOOKBACK_RANGE.min, LOOKBACK_RANGE.max);
  if (!mode || runHour === null || minRelevance === null || minImportance === null || maxTopics === null
      || minTopics === null || lookbackHours === null || minTopics > maxTopics) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      mode, runHour, minRelevance, minImportance, maxTopics, timezone: "Europe/Warsaw",
      dailyEnabled: r.dailyEnabled === true,
      autoPublishOfficialSensitive: r.autoPublishOfficialSensitive === true,
      minTopics, lookbackHours,
      emailEnabled: r.emailEnabled !== false,
    },
  };
}

/* ── sources ───────────────────────────────────────────────────────────────── */

export type SourceInput = {
  name: string;
  type: SourceType;
  url: string | null;
  enabled: boolean;
  categoryId: string | null;
  priority: number;
  official: boolean;
  language: "pl" | "en" | "de";
};

export type SourceInputError = "name" | "type" | "url" | "category" | "priority" | "language";

export function validateSourceInput(raw: unknown): { ok: true; value: SourceInput } | { ok: false; error: SourceInputError } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = cleanText(r.name, 200).replace(/\n/g, " ");
  if (!name || name.length > 120) return { ok: false, error: "name" };
  if (!(SOURCE_TYPES as readonly string[]).includes(String(r.type))) return { ok: false, error: "type" };
  const type = r.type as SourceType;
  const urlRaw = typeof r.url === "string" ? r.url.trim() : "";
  if (type !== "MANUAL" && !isAcceptableSourceUrl(urlRaw)) return { ok: false, error: "url" };
  if (type === "MANUAL" && urlRaw && !isAcceptableSourceUrl(urlRaw)) return { ok: false, error: "url" };
  const categoryId = r.categoryId ? String(r.categoryId) : null;
  if (categoryId !== null && !isUuid(categoryId)) return { ok: false, error: "category" };
  const priority = int(r.priority ?? 50, 0, 100);
  if (priority === null) return { ok: false, error: "priority" };
  const language = r.language === undefined ? "pl" : String(r.language);
  if (language !== "pl" && language !== "en" && language !== "de") return { ok: false, error: "language" };
  return {
    ok: true,
    value: {
      name, type, url: urlRaw || null, enabled: r.enabled !== false, categoryId, priority,
      official: r.official === true, language,
    },
  };
}

/* ── source health (0125 §2) ───────────────────────────────────────────────── */

/** What the database stores. DISABLED is not stored: it is `enabled = false`. */
export const STORED_HEALTH = ["HEALTHY", "DEGRADED", "FAILED", "UNSUPPORTED"] as const;
export type StoredHealth = (typeof STORED_HEALTH)[number];
export const HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "FAILED", "UNSUPPORTED", "DISABLED", "UNCHECKED"] as const;
export type SourceHealth = (typeof HEALTH_STATUSES)[number];

/** The state a screen shows: switched off beats everything, never checked is
 *  said out loud rather than shown as healthy. */
export function effectiveHealth(enabled: boolean, stored: string | null): SourceHealth {
  if (!enabled) return "DISABLED";
  return (STORED_HEALTH as readonly string[]).includes(stored ?? "") ? (stored as StoredHealth) : "UNCHECKED";
}

/* ── the day's article: its editorial record (0125 §5) ────────────────────── */

/** The editorial record of a day's article (kept on the admin-only edition,
 *  never on the post — 0125 §5). */
export type DailyTopicRecord = {
  itemId: string; title: string; short: string; mail: string; category: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW"; official: boolean;
  sources: { url: string; title: string; source: string; official: boolean }[];
  review: boolean; reviewReason: string | null;
};
export type DailyRecord = {
  version: 1; date: string; headline: string; opening: string; mailIntro: string; watch: string[];
  topics: DailyTopicRecord[]; review: { required: boolean; reasons: string[] }; generatedAt: string;
};

const recStr = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A stored record, re-validated on the way in: it is data, and the mail and
 *  the review screen render it. */
export function readDailyRecord(v: unknown): DailyRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const topics = (Array.isArray(r.topics) ? r.topics : []).slice(0, 10).flatMap((t): DailyTopicRecord[] => {
    if (!t || typeof t !== "object") return [];
    const o = t as Record<string, unknown>;
    const title = recStr(o.title, 200);
    if (!title) return [];
    const conf = o.confidence === "HIGH" || o.confidence === "MEDIUM" ? o.confidence : "LOW";
    return [{
      itemId: recStr(o.itemId, 40), title, short: recStr(o.short, 400), mail: recStr(o.mail, 900),
      category: typeof o.category === "string" ? o.category.slice(0, 60) : null, confidence: conf, official: o.official === true,
      sources: (Array.isArray(o.sources) ? o.sources : []).slice(0, 12).flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const x = s as Record<string, unknown>;
        const url = recStr(x.url, 2000);
        return /^https:\/\//i.test(url) ? [{ url, title: recStr(x.title, 300), source: recStr(x.source, 120), official: x.official === true }] : [];
      }),
      review: o.review === true, reviewReason: typeof o.reviewReason === "string" ? o.reviewReason.slice(0, 300) : null,
    }];
  });
  const review = (r.review && typeof r.review === "object" ? r.review : {}) as Record<string, unknown>;
  return {
    version: 1, date: recStr(r.date, 10), headline: recStr(r.headline, 200), opening: recStr(r.opening, 1200),
    mailIntro: recStr(r.mailIntro, 600),
    watch: (Array.isArray(r.watch) ? r.watch : []).slice(0, 6).map((w) => recStr(w, 300)).filter(Boolean),
    topics,
    review: {
      required: review.required === true,
      reasons: (Array.isArray(review.reasons) ? review.reasons : []).slice(0, 10).map((x) => recStr(x, 60)).filter(Boolean),
    },
    generatedAt: recStr(r.generatedAt, 40),
  };
}

/* ── manual research items ─────────────────────────────────────────────────── */

export type ManualItemInput = { title: string; url: string; excerpt: string; sourceId: string | null };

export function validateManualItem(raw: unknown): { ok: true; value: ManualItemInput } | { ok: false } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = cleanText(r.title, 600).replace(/\n/g, " ");
  const url = typeof r.url === "string" ? r.url.trim() : "";
  const excerpt = cleanText(r.excerpt, 2000);
  const sourceId = r.sourceId ? String(r.sourceId) : null;
  if (!title || title.length > 500 || !normalizeUrl(url) || !/^https:\/\//i.test(url) || url.length > 2000) return { ok: false };
  if (sourceId !== null && !isUuid(sourceId)) return { ok: false };
  return { ok: true, value: { title, url, excerpt, sourceId } };
}

/* ── the autopublish rule ──────────────────────────────────────────────────── */

export type PublishReason = "review_mode" | "review_required" | "below_threshold" | "single_source" | "sensitive" | "ok";

/**
 * Would the daily job publish this post by itself? The same test the database
 * runs in grovnews_create_post — shown to the admin so "why is this still a
 * draft?" always has an answer.
 */
export function autoPublishDecision(
  item: {
    reviewRequired: boolean; relevance: number | null; importance: number | null;
    sensitive: boolean; categorySlug: string | null;
    /** The item's OWN source is official (a duplicate's does not count). */
    official: boolean;
    /** The same story was also found at another source. */
    corroborated: boolean;
  },
  settings: Pick<GrovNewsSettings, "mode" | "minRelevance" | "minImportance" | "autoPublishOfficialSensitive">,
): { publish: boolean; reason: PublishReason } {
  if (settings.mode !== "AUTOMATIC") return { publish: false, reason: "review_mode" };
  if (item.reviewRequired) return { publish: false, reason: "review_required" };
  if ((item.relevance ?? 0) < settings.minRelevance || (item.importance ?? 0) < settings.minImportance) {
    return { publish: false, reason: "below_threshold" };
  }
  // One unofficial source is never enough without a human.
  if (!item.official && !item.corroborated) return { publish: false, reason: "single_source" };
  const sensitive = item.sensitive || (item.categorySlug !== null && SENSITIVE_CATEGORY_SLUGS.includes(item.categorySlug));
  if (sensitive && !(item.official && settings.autoPublishOfficialSensitive)) return { publish: false, reason: "sensitive" };
  return { publish: true, reason: "ok" };
}

/* ── dates ─────────────────────────────────────────────────────────────────── */

/** Today (or `d`) as a Warsaw calendar date, YYYY-MM-DD — the edition key.
 *  Stored in UTC, shown in Warsaw (HQ rule 7). */
export function warsawDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** DD.MM.YYYY from a YYYY-MM-DD edition date — numeric, so server and
 *  browser always print the same thing. */
export function editionDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : isoDate;
}

/* ── reading time of a digest ──────────────────────────────────────────────── */

/** A digest is meant to take 3–5 minutes: roughly 450–1100 words. */
export const DIGEST_WORDS = { min: 450, max: 1100 } as const;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function digestMinutes(texts: readonly string[]): number {
  return Math.max(1, Math.round(texts.reduce((n, t) => n + wordCount(t), 0) / 220));
}
