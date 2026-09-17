import type { CmsBlockContent, SectionStyle } from "./cms";

/**
 * THE STARTING LAYOUTS.
 *
 * A landing page is ninety per cent decisions about ORDER — what the visitor
 * reads first, what answers the objection, where the offer goes, what closes.
 * Those decisions are the same every time, and re-making them by adding
 * fourteen sections one at a time is the slow part of building a page. A
 * template is that skeleton: the right sections, in the right order, with the
 * anchors and the spacing already set.
 *
 * WHAT A TEMPLATE DOES NOT DO IS WRITE THE COPY. Every section arrives empty.
 * Filling a new page with "Lorem ipsum" or invented marketing lines would put
 * words GrovBase never said one accidental Publish away from being live, and
 * the editor already names each empty section by what it is. The structure is
 * the part worth having ready; the sentences are the part only you can write.
 *
 * Templates are DATA, not code paths. Applying one is an insert of these rows
 * into `cms_blocks` — after that the page is an ordinary page and nothing
 * remembers it came from here except the `template` column, which is there so
 * the page list can say "Promocja" instead of "strona".
 */

export type TemplateSection = {
  type: string;
  /** #anchor, so the CTA link picker has somewhere to point from day one. */
  anchor?: string;
  /** Only where the shape matters — a promo bar with no background is not a
   *  promo bar. Everything else inherits the site's own spacing. */
  style?: SectionStyle;
  content?: CmsBlockContent;
  /** Sections a template includes but leaves switched off, because they are
   *  the optional half of the pattern: a sticky CTA is right for some
   *  campaigns and noise in others. */
  hidden?: boolean;
};

export type PageTemplate = {
  key: string;
  /** i18n key under `cms.template.` */
  label: string;
  /** One line under the name in the picker; `cms.templateHint.<key>`. */
  hint: string;
  sections: TemplateSection[];
};

const accent = (): SectionStyle => ({ base: { background: "gradient", align: "center" } });
const soft = (): SectionStyle => ({ base: { background: "soft" } });
const centre = (): SectionStyle => ({ base: { align: "center" } });

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    key: "blank",
    label: "blank",
    hint: "blank",
    sections: [],
  },
  {
    /* The ordinary sales page: promise, proof, price, objection, close. */
    key: "landing",
    label: "landing",
    hint: "landing",
    sections: [
      { type: "hero", anchor: "start" },
      { type: "benefits", anchor: "korzysci" },
      { type: "features", anchor: "mozliwosci" },
      { type: "before_after", anchor: "efekty" },
      { type: "testimonials", anchor: "opinie", style: soft() },
      { type: "pricing_table", anchor: "cennik" },
      { type: "faq", anchor: "faq" },
      { type: "cta", anchor: "start-teraz", style: accent() },
    ],
  },
  {
    /* The campaign page. This is the one the brief is built around: an offer
     * that opens, runs against a clock and closes. */
    key: "promo",
    label: "promo",
    hint: "promo",
    sections: [
      { type: "promo_bar", style: accent() },
      { type: "hero", anchor: "start" },
      { type: "offer", anchor: "oferta", style: soft() },
      { type: "countdown", anchor: "termin", style: centre() },
      { type: "bonus", anchor: "bonus" },
      { type: "benefits", anchor: "korzysci" },
      { type: "workflow", anchor: "jak-to-dziala" },
      { type: "testimonials", anchor: "opinie", style: soft() },
      { type: "guarantee", anchor: "gwarancja" },
      { type: "faq", anchor: "faq" },
      { type: "urgency_cta", anchor: "odbierz", style: accent() },
      { type: "sticky_cta", hidden: true },
    ],
  },
  {
    /* One tool, shown working. The proof is the picture, not the paragraph. */
    key: "tool",
    label: "tool",
    hint: "tool",
    sections: [
      { type: "hero", anchor: "start" },
      { type: "before_after", anchor: "efekty" },
      { type: "features", anchor: "mozliwosci" },
      { type: "workflow", anchor: "jak-to-dziala" },
      { type: "gallery", anchor: "galeria" },
      { type: "faq", anchor: "faq" },
      { type: "cta", anchor: "start-teraz", style: accent() },
    ],
  },
  {
    /* An address in exchange for something. Short, and the form is above the
     * fold's second screen rather than at the bottom. */
    key: "lead",
    label: "lead",
    hint: "lead",
    sections: [
      { type: "hero", anchor: "start" },
      { type: "benefits", anchor: "korzysci" },
      { type: "contact_form", anchor: "formularz", style: soft() },
      { type: "trust_badges" },
      { type: "testimonials", anchor: "opinie" },
      { type: "faq", anchor: "faq" },
    ],
  },
  {
    key: "coming_soon",
    label: "coming_soon",
    hint: "coming_soon",
    sections: [
      { type: "hero", anchor: "start", style: centre() },
      { type: "countdown", anchor: "termin", style: centre() },
      { type: "newsletter", anchor: "zapis", style: soft() },
      { type: "benefits", anchor: "korzysci" },
    ],
  },
  {
    /* A single offer, defended. Fewer sections than the promo page: this is
     * the one you send to people who already know the product. */
    key: "special_offer",
    label: "special_offer",
    hint: "special_offer",
    sections: [
      { type: "hero", anchor: "start" },
      { type: "offer", anchor: "oferta", style: soft() },
      { type: "guarantee", anchor: "gwarancja" },
      { type: "testimonials", anchor: "opinie" },
      { type: "urgency_cta", anchor: "odbierz", style: accent() },
    ],
  },
  {
    key: "product_launch",
    label: "product_launch",
    hint: "product_launch",
    sections: [
      { type: "hero", anchor: "start" },
      { type: "video", anchor: "wideo" },
      { type: "features", anchor: "mozliwosci" },
      { type: "workflow", anchor: "jak-to-dziala" },
      { type: "showcase", anchor: "galeria" },
      { type: "testimonials", anchor: "opinie", style: soft() },
      { type: "faq", anchor: "faq" },
      { type: "cta", anchor: "start-teraz", style: accent() },
    ],
  },
];

export const TEMPLATE_KEYS = PAGE_TEMPLATES.map((t) => t.key);

export function templateByKey(key: string | null | undefined): PageTemplate | null {
  if (!key) return null;
  return PAGE_TEMPLATES.find((t) => t.key === key) ?? null;
}

/**
 * The rows a template turns into. Kept here rather than in the action so the
 * test can check the shape without a database: every section a template names
 * must be a real block type, and the order it returns is the order the page
 * is built in.
 */
export function templateBlocks(key: string): {
  type: string; sort_order: number; visible: boolean;
  content: CmsBlockContent; style: SectionStyle; anchor: string | null;
}[] {
  const template = templateByKey(key);
  if (!template) return [];
  return template.sections.map((s, i) => ({
    type: s.type,
    sort_order: i,
    visible: !s.hidden,
    content: s.content ?? {},
    style: s.style ?? {},
    anchor: s.anchor ?? null,
  }));
}
