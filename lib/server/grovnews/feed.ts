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

export type ParsedFeed = { kind: "rss" | "rdf" | "atom" | "json" | "page"; title: string | null; entries: FeedEntry[] };

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
