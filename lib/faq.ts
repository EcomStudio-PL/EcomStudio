import type { TicketTopic } from "./contact-page";
import { PUBLIC_TOOLS } from "./public-tools";

/**
 * FAQ V1 — ONE BASE OF QUESTIONS, THREE PAGES.
 *
 * Every question lives once, in public.faq_items (0155), in one of the
 * public.faq_categories, and says on which pages it appears: /faq, /plany
 * (the public cennik and the in-app /plan) and /o-nas. Changing an answer in
 * the base changes it everywhere it is shown; nothing is copied into a page's
 * content any more.
 *
 * This file is what every side shares and nothing here talks to the
 * database: the pages and their names, the small answer format, the rule that
 * decides whether a text may be shown at all, the reasons an item is not on a
 * page (for the editor), and the search the /faq page runs in the browser.
 *
 * WHAT A VISITOR NEVER RECEIVES. A hidden item, an item still waiting for a
 * review, an item of a hidden category, and any text that is empty or still
 * holds a bracketed placeholder — "[DO POTWIERDZENIA]", "[X]", "[data]",
 * "[nazwa firmy]" — are dropped on the SERVER (faq_public() in the database,
 * and again in lib/server/faq.ts per language). They are not in the HTML, not
 * in the RSC payload and not in any FAQPage structured data.
 */

/* ── pages ──────────────────────────────────────────────────────────────── */

export const FAQ_PAGES = ["faq", "plany", "o-nas"] as const;
export type FaqPage = (typeof FAQ_PAGES)[number];

export const isFaqPage = (v: unknown): v is FaqPage =>
  typeof v === "string" && (FAQ_PAGES as readonly string[]).includes(v);

/** The tools a question may be assigned to (0158, Public Tools V1): the
 *  public tool pages, whose block shows up to three of them. Not a second
 *  table — the item says which tools, as it says which pages. */
export const FAQ_TOOLS: readonly string[] = PUBLIC_TOOLS.filter((t) => t.seo !== false).map((t) => t.key);
export const isFaqTool = (v: unknown): v is string =>
  typeof v === "string" && FAQ_TOOLS.includes(v);

export const FAQ_LOCALES = ["pl", "en", "de"] as const;
export type FaqLocale = (typeof FAQ_LOCALES)[number];
export type FaqText = Partial<Record<FaqLocale, string>>;

/** Section type of the /faq page's own block (hero, search, list, CTA). */
export const FAQ_PAGE_TYPE = "faq_page";
export const isFaqPageType = (type: string): boolean => type === FAQ_PAGE_TYPE;

/**
 * The /faq section's own words (content.fields), every one editable in
 * "Edytuj stronę" and Strony WWW; empty falls back to the dictionary
 * (cms.faq.text.<key>), so the page never loses a label. The hero and the
 * closing tile use the shared fields: badge, title, subtitle + ctaLabel/ctaUrl
 * + description (one line with a link in it), cta2Label/cta2Url.
 */
export const FAQ_TEXT_KEYS = [
  "find.placeholder", "find.empty", "find.emptyHint", "find.emptyCta",
  "topics.label", "end.title",
  "vote.question", "vote.yes", "vote.no", "vote.thanks", "vote.sorry", "vote.contact",
  "link.copy", "link.copied",
] as const;
export type FaqTextKey = (typeof FAQ_TEXT_KEYS)[number];

/** The URL of one question, the address the Kontakt page links to. */
export const faqItemHref = (slug: string): string => `/faq#${slug}`;

/* ── slugs ──────────────────────────────────────────────────────────────── */

export const FAQ_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const FAQ_SLUG_MAX = { item: 80, category: 60 } as const;

const PL_FOLD: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };

/** "Czy otrzymam fakturę VAT?" → "czy-otrzymam-fakture-vat". */
export function faqSlugify(text: string, max: number = FAQ_SLUG_MAX.item): string {
  const folded = [...text.toLowerCase()].map((c) => PL_FOLD[c] ?? c).join("")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}

/* ── the answer format ──────────────────────────────────────────────────────
 *
 * Deliberately tiny, so it can never carry markup: paragraphs (a blank line),
 * **bold** and [a link](/kontakt). A link may go to a page of the site
 * ("/…", never "//…"), an anchor ("#…"), an https page or an e-mail address;
 * anything else is shown as its words, without a link. Rendered by React from
 * these nodes — there is no HTML string anywhere on the way.
 */

export type FaqInline =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "a"; v: string; href: string };
/** One paragraph. */
export type FaqParagraph = FaqInline[];
export type FaqRich = FaqParagraph[];

/** The link a visitor may follow, or null. */
export function faqSafeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > 500 || /\s/.test(v)) return null;
  if (/^\/(?!\/)[A-Za-z0-9/_\-.?=&#%]*$/.test(v)) return v;
  if (/^#[A-Za-z0-9_-]{1,80}$/.test(v)) return v;
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

const INLINE = /\*\*([^*\n]+?)\*\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

function parseInline(text: string): FaqParagraph {
  const out: FaqParagraph = [];
  const push = (node: FaqInline) => {
    const last = out[out.length - 1];
    if (node.t === "text" && last?.t === "text") last.v += node.v;
    else if (node.v) out.push(node);
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > at) push({ t: "text", v: text.slice(at, start) });
    if (m[1] !== undefined) push({ t: "b", v: m[1] });
    else {
      const href = faqSafeHref(m[3] ?? "");
      push(href ? { t: "a", v: m[2] ?? "", href } : { t: "text", v: m[2] ?? "" });
    }
    at = start + m[0].length;
  }
  if (at < text.length) push({ t: "text", v: text.slice(at) });
  return out;
}

/** Text → paragraphs of nodes. Single line breaks inside a paragraph read as
 *  spaces; blank lines start a new paragraph. */
export function parseFaqRich(text: string): FaqRich {
  return text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map(parseInline)
    .filter((p) => p.length > 0);
}

/** The answer's words, without the formatting — for structured data and the
 *  search. Paragraphs are joined by a blank line. */
export function faqPlainText(rich: FaqRich): string {
  return rich.map((p) => p.map((n) => n.v).join("")).join("\n\n");
}

/* ── what may be shown ──────────────────────────────────────────────────── */

/** A link in the answer format is not a placeholder; everything else in
 *  square brackets is. The same pattern lives in public.faq_text_ok (0155). */
const LINK_SYNTAX = /\[[^\]\n]{1,200}\]\((?:https:\/\/|\/|#|mailto:)[^)\s]{1,500}\)/g;

/** "[DO POTWIERDZENIA]", "[X]", "[25]", "[nazwa firmy]", "[data]" … */
export function faqHasPlaceholder(text: string | null | undefined): boolean {
  return /[[\]]/.test((text ?? "").replace(LINK_SYNTAX, ""));
}

/** A text that may reach a visitor: not empty, no placeholder. */
export function faqTextOk(text: string | null | undefined): boolean {
  return Boolean(text && text.trim()) && !faqHasPlaceholder(text);
}

/* ── the editor's view of an item ───────────────────────────────────────── */

export type FaqCategoryRow = {
  id: string;
  slug: string;
  name: FaqText;
  position: number;
  visible: boolean;
  contact_topic: TicketTopic;
  updated_at: string;
};

export type FaqItemRow = {
  id: string;
  slug: string;
  category_id: string;
  question: FaqText;
  answer: FaqText;
  position: number;
  visible: boolean;
  pages: FaqPage[];
  /** Public tool keys (FAQ_TOOLS) whose page block may show it. */
  tools: string[];
  only_premiere: boolean;
  needs_review: boolean;
  review_note: string | null;
  draft_answer: FaqText | null;
  helpful_count: number;
  unhelpful_count: number;
  import_key: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * WHY AN ITEM IS NOT ON A PAGE — every reason, so the editor can say all of
 * them at once ("ukryte · wymaga uzupełnienia"). An empty list means the item
 * is public on each of its pages (in Polish; another language falls back to
 * Polish while its own text is missing).
 */
export type FaqHiddenReason =
  | "hidden" | "needs_review" | "category_hidden" | "no_pages"
  | "empty_question" | "empty_answer" | "placeholder" | "premiere_only";

export function faqHiddenReasons(
  item: Pick<FaqItemRow, "visible" | "needs_review" | "pages" | "question" | "answer" | "only_premiere"> & { tools?: readonly string[] },
  category: Pick<FaqCategoryRow, "visible"> | null | undefined,
  opts: { premiere?: boolean } = {},
): FaqHiddenReason[] {
  const out: FaqHiddenReason[] = [];
  if (!item.visible) out.push("hidden");
  if (item.needs_review) out.push("needs_review");
  if (!category || !category.visible) out.push("category_hidden");
  // A tool page is a page too: assigned to a tool only, it is not "nowhere".
  if (item.pages.length === 0 && (item.tools ?? []).length === 0) out.push("no_pages");
  const q = item.question.pl ?? "";
  const a = item.answer.pl ?? "";
  if (!q.trim()) out.push("empty_question");
  if (!a.trim()) out.push("empty_answer");
  if ((q.trim() && faqHasPlaceholder(q)) || (a.trim() && faqHasPlaceholder(a))) out.push("placeholder");
  if (item.only_premiere && opts.premiere === false) out.push("premiere_only");
  return out;
}

/** "Wymaga uzupełnienia": the Polish text cannot be shown as it is. */
export const faqNeedsContent = (item: Pick<FaqItemRow, "question" | "answer">): boolean =>
  !faqTextOk(item.question.pl) || !faqTextOk(item.answer.pl);

/* ── input validation (the database checks the same) ───────────────────── */

export const FAQ_LIMITS = { question: 300, answer: 4000, category: 80, note: 1000 } as const;

/** Characters no stored text may carry — the set of public.content_text_ok
 *  (0141): invisible and direction-changing characters, controls other than a
 *  newline, and markup brackets. */
const FORBIDDEN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0<>]|[\u{E0000}-\u{E007F}]/u;

export const faqCharsOk = (text: string): boolean => !FORBIDDEN.test(text);

export type FaqFieldProblem = "required" | "too_long" | "chars" | "slug" | "pages" | "tools" | "category";

/** A locale map, cleaned: trimmed values, empty ones dropped. */
export function cleanFaqText(input: unknown, max: number): { value: FaqText; problem: FaqFieldProblem | null } {
  const value: FaqText = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value, problem: null };
  for (const l of FAQ_LOCALES) {
    const raw = (input as Record<string, unknown>)[l];
    if (typeof raw !== "string") continue;
    const v = raw.replace(/\r\n?/g, "\n").trim();
    if (!v) continue;
    if (v.length > max) return { value, problem: "too_long" };
    if (!faqCharsOk(v)) return { value, problem: "chars" };
    value[l] = v;
  }
  return { value, problem: null };
}

/* ── the contact link after "Nie" ───────────────────────────────────────── */

export type FaqVote = "yes" | "no";

/* ── search (the /faq page, in the browser) ─────────────────────────────────
 *
 * No search engine: the page already holds every published answer, so the
 * search folds and stems the few hundred words it has. FOLD keeps one
 * character per character (ą → a, Ł → l, É → e), so a match found in the
 * folded text is at the same offsets in the text the visitor reads — which is
 * what lets the highlight mark the visitor's own words.
 *
 * STEMMING is the cheap kind that is right for a FAQ: drop one common Polish
 * ending, keep at least three letters, and match words that START with what
 * is left. "fakturę" → "faktur" finds "faktura", "faktury", "fakturach";
 * "zwrotu" → "zwrot" finds "zwrot" and "zwrotów".
 */

function foldUnit(c: string): string {
  const lower = c.toLowerCase();
  const pl = PL_FOLD[lower];
  if (pl) return pl;
  const base = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return base.length === 1 ? base : lower.length === 1 ? lower : c;
}

/** Lower case, Polish letters and accents folded, ONE unit per unit. */
export function faqFold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += foldUnit(text[i]);
  return out;
}

/** Endings dropped from a search word, longest first (folded spelling). */
const ENDINGS = [
  "ami", "ach", "owi", "ego", "emu", "ymi", "imi", "iej",
  "ow", "om", "ym", "im", "ej", "ie", "ia", "ii",
  "a", "e", "i", "o", "u", "y",
];

export function faqStem(word: string): string {
  const w = faqFold(word);
  if (w.length <= 3) return w;
  for (const end of ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 3) return w.slice(0, -end.length);
  }
  return w;
}

/** The words a visitor typed, as stems. Under two characters is no query. */
export function faqQueryStems(query: string): string[] {
  const words = faqFold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  const stems = [...new Set(words.map(faqStem).filter((s) => s.length >= 2))];
  return faqFold(query).replace(/[^\p{L}\p{N}]/gu, "").length >= 2 ? stems : [];
}

export type FaqRange = [start: number, end: number];

/** Where in `text` the stems match: whole words that start with a stem. */
export function faqMatchRanges(text: string, stems: readonly string[]): FaqRange[] {
  if (stems.length === 0) return [];
  const folded = faqFold(text);
  const out: FaqRange[] = [];
  for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = m[0];
    if (stems.some((s) => word.startsWith(s))) out.push([m.index ?? 0, (m.index ?? 0) + word.length]);
  }
  return out;
}

/** Does every stem match somewhere in these texts? */
export function faqMatches(texts: readonly string[], stems: readonly string[]): boolean {
  if (stems.length === 0) return true;
  const words = texts.flatMap((t) => faqFold(t).match(/[\p{L}\p{N}]+/gu) ?? []);
  return stems.every((s) => words.some((w) => w.startsWith(s)));
}

/** A string cut into plain and highlighted runs — React marks the second kind
 *  with <mark>; nothing is ever built as HTML. */
export function faqSplit(text: string, ranges: readonly FaqRange[]): { v: string; hit: boolean }[] {
  if (ranges.length === 0) return [{ v: text, hit: false }];
  const out: { v: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push({ v: text.slice(at, s), hit: false });
    out.push({ v: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ v: text.slice(at), hit: false });
  return out;
}

/* ── what a page receives ───────────────────────────────────────────────── */

/** One public question, already in the visitor's language. */
export type FaqPublicItem = {
  slug: string;
  category: string;
  q: string;
  a: FaqRich;
  /** The answer's words (structured data, search). */
  text: string;
};

export type FaqPublicCategory = { slug: string; name: string; topic: TicketTopic };

export type FaqPublicData = { categories: FaqPublicCategory[]; items: FaqPublicItem[] };

export const EMPTY_FAQ: FaqPublicData = { categories: [], items: [] };

/** FAQPage structured data for exactly the questions a page paints. */
export function faqJsonLd(items: readonly Pick<FaqPublicItem, "q" | "text">[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.text },
    })),
  };
}

/**
 * The old /plany anchors (#faq-credits …), from before the base existed:
 * links in e-mails and bookmarks still open the right question there.
 */
export const PLAN_FAQ_LEGACY: Readonly<Record<string, string>> = {
  credits: "jak-dzialaja-kredyty",
  renewal: "czy-subskrypcja-odnawia-sie-automatycznie",
  methods: "metody-platnosci",
  topups: "jak-kupic-dodatkowe-kredyty",
  refunds: "czy-istnieje-mozliwosc-zwrotu",
  howMany: "ile-obrazow-moge-wygenerowac",
  change: "czy-moge-zmienic-plan",
  premiere: "jak-dziala-cena-premierowa",
};
