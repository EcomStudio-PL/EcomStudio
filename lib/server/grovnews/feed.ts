import "server-only";

/**
 * FEED PARSING — RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed, plus the
 * article links of a plain listing page.
 *
 * No XML library: the repository has none, and a feed needs very little of
 * one. What it does NOT do is the point as much as what it does:
 *
 *   · no DTD, no entity declarations, no external entities — a DOCTYPE is
 *     dropped unread, so a "billion laughs" or an XXE payload is inert text;
 *   · only XML/HTML character entities are decoded, in one pass;
 *   · EVERY SCAN IS LINEAR. The document is untrusted and up to megabytes
 *     long; a lazy `[\s\S]*?` regex over it is quadratic on hostile input
 *     (thousands of unclosed `<!--` or `<title>`), which would hold the daily
 *     job past its deadline. So elements are found with indexOf, a missing
 *     closing tag ends the scan instead of restarting it, and at most
 *     MAX_INPUT characters are read at all;
 *   · every string is capped, every list is capped, and a link must be
 *     http(s) after resolution against the feed's own URL.
 *
 * The output is DATA ONLY — titles, links, dates and a short plain-text
 * extract. It is never HTML and never an instruction to anything downstream.
 */

export type FeedEntry = {
  title: string;
  url: string;
  publishedAt: string | null;
  excerpt: string;
  guid: string | null;
  categories: string[];
};

export type ParsedFeed = { kind: "rss" | "rdf" | "atom" | "json" | "page" | "api"; title: string | null; entries: FeedEntry[] };

export const MAX_ENTRIES = 50;
/** Characters parsed per document. Fifty feed entries fit many times over. */
export const MAX_INPUT = 600_000;
const MAX_TITLE = 500;
const MAX_EXCERPT = 1200;

/* ── linear primitives ─────────────────────────────────────────────────────── */

/** ASCII-only lower-casing: same length, same indices as the original. */
function lower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

const NAME_END = /[\s>/]/;

type Element = { attrs: string; inner: string; end: number };

/**
 * The elements named `name` in `src`, in order, as raw inner markup. `low` is
 * `lower(src)`. A self-closing element has empty inner markup. When an opening
 * tag has no closing tag, no later one can either — the scan stops there.
 */
function elements(src: string, low: string, name: string, limit: number): Element[] {
  const out: Element[] = [];
  const open = `<${name}`;
  const close = `</${name}`;
  let at = 0;
  while (out.length < limit) {
    const start = low.indexOf(open, at);
    if (start < 0) break;
    const next = src[start + open.length] ?? "";
    if (!NAME_END.test(next)) { at = start + open.length; continue; }
    const gt = src.indexOf(">", start);
    if (gt < 0) break;
    const attrs = src.slice(start + open.length, gt).slice(0, 4000);
    if (src[gt - 1] === "/") {
      out.push({ attrs, inner: "", end: gt + 1 });
      at = gt + 1;
      continue;
    }
    const closeAt = low.indexOf(close, gt + 1);
    if (closeAt < 0) break;
    const closeGt = src.indexOf(">", closeAt);
    out.push({ attrs, inner: src.slice(gt + 1, closeAt), end: closeGt < 0 ? src.length : closeGt + 1 });
    at = closeGt < 0 ? src.length : closeGt + 1;
  }
  return out;
}

function child(block: string, names: readonly string[]): string | null {
  const low = lower(block);
  for (const name of names) {
    const found = elements(block, low, name, 1);
    if (found.length) return found[0].inner;
  }
  return null;
}

/** Remove every `open … close` span (case-insensitive); an unclosed one
 *  removes the rest of the document. One pass. */
function removeSpans(src: string, open: string, close: string): string {
  const low = lower(src);
  let out = "";
  let at = 0;
  for (;;) {
    const start = low.indexOf(open, at);
    if (start < 0) { out += src.slice(at); break; }
    out += src.slice(at, start) + " ";
    const end = low.indexOf(close, start + open.length);
    if (end < 0) break;
    at = end + close.length;
  }
  return out;
}

/** Remove whole elements (with their content) by name. */
function removeElements(src: string, names: readonly string[]): string {
  let out = src;
  for (const name of names) {
    const low = lower(out);
    let res = "";
    let at = 0;
    for (;;) {
      let start = low.indexOf(`<${name}`, at);
      while (start >= 0 && !NAME_END.test(out[start + name.length + 1] ?? "")) start = low.indexOf(`<${name}`, start + 1);
      if (start < 0) { res += out.slice(at); break; }
      res += out.slice(at, start) + " ";
      const end = low.indexOf(`</${name}`, start);
      if (end < 0) break;
      const gt = out.indexOf(">", end);
      at = gt < 0 ? out.length : gt + 1;
    }
    out = res;
  }
  return out;
}

/** CDATA sections become escaped text: whatever markup they carried is then
 *  decoded and stripped like any other. */
function stripCdata(s: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const start = s.indexOf("<![CDATA[", at);
    if (start < 0) { out += s.slice(at); break; }
    out += s.slice(at, start);
    const end = s.indexOf("]]>", start + 9);
    const inner = s.slice(start + 9, end < 0 ? s.length : end);
    out += inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (end < 0) break;
    at = end + 3;
  }
  return out;
}

/** Tags out, in one pass. A `<` with no `>` anywhere after it is text, and so
 *  is every later one — the search for `>` is never repeated. */
function stripTags(s: string): string {
  let out = "";
  let at = 0;
  let noMoreGt = false;
  while (at < s.length) {
    const lt = s.indexOf("<", at);
    if (lt < 0 || noMoreGt) { out += s.slice(at); break; }
    const nextCh = s[lt + 1] ?? "";
    if (!/[A-Za-z/!?]/.test(nextCh)) { out += s.slice(at, lt + 1); at = lt + 1; continue; }
    const gt = s.indexOf(">", lt);
    if (gt < 0) { noMoreGt = true; out += s.slice(at); break; }
    out += s.slice(at, lt) + " ";
    at = gt + 1;
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
  middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", euro: "€", deg: "°", times: "×", shy: "",
  oacute: "ó", Oacute: "Ó", eacute: "é", aacute: "á", uuml: "ü", ouml: "ö", auml: "ä", Uuml: "Ü", Ouml: "Ö", Auml: "Ä", szlig: "ß",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      return String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? m;
  });
}

function cap(text: string, max: number): string {
  const flat = text.replace(/�/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  cut = space > Math.floor(max * 0.6) ? cut.slice(0, space) : cut.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

const CODE_ELEMENTS = ["script", "style", "head", "title", "noscript", "template", "svg", "iframe", "object"] as const;

/** Markup → plain text: code-bearing elements out with their content, tags
 *  out, entities decoded — twice when the first decode revealed escaped
 *  markup ("&lt;p&gt;"), which feeds do constantly. Linear throughout. */
export function htmlToText(markup: string, max: number): string {
  const pass = (s: string) => decodeEntities(stripTags(removeElements(removeSpans(s, "<!--", "-->"), CODE_ELEMENTS)));
  const once = pass(stripCdata(markup.slice(0, MAX_INPUT)));
  const twice = /<[A-Za-z/!]|&[#a-z]/i.test(once) ? pass(once) : once;
  return cap(twice, max);
}

/* ── feeds ─────────────────────────────────────────────────────────────────── */

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function absolute(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(htmlToText(href, 2000), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/** A date we can trust: parseable and not in the future (a feed dated next
 *  year is a broken feed, not tomorrow's news). */
function date(value: string | null | undefined, now: number): string | null {
  if (!value) return null;
  const t = Date.parse(htmlToText(value, 100));
  if (!Number.isFinite(t) || t > now + 24 * 3600_000 || t < Date.UTC(2000, 0, 1)) return null;
  return new Date(t).toISOString();
}

function entry(
  raw: { title: string | null; url: string | null; date: string | null; excerpt: string | null; guid: string | null; categories: string[] },
): FeedEntry | null {
  const title = raw.title ? htmlToText(raw.title, MAX_TITLE) : "";
  if (!title || !raw.url) return null;
  return {
    title,
    url: raw.url,
    publishedAt: raw.date,
    excerpt: raw.excerpt ? htmlToText(raw.excerpt, MAX_EXCERPT) : "",
    guid: raw.guid ? htmlToText(raw.guid, 300) || null : null,
    categories: raw.categories.map((c) => htmlToText(c, 60)).filter(Boolean).slice(0, 8),
  };
}

const isEntry = (e: FeedEntry | null): e is FeedEntry => e !== null;
const textOrNull = (v: string | null): string | null => (v ? htmlToText(v, 200) || null : null);

/** The DOCTYPE, internal subset and all, removed unread. */
function dropDoctype(xml: string): string {
  const low = lower(xml.slice(0, 20_000));
  const start = low.indexOf("<!doctype");
  if (start < 0) return xml;
  const bracket = xml.indexOf("[", start);
  const gt = xml.indexOf(">", start);
  if (gt < 0) return xml.slice(0, start);
  if (bracket >= 0 && bracket < gt) {
    const end = xml.indexOf("]>", bracket);
    return end < 0 ? xml.slice(0, start) : xml.slice(0, start) + xml.slice(end + 2);
  }
  return xml.slice(0, start) + xml.slice(gt + 1);
}

function parseXml(body: string, base: string, now: number): ParsedFeed | null {
  const xml = removeSpans(dropDoctype(body.replace(/^﻿/, "").slice(0, MAX_INPUT)), "<!--", "-->");
  const low = lower(xml);
  const head = low.slice(0, 4000);

  if (/<feed[\s>]/.test(head)) {
    const entries = elements(xml, low, "entry", MAX_ENTRIES).map(({ inner: b }) => {
      const bl = lower(b);
      const links = elements(b, bl, "link", 20).map((l) => l.attrs);
      const alt = links.find((l) => !attr(l, "rel") || attr(l, "rel") === "alternate") ?? links[0] ?? "";
      return entry({
        title: child(b, ["title"]),
        url: absolute(attr(alt, "href"), base),
        date: date(child(b, ["published", "updated", "dc:date"]), now),
        excerpt: child(b, ["summary", "content"]),
        guid: child(b, ["id"]),
        categories: elements(b, bl, "category", 8).map((c) => attr(c.attrs, "term") ?? "").filter(Boolean),
      });
    });
    const firstEntry = low.indexOf("<entry");
    const feedHead = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml.slice(0, 4000);
    return { kind: "atom", title: textOrNull(child(feedHead, ["title"])), entries: entries.filter(isEntry) };
  }

  const isRdf = /<rdf:rdf[\s>]/.test(head);
  if (isRdf || /<rss[\s>]/.test(head) || /<channel[\s>]/.test(head)) {
    const entries = elements(xml, low, "item", MAX_ENTRIES).map(({ inner: b, attrs }) => {
      const guid = child(b, ["guid"]);
      const guidText = guid ? htmlToText(guid, 2000) : "";
      const link = child(b, ["link"]) ?? (/^https?:\/\//i.test(guidText) ? guidText : attr(attrs, "rdf:about"));
      return entry({
        title: child(b, ["title"]),
        url: absolute(link, base),
        date: date(child(b, ["pubDate", "pubdate", "dc:date", "published", "updated"].map(lower)), now),
        excerpt: child(b, ["description", "content:encoded", "summary"]),
        guid,
        categories: elements(b, lower(b), "category", 8).map((c) => c.inner),
      });
    });
    const firstItem = low.indexOf("<item");
    const channelHead = firstItem >= 0 ? xml.slice(0, firstItem) : xml.slice(0, 4000);
    return { kind: isRdf ? "rdf" : "rss", title: textOrNull(child(channelHead, ["title"])), entries: entries.filter(isEntry) };
  }
  return null;
}

function parseJsonFeed(body: string, base: string, now: number): ParsedFeed | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body.slice(0, MAX_INPUT * 2));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (typeof d.version !== "string" || !/^https:\/\/jsonfeed\.org\/version\//.test(d.version) || !Array.isArray(d.items)) {
    return null;
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const esc = (v: string | null) => (v ? v.replace(/&/g, "&amp;").replace(/</g, "&lt;") : null);
  const entries = d.items.slice(0, MAX_ENTRIES).map((raw) => {
    const it = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return entry({
      title: esc(str(it.title)),
      url: absolute(str(it.url) ?? str(it.external_url), base),
      date: date(str(it.date_published) ?? str(it.date_modified), now),
      excerpt: str(it.summary) ? esc(str(it.summary)) : str(it.content_html) ?? esc(str(it.content_text)),
      guid: esc(str(it.id)),
      categories: Array.isArray(it.tags) ? it.tags.filter((t): t is string => typeof t === "string").map((t) => esc(t) ?? "") : [],
    });
  });
  return { kind: "json", title: str(d.title) ? htmlToText(esc(str(d.title)) ?? "", 200) : null, entries: entries.filter(isEntry) };
}

/** Any feed format, detected from the document itself. */
export function parseFeed(body: string, baseUrl: string, now: number = Date.now()): ParsedFeed | null {
  const trimmed = body.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("{")) return parseJsonFeed(trimmed, baseUrl, now);
  if (trimmed.startsWith("<")) return parseXml(trimmed, baseUrl, now);
  return null;
}

/* ── a plain JSON API (0128) ───────────────────────────────────────────────── */

/** Where an API response keeps its list, in the order they are tried. */
const API_LIST_KEYS = ["items", "articles", "data", "results", "entries", "news", "posts"] as const;
const API_TITLE = ["title", "headline", "name"] as const;
const API_URL = ["url", "link", "href", "web_url", "permalink"] as const;
const API_DATE = ["published_at", "publishedAt", "date_published", "date", "pubDate", "published", "created_at", "updated_at"] as const;
const API_SUMMARY = ["summary", "description", "excerpt", "abstract", "lead", "teaser"] as const;

/**
 * A MINIMAL generic JSON mapping for an API that is not a feed: an array of
 * objects — at the top level, or under items / articles / data / results /
 * entries (one level down, or data.<one of those>) — each with a title and a
 * URL, and optionally a date and a summary. Anything else is not a format we
 * read (null). Everything taken from it is treated exactly like a feed entry:
 * capped, markup-stripped, http(s) links only, dates sanity-checked.
 */
export function parseApiJson(body: string, baseUrl: string, now: number = Date.now()): ParsedFeed | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body.replace(/^﻿/, "").slice(0, MAX_INPUT * 2));
  } catch {
    return null;
  }
  const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
  const listIn = (o: Record<string, unknown> | null): unknown[] | null => {
    if (!o) return null;
    for (const k of API_LIST_KEYS) if (Array.isArray(o[k])) return o[k] as unknown[];
    return null;
  };
  const top = obj(doc);
  const list = Array.isArray(doc) ? doc : listIn(top) ?? listIn(obj(top?.data)) ?? null;
  if (!list) return null;
  const pick = (o: Record<string, unknown>, keys: readonly string[]): string | null => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };
  const esc = (v: string | null) => (v ? v.replace(/&/g, "&amp;").replace(/</g, "&lt;") : null);
  const entries = list.slice(0, MAX_ENTRIES).map((raw) => {
    const it = obj(raw);
    if (!it) return null;
    return entry({
      title: esc(pick(it, API_TITLE)),
      url: absolute(pick(it, API_URL), baseUrl),
      date: date(pick(it, API_DATE), now),
      // A summary may be HTML (it is stripped) or plain text (escaped first).
      excerpt: pick(it, API_SUMMARY),
      guid: esc(typeof it.id === "string" || typeof it.id === "number" ? String(it.id) : null),
      categories: [],
    });
  });
  const title = top ? pick(top, ["title", "name"]) : null;
  return { kind: "api", title: title ? htmlToText(esc(title) ?? "", 200) : null, entries: entries.filter(isEntry) };
}

/**
 * A listing page (an "aktualności" page without a feed): the article links in
 * its main content, same site only, with their anchor text as the title.
 * One page, no pagination, no following of links — a reader, not a crawler.
 */
export function extractListing(html: string, pageUrl: string): ParsedFeed {
  const page = new URL(pageUrl);
  const cleaned = removeElements(removeSpans(html.slice(0, MAX_INPUT), "<!--", "-->"),
    ["script", "style", "noscript", "template", "svg"]);
  const low = lower(cleaned);
  const main = elements(cleaned, low, "main", 1)[0]?.inner;
  const articles = main ? "" : elements(cleaned, low, "article", 60).map((a) => a.inner).join("\n");
  const body = elements(cleaned, low, "body", 1)[0]?.inner;
  const region = removeElements(main || articles || body || cleaned, ["nav", "header", "footer", "aside", "form"]);

  const seen = new Set<string>();
  const entries: FeedEntry[] = [];
  for (const a of elements(region, lower(region), "a", 400)) {
    const url = absolute(attr(a.attrs, "href"), pageUrl);
    if (!url) continue;
    const target = new URL(url);
    if (target.hostname !== page.hostname || target.pathname === page.pathname || target.pathname === "/") continue;
    const title = htmlToText(a.inner, MAX_TITLE);
    if (title.length < 20 || seen.has(target.pathname)) continue;
    seen.add(target.pathname);
    entries.push({ title, url, publishedAt: null, excerpt: "", guid: null, categories: [] });
    if (entries.length >= 30) break;
  }
  const title = elements(html.slice(0, 200_000), lower(html.slice(0, 200_000)), "title", 1)[0]?.inner;
  return { kind: "page", title: title ? htmlToText(title, 200) : null, entries };
}

/* ── discovery (Stage 5) ───────────────────────────────────────────────────── */

const FEED_LINK_TYPES = new Set([
  "application/rss+xml", "application/atom+xml", "application/feed+json", "application/rdf+xml",
]);

/**
 * The feeds a page announces in its <head>: `<link rel="alternate"
 * type="application/rss+xml|atom+xml|feed+json" href="…">`, resolved against
 * the page and https only. At most five, in the page's order. It only READS
 * what the site publishes about itself — nothing is guessed here.
 */
export function discoverFeeds(html: string, pageUrl: string): { url: string; type: string }[] {
  const src = html.slice(0, 200_000);
  const low = lower(src);
  const headEnd = low.indexOf("</head>");
  const head = headEnd > 0 ? src.slice(0, headEnd) : src;
  const headLow = lower(head);
  const out: { url: string; type: string }[] = [];
  const seen = new Set<string>();
  // <link> is a void element: HTML5 writes it without "/>" and never closes
  // it, so each tag is read on its own (not as an open…close span).
  let at = 0;
  for (let scanned = 0; scanned < 300 && out.length < 5; ) {
    const start = headLow.indexOf("<link", at);
    if (start < 0) break;
    const gt = head.indexOf(">", start);
    if (gt < 0) break;
    at = gt + 1;
    if (!NAME_END.test(head[start + 5] ?? "")) continue;
    scanned++;
    const attrs = head.slice(start + 5, gt).slice(0, 4000);
    const rel = (attr(attrs, "rel") ?? "").toLowerCase().split(/\s+/);
    const type = (attr(attrs, "type") ?? "").toLowerCase().trim();
    if (!rel.includes("alternate") || !FEED_LINK_TYPES.has(type)) continue;
    const url = absolute(attr(attrs, "href"), pageUrl);
    if (!url || !url.startsWith("https://") || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, type });
  }
  return out;
}

/**
 * What a page says about ITSELF that decides whether GrovNews may read it:
 * a bot-protection challenge (Cloudflare, DataDome, PerimeterX, Imperva,
 * reCAPTCHA / hCaptcha / Turnstile) or a login form standing where the
 * content should be. GrovNews does not solve challenges or sign in — such a
 * page is UNSUPPORTED, full stop. Also whether it is a WordPress site (which
 * publishes a feed at /feed/ by convention).
 */
export function pageSignals(html: string): { botProtection: boolean; loginWall: boolean; wordpress: boolean } {
  const low = lower(html.slice(0, 300_000));
  // Interstitials are small; a long document is a page with content of its
  // own even when it marks none up as <main>/<article>.
  const content = low.includes("<article") || low.includes("<main") || html.length > 150_000;
  // A challenge page says so; a widget or a vendor script alone (a captcha on
  // a feedback form, a bot-management tag on an ordinary page) is only a
  // challenge when the page has no content of its own.
  const challenge = [
    "cf-chl-", "cf_chl_opt", "just a moment...", "attention required! | cloudflare",
    "captcha-delivery.com", "px-captcha", "_incapsula_resource", "incapsula incident",
    "are you a robot", "verify you are human",
  ].some((m) => low.includes(m));
  const widget = ["challenge-platform", "datadome", "g-recaptcha", "h-captcha", "cf-turnstile"].some((m) => low.includes(m));
  const botProtection = challenge || (widget && !content);
  const passwordField = /<input[^>]{0,400}type\s*=\s*["']?password/.test(low);
  const loginWall = passwordField && !content;
  const wordpress = low.includes("/wp-content/") || low.includes("/wp-includes/") || low.includes("wp-json");
  return { botProtection, loginWall, wordpress };
}
