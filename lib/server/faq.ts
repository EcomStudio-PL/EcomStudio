import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { premiereState } from "@/lib/server/pricing-offer";
import { isTicketTopic, type FaqTargets, type TicketTopic } from "@/lib/contact-page";
import {
  EMPTY_FAQ, FAQ_PAGES, faqPlainText, faqTextOk, isFaqPage, parseFaqRich,
  type FaqPage, type FaqPublicData, type FaqPublicItem, type FaqText,
} from "@/lib/faq";

/**
 * READING THE FAQ BASE FOR A PAGE (FAQ V1).
 *
 * One cached read of faq_public() (0155) — the database has already dropped
 * every hidden, unreviewed, empty or placeholder question — and then, per
 * page and language, what that page shows: its own questions, in the
 * visitor's language where that translation may be shown too (else Polish),
 * the premiere-only ones only while the premiere runs, and the categories
 * that still have a question after all that.
 *
 * The cached client is ANONYMOUS, as for the CMS pages: the answer is the same
 * for everybody and nothing user-scoped may end up in a shared cache entry.
 * An admin's save clears FAQ_TAG, so the change is live at once.
 */

export const FAQ_TAG = "faq-base";

type Row = {
  slug: string;
  category: string;
  category_name: FaqText | null;
  category_position: number;
  category_topic: string;
  position: number;
  question: FaqText | null;
  answer: FaqText | null;
  pages: string[] | null;
  only_premiere: boolean;
  /** The tools the question is assigned to (0158). Absent before that file. */
  tools?: string[] | null;
};

const readRows = unstable_cache(
  async (): Promise<Row[]> => {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anon.rpc("faq_public");
    // Thrown, not returned: a failed read must not be cached as "no questions".
    if (error) throw new Error(`faq_public: ${error.code ?? error.message}`);
    return (data ?? []) as Row[];
  },
  ["faq-public-v1"],
  { revalidate: 300, tags: [FAQ_TAG] },
);

/** A translation that may be shown, else the Polish text (always shown-safe
 *  by the time it gets here), else nothing. */
function pick(text: FaqText | null, locale: string): string {
  const own = text?.[locale as keyof FaqText];
  if (faqTextOk(own)) return own!.trim();
  return faqTextOk(text?.pl) ? text!.pl!.trim() : "";
}

export type FaqPages = Record<FaqPage, FaqPublicData>;

const emptyPages = (): FaqPages => ({ faq: EMPTY_FAQ, plany: EMPTY_FAQ, "o-nas": EMPTY_FAQ });

/** The rows of faq_public(), resolved for every page in one pass. Pure — the
 *  tests drive it with rows of their own. */
export function faqPagesFrom(rows: readonly Row[], locale: string, premiere: boolean): FaqPages {
  const out = emptyPages();
  for (const page of FAQ_PAGES) {
    const items: FaqPublicItem[] = [];
    const cats = new Map<string, { slug: string; name: string; topic: TicketTopic; position: number }>();
    for (const r of rows) {
      if (!(r.pages ?? []).some((p) => isFaqPage(p) && p === page)) continue;
      if (r.only_premiere && !premiere) continue;
      const q = pick(r.question, locale);
      const answer = pick(r.answer, locale);
      const a = answer ? parseFaqRich(answer) : [];
      if (!q || a.length === 0) continue;
      items.push({ slug: r.slug, category: r.category, q, a, text: faqPlainText(a) });
      if (!cats.has(r.category)) {
        cats.set(r.category, {
          slug: r.category,
          name: pick(r.category_name, locale),
          topic: isTicketTopic(r.category_topic) ? r.category_topic : "other",
          position: r.category_position,
        });
      }
    }
    const categories = [...cats.values()].sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
      .map(({ slug, name, topic }) => ({ slug, name, topic }));
    // The rows come ordered by category, then position: keep that order, with
    // each item under its category's place.
    const order = new Map(categories.map((c, i) => [c.slug, i]));
    items.sort((a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0));
    out[page] = { categories, items };
  }
  return out;
}

/**
 * Every page's questions, for this request's language. A database that does
 * not have the base yet (or does not answer) gives empty pages — never an
 * error page; the FAQ sections then simply are not drawn.
 */
export async function getFaqPages(locale: string, now: number = Date.now()): Promise<FaqPages> {
  try {
    const rows = await readRows();
    return faqPagesFrom(rows, locale, premiereState(now).status === "active");
  } catch (e) {
    console.warn("faq: base unavailable, pages render without it", e instanceof Error ? e.message : e);
    return emptyPages();
  }
}

export async function getFaq(page: FaqPage, locale: string): Promise<FaqPublicData> {
  return (await getFaqPages(locale))[page];
}

/** How many questions a tool's page shows (Public Tools V1: "trzy krótkie"). */
export const TOOL_FAQ_LIMIT = 3;

/**
 * The questions assigned to one tool, in the base's own order, at most
 * TOOL_FAQ_LIMIT — the same visibility rules as every page (faq_public() has
 * already dropped what is hidden, unreviewed, empty or a placeholder; here the
 * premiere-only rule and the translation fallback). Pure, for the tests.
 */
export function faqToolItems(rows: readonly Row[], tool: string, locale: string, premiere: boolean): FaqPublicItem[] {
  const out: FaqPublicItem[] = [];
  for (const r of rows) {
    if (!(r.tools ?? []).includes(tool)) continue;
    if (r.only_premiere && !premiere) continue;
    const q = pick(r.question, locale);
    const answer = pick(r.answer, locale);
    const a = answer ? parseFaqRich(answer) : [];
    if (!q || a.length === 0) continue;
    out.push({ slug: r.slug, category: r.category, q, a, text: faqPlainText(a) });
    if (out.length >= TOOL_FAQ_LIMIT) break;
  }
  return out;
}

/** A tool page's questions; none (never an error) when the base cannot be read. */
export async function getToolFaq(tool: string, locale: string, now: number = Date.now()): Promise<FaqPublicItem[]> {
  try {
    return faqToolItems(await readRows(), tool, locale, premiereState(now).status === "active");
  } catch {
    return [];
  }
}

/** The questions a Kontakt FAQ link may point at (lib/contact-page.ts). */
export function faqTargetsOf(pages: FaqPages): FaqTargets {
  return {
    faq: new Set(pages.faq.items.map((i) => i.slug)),
    plany: new Set(pages.plany.items.map((i) => i.slug)),
  };
}
