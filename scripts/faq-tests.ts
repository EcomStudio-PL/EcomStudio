/**
 * FAQ V1 — WHAT THE SHARED FAQ BASE PROMISES.
 *
 *   A. the starting content (lib/faq-seed.ts): all 30 questions of the brief,
 *      once, in their categories, on /faq; the mapping onto the old /plany and
 *      O nas questions with no duplicate; every placeholder or unconfirmed
 *      claim hidden; 0155/0156 are exactly the generator's output;
 *   B. the text rule and the answer format: placeholders never public, links
 *      only to safe addresses, no HTML anywhere;
 *   C. the search: case and Polish letters folded, basic inflection (zwrot →
 *      zwrotu, faktura → fakturę), highlight ranges on the visitor's own text;
 *   D. the pages from faq_public() rows: per page, premiere, the language
 *      fallback, the categories;
 *   E. the HTML: /faq (one h1, search, pills, every question with its own
 *      address, no hidden item, one FAQPage of exactly the shown items),
 *      /plany's and O nas' accordions unchanged in look, Kontakt's links;
 *   F. the editor: the registry, the builder, every word in three languages.
 *
 *   npm run test:faq
 */
import { readFileSync } from "fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/lib/i18n/config";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { I18nProvider } from "@/lib/i18n/provider";
import { lookup, makeT } from "@/lib/i18n/t";
import type { CmsBlock } from "@/lib/cms";
import { fieldsFor } from "@/lib/cms-schema";
import { CMS_FIELDS, CMS_LINKS } from "@/lib/ice/registry";
import { blockFields } from "@/lib/server/ice/cms";
import { SEED_PAGES } from "@/lib/cms-seed";
import {
  FAQ_PAGES, FAQ_TEXT_KEYS, PLAN_FAQ_LEGACY, faqFold, faqHasPlaceholder, faqHiddenReasons, faqJsonLd, faqMatchRanges,
  faqMatches, faqPlainText, faqQueryStems, faqSafeHref, faqSlugify, faqSplit, faqStem, faqTextOk, parseFaqRich, FAQ_SLUG,
  type FaqPage,
} from "@/lib/faq";
import {
  FAQ_ABOUT_EXTRAS, FAQ_ABOUT_MAPPED, FAQ_CONTACT_LINKS, FAQ_PAGE_SEED, FAQ_SEED_CATEGORIES, FAQ_SEED_ITEMS,
} from "@/lib/faq-seed";
import { faqPagesFrom, faqTargetsOf, type FaqPages } from "@/lib/server/faq";
import { validateFaqCategory, validateFaqItem } from "@/lib/services/faq";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { PricingFaq } from "@/components/plan/pricing-faq";
import { AboutFaq } from "@/components/cms/about-faq";
import { IMPORT_BEGIN, IMPORT_END, importSql, pagesSql } from "./faq-seed-sql";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (title: string) => console.log(`\n${title}`);

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };
const LOCALES: Locale[] = ["pl", "en", "de"];
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

/* ── rows as faq_public() returns them, built from the seed ─────────────── */

const catOf = new Map(FAQ_SEED_CATEGORIES.map((c, i) => [c.slug, { ...c, position: (i + 1) * 10 }]));
const publicSeed = FAQ_SEED_ITEMS.filter((i) => i.visible && !i.needsReview && faqTextOk(i.question.pl) && faqTextOk(i.answer.pl ?? ""));
const ROWS = publicSeed.map((i, n) => ({
  slug: i.slug, category: i.category, category_name: catOf.get(i.category)!.name, category_position: catOf.get(i.category)!.position,
  category_topic: catOf.get(i.category)!.topic, position: n * 10, question: i.question, answer: i.answer,
  pages: i.pages as string[], only_premiere: Boolean(i.onlyPremiere),
}));

/* ── A ────────────────────────────────────────────────────────────────────── */
section("A. THE STARTING CONTENT");
const brief = FAQ_SEED_ITEMS.filter((i) => i.no !== null);
check("30 questions of the brief, numbers 1–30 once each", brief.length === 30
  && new Set(brief.map((i) => i.no)).size === 30 && brief.every((i) => i.no! >= 1 && i.no! <= 30));
check("every one of them is on /faq", brief.every((i) => i.pages.includes("faq")));
check("7 categories in the brief's order", FAQ_SEED_CATEGORIES.map((c) => c.slug).join() ===
  "pierwsze-kroki,kredyty-i-plany,platnosci-i-faktury,jakosc-i-wyniki,prawa-i-dane,konto-i-firma,nadchodzace-funkcje");
check("slugs: stable shape, unique", FAQ_SEED_ITEMS.every((i) => FAQ_SLUG.test(i.slug) && i.slug.length <= 80)
  && new Set(FAQ_SEED_ITEMS.map((i) => i.slug)).size === FAQ_SEED_ITEMS.length
  && new Set(FAQ_SEED_ITEMS.map((i) => i.key)).size === FAQ_SEED_ITEMS.length);
check("every item names a known category and only known pages",
  FAQ_SEED_ITEMS.every((i) => catOf.has(i.category) && i.pages.every((p) => (FAQ_PAGES as readonly string[]).includes(p))));
const extraPlany = FAQ_SEED_ITEMS.filter((i) => i.no === null);
check("the one old /plany question the brief lacks is kept: „Jak mogę kupić dodatkowe kredyty?”",
  extraPlany.length === 1 && extraPlany[0]!.key === "plany:topups" && extraPlany[0]!.question.pl === "Jak mogę kupić dodatkowe kredyty?");
const legacy = FAQ_SEED_ITEMS.flatMap((i) => i.legacy ?? []);
check("every old /plany question maps to exactly one record", ["credits", "renewal", "methods", "topups", "refunds", "howMany", "change", "premiere"]
  .every((k) => legacy.filter((l) => l === `plany:${k}`).length === 1));
check("…and the old /plany anchors point at those records", Object.entries(PLAN_FAQ_LEGACY)
  .every(([k, slug]) => FAQ_SEED_ITEMS.find((i) => i.slug === slug)?.legacy?.includes(`plany:${k}`)));
check("O nas: four questions mapped to the brief's, two kept as they read (models, how we differ)",
  FAQ_ABOUT_MAPPED.length === 4 && FAQ_ABOUT_EXTRAS.length === 2);
const placeholderVisible = FAQ_SEED_ITEMS.filter((i) => i.visible && (faqHasPlaceholder(i.answer.pl) || faqHasPlaceholder(i.question.pl)));
check("no visible item carries a placeholder", placeholderVisible.length === 0, placeholderVisible.map((i) => i.slug).join());
check("every unconfirmed claim waits hidden for a review, with a note", FAQ_SEED_ITEMS.filter((i) => i.needsReview)
  .every((i) => !i.visible && Boolean(i.note)));
check("the hidden ones: 08, 09, 10, 11, 15, 17, 22, 23, 24, 25, 26, 27, 29", FAQ_SEED_ITEMS.filter((i) => !i.visible)
  .map((i) => i.no).join() === "8,9,10,11,15,17,22,23,24,25,26,27,29");
check("a kept answer (checked text from /plany) carries the brief's own text as its draft — 07, 12, 13, 14, 16, 18",
  FAQ_SEED_ITEMS.filter((i) => i.draft).map((i) => i.no).join() === "7,12,13,14,16,18"
  && FAQ_SEED_ITEMS.filter((i) => i.draft).every((i) => i.visible && faqTextOk(i.answer.pl)));
check("a brief text that is complete is word for word the answer (e.g. 01, 06, 28)",
  FAQ_SEED_ITEMS.find((i) => i.no === 6)!.answer.pl!.startsWith("Każda generacja kosztuje określoną liczbę kredytów")
  && FAQ_SEED_ITEMS.find((i) => i.no === 28)!.answer.pl!.includes("Jakub, grafik e-commerce z ponad pięcioletnim doświadczeniem"));
check("every visible item has its English and German text", FAQ_SEED_ITEMS.filter((i) => i.visible)
  .every((i) => i.question.en && i.question.de && i.answer.en && i.answer.de));
const sql0155 = readFileSync("supabase/migrations/0155_faq_v1.sql", "utf8");
const block = sql0155.slice(sql0155.indexOf(IMPORT_BEGIN), sql0155.indexOf(IMPORT_END) + IMPORT_END.length);
check("0155's import block is the generator's output", block === importSql());
check("0156 is the generator's output", readFileSync("supabase/migrations/0156_faq_pages.sql", "utf8") === pagesSql());
check("the Kontakt links move to questions that exist", FAQ_CONTACT_LINKS.every((l) => FAQ_SEED_ITEMS.some((i) => `/faq#${i.slug}` === l.to)));
check("…four of them public on /faq; the VAT one waits for its question",
  FAQ_CONTACT_LINKS.filter((l) => publicSeed.some((i) => `/faq#${i.slug}` === l.to && i.pages.includes("faq"))).length === 4);

/* ── B ────────────────────────────────────────────────────────────────────── */
section("B. THE TEXT RULE AND THE FORMAT");
check("placeholders: [DO POTWIERDZENIA], [DO POTWIERDZENIA: …], [X], [Y], [data], [25], [nazwa firmy]",
  ["[DO POTWIERDZENIA]", "Tak. [DO POTWIERDZENIA: kiedy]", "[X] kredytów", "ok. [Y]", "do [data]", "[25] darmowych", "[nazwa firmy], [adres]"]
    .every((t) => faqHasPlaceholder(t) && !faqTextOk(t)));
check("…an unclosed bracket too; empty is never public", faqHasPlaceholder("tekst [bez końca") && !faqTextOk("") && !faqTextOk("   "));
check("a link in the answer format is not a placeholder", !faqHasPlaceholder("Napisz [do nas](/kontakt) lub [tu](https://grovbase.com)."));
const rich = parseFaqRich("Pierwszy **ważny** akapit z [linkiem](/kontakt).\n\nDrugi z [zewnętrznym](https://grovbase.com/x), [złym](javascript:alert(1)) i [mail](mailto:a@b.pl).");
check("paragraphs on a blank line", rich.length === 2);
check("bold and an internal link", rich[0]!.some((n) => n.t === "b" && n.v === "ważny") && rich[0]!.some((n) => n.t === "a" && n.href === "/kontakt"));
check("an unsafe link is its words only", rich[1]!.some((n) => n.t === "text" && n.v.includes("złym")) && !rich[1]!.some((n) => n.t === "a" && n.href.startsWith("javascript")));
check("https and mailto stay links", rich[1]!.some((n) => n.t === "a" && n.href === "https://grovbase.com/x") && rich[1]!.some((n) => n.t === "a" && n.href === "mailto:a@b.pl"));
check("safe addresses only", faqSafeHref("/kontakt?temat=problem") !== null && faqSafeHref("#metody-platnosci") !== null
  && faqSafeHref("//evil.com") === null && faqSafeHref("http://x.pl") === null && faqSafeHref("javascript:x") === null && faqSafeHref("data:text/html,x") === null);
check("plain text for structured data", faqPlainText(rich).startsWith("Pierwszy ważny akapit z linkiem."));
check("slugify folds Polish letters", faqSlugify("Czy otrzymam fakturę VAT?") === "czy-otrzymam-fakture-vat" && faqSlugify("Żółć łąka") === "zolc-laka");
check("validation: no markup, the Polish question required, a known page",
  !validateFaqItem({ category_id: "00000000-0000-4000-8000-000000000001", question: { pl: "<b>x</b>" }, answer: {}, pages: ["faq"], visible: true, needs_review: false, only_premiere: false }).ok
  && !validateFaqItem({ category_id: "00000000-0000-4000-8000-000000000001", question: { en: "x" }, answer: {}, pages: ["faq"], visible: true, needs_review: false, only_premiere: false }).ok
  && !validateFaqItem({ category_id: "00000000-0000-4000-8000-000000000001", question: { pl: "Pytanie?" }, answer: {}, pages: ["cennik"], visible: true, needs_review: false, only_premiere: false }).ok
  && validateFaqItem({ category_id: "00000000-0000-4000-8000-000000000001", question: { pl: "Pytanie?" }, answer: { pl: "Tak." }, pages: ["faq", "plany"], visible: true, needs_review: false, only_premiere: false }).ok
  && !validateFaqCategory({ name: { pl: "[nazwa]" }, visible: true, contact_topic: "other" }).ok
  && !validateFaqCategory({ name: { pl: "Nowa" }, visible: true, contact_topic: "sales" }).ok);
check("why an item is hidden, every reason at once", faqHiddenReasons(
  { visible: false, needs_review: true, pages: [], question: { pl: "Q?" }, answer: { pl: "[X]" }, only_premiere: true },
  { visible: false }, { premiere: false }).join() === "hidden,needs_review,category_hidden,no_pages,placeholder,premiere_only");

/* ── C ────────────────────────────────────────────────────────────────────── */
section("C. THE SEARCH");
const finds = (query: string, text: string) => faqMatches([text], faqQueryStems(query));
check("case and Polish letters do not matter", finds("PŁATNOŚCI", "Płatności i faktury") && finds("platnosci", "Płatności i faktury"));
check("zwrot finds zwrotu, zwrotu finds zwrot", finds("zwrot", "Prośba o zwrotu płatności") && finds("zwrotu", "Czy istnieje możliwość zwrotu?") && finds("zwrotu", "Zwrot pieniędzy"));
check("faktura finds fakturę, fakturę finds faktura, without diacritics too",
  finds("faktura", "Czy otrzymam fakturę VAT?") && finds("fakturę", "Faktura VAT") && finds("fakture", "Czy otrzymam fakturę VAT?"));
check("kredyty finds kredytów, zdjęcia finds zdjęcie", finds("kredyty", "ile kredytów") && finds("zdjęcia", "Jakie zdjęcie") && finds("zdjecia", "zdjęć"));
check("every word must be found (AND)", finds("faktura vat", "Czy otrzymam fakturę VAT?") && !finds("faktura telefon", "Czy otrzymam fakturę VAT?"));
check("no query below two letters", faqQueryStems("a").length === 0 && faqQueryStems("  ").length === 0);
check("folding keeps one character per character", faqFold("Żółć Łąka É").length === "Żółć Łąka É".length && faqFold("Żółć") === "zolc");
check("stems keep at least three letters", faqStem("ola") === "ola" && faqStem("faktury") === "faktur" && faqStem("zwrotu") === "zwrot");
const q = "Czy otrzymam fakturę VAT?";
const ranges = faqMatchRanges(q, faqQueryStems("faktura"));
check("the highlight covers the visitor's own word", ranges.length === 1 && q.slice(ranges[0]![0], ranges[0]![1]) === "fakturę");
const parts = faqSplit(q, ranges);
check("split into plain and marked runs, nothing lost", parts.map((p) => p.v).join("") === q && parts.filter((p) => p.hit).map((p) => p.v).join() === "fakturę");
const hlHtml = renderToStaticMarkup(createElement(I18nProvider, {
  locale: "pl", dict: DICTS.pl,
  children: createElement(PricingFaq, { items: [{ slug: "x", q: "<b>x</b>", a: parseFaqRich("<img src=x onerror=alert(1)>") }], open: "x", onOpen: () => undefined }) as ReactElement,
}));
check("text that looks like HTML is escaped, never markup", !hlHtml.includes("<img") && hlHtml.includes("&lt;img") && !hlHtml.includes("<b>x</b>"));

/* ── D ────────────────────────────────────────────────────────────────────── */
section("D. THE PAGES FROM faq_public()");
const off = faqPagesFrom(ROWS, "pl", false);
const on = faqPagesFrom(ROWS, "pl", true);
check("/faq: 17 questions outside the premiere, 18 during it (+ the two O nas ones the migration copies)", off.faq.items.length === 17 && on.faq.items.length === 18);
check("/plany: 7 outside the premiere, 8 during it", off.plany.items.length === 7 && on.plany.items.length === 8);
check("/o-nas: 4 (here: the brief's two; the live ones come from about_faq)", off["o-nas"].items.length === 2);
check("categories in order, an empty one left out (Prawa i dane: all three wait for content)",
  off.faq.categories.map((c) => c.slug).join() === FAQ_SEED_CATEGORIES.map((c) => c.slug).filter((c) => c !== "prawa-i-dane").join()
  && off.faq.categories.every((c) => off.faq.items.some((i) => i.category === c.slug)));
const enRows = ROWS.map((r) => (r.slug === "czym-jest-grovbase" ? { ...r, answer: { ...r.answer, en: "[to be confirmed]" } } : r));
const en1 = faqPagesFrom(enRows, "en", false);
check("a translation with a placeholder falls back to Polish", en1.faq.items.find((i) => i.slug === "czym-jest-grovbase")!.text.startsWith("GrovBase to aplikacja"));
check("…an ordinary one is used", en1.faq.items.find((i) => i.slug === "jakie-zdjecia-wgrywac")!.q === "What photos work best?");
check("a placeholder that slipped into a row is dropped here too",
  faqPagesFrom([...ROWS, { ...ROWS[0]!, slug: "x", answer: { pl: "[DO POTWIERDZENIA]" } }], "pl", false).faq.items.every((i) => i.slug !== "x"));
check("Kontakt's targets: /faq and /plany questions", faqTargetsOf(off).faq.has("jak-dzialaja-kredyty") && faqTargetsOf(off).plany.has("metody-platnosci")
  && !faqTargetsOf(off).faq.has("czy-otrzymam-fakture-vat"));
check("structured data: exactly the items given", (faqJsonLd(off.faq.items)!.mainEntity as unknown[]).length === 17 && faqJsonLd([]) === null);

/* ── E ────────────────────────────────────────────────────────────────────── */
section("E. THE HTML");
type Ctx = Parameters<typeof renderContext>[0];
const render = (locale: Locale, blocks: CmsBlock[], extra: Partial<Ctx> = {}) =>
  renderToStaticMarkup(createElement(I18nProvider, {
    locale, dict: DICTS[locale],
    children: createElement(BlockRenderer, { blocks, ctx: renderContext({ locale, t: makeT(DICTS[locale]), ...extra }) }) as ReactElement,
  }));
const FAQ_BLOCK: CmsBlock = {
  id: "00000000-0000-4000-8000-0000000000f1", type: "faq_page", sort_order: 0, visible: true,
  content: structuredClone(FAQ_PAGE_SEED.content) as CmsBlock["content"], style: {}, anchor: null, analytics_id: "faq.page",
};
const faqHtml = render("pl", [FAQ_BLOCK], { faq: off });
check("/faq: one h1 — Najczęstsze pytania, the label POMOC", count(faqHtml, /<h1[\s>]/g) === 1 && faqHtml.includes("Najczęstsze pytania") && faqHtml.includes(">POMOC<"));
check("…the line with its link to /kontakt", /Nie znalazłeś odpowiedzi\? <a href="\/kontakt"[^>]*>Napisz do nas<\/a> – odpowiadamy w ciągu 1 dnia roboczego\./.test(faqHtml));
check("…a search field with the placeholder", /type="search"[^>]*placeholder="Szukaj w pytaniach…"/.test(faqHtml));
check("…a pill per category", count(faqHtml, /data-faq-pill=/g) === off.faq.categories.length);
check("…every question with its own address", off.faq.items.every((i) => faqHtml.includes(`id="${i.slug}"`)));
check("…the questions as buttons with aria-expanded and aria-controls", count(faqHtml, /aria-expanded="false" aria-controls=/g) === off.faq.items.length);
const hidden = FAQ_SEED_ITEMS.filter((i) => !i.visible || i.needsReview);
check("…no hidden question in the HTML, no placeholder", hidden.every((i) => !faqHtml.includes(i.slug) && !faqHtml.includes(i.question.pl))
  && !/\[(DO POTWIERDZENIA|X|Y|25|data|nazwa firmy)/.test(faqHtml));
const ldMatch = /<script type="application\/ld\+json" data-faq-ld="[^"]*">(.*?)<\/script>/.exec(faqHtml);
const ld = ldMatch ? JSON.parse(ldMatch[1]!) as { mainEntity: { name: string }[] } : null;
check("…one FAQPage, exactly the shown questions", count(faqHtml, /"@type":"FAQPage"/g) === 1 && ld?.mainEntity.length === off.faq.items.length);
check("…the closing tile: Napisz do nas → /kontakt; no Instagram or Messenger without a configured address",
  /<a href="\/kontakt" data-faq-end-contact[^>]*>Napisz do nas/.test(faqHtml) && !faqHtml.includes("data-faq-end-channel"));
const withChannels = render("pl", [FAQ_BLOCK], { faq: off, faqChannels: { instagram: "https://instagram.com/grovbase", messenger: "https://m.me/grovbase" } });
check("…and both, with noopener, when Kontakt has them", count(withChannels, /data-faq-end-channel/g) === 2 && /rel="noopener noreferrer"/.test(withChannels));
check("…'Czy to pomogło?' under every answer", count(faqHtml, /data-faq-vote="true"/g) === off.faq.items.length);
const enHtml = render("en", [FAQ_BLOCK], { faq: faqPagesFrom(ROWS, "en", false) });
check("English: its own words", enHtml.includes("Frequently asked questions") && enHtml.includes("What photos work best?"));

// /plany's and O nas' accordions: the classes of the look before FAQ V1.
const OLD_PLAN_BUTTON = "flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold text-ink transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent))] sm:px-6";
const OLD_PLAN_PANEL = "px-5 pb-5 text-[14.5px] leading-relaxed text-muted sm:px-6";
const OLD_PLAN_LIST = "mt-4 divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface";
const planHtml = renderToStaticMarkup(createElement(I18nProvider, {
  locale: "pl", dict: DICTS.pl,
  children: createElement(PricingFaq, { items: on.plany.items, open: on.plany.items[0]!.slug, onOpen: () => undefined }) as ReactElement,
}));
check("/plany: the same list, buttons and answer typography as before", planHtml.includes(`class="${OLD_PLAN_LIST}"`)
  && planHtml.split(`class="${OLD_PLAN_BUTTON}"`).length - 1 === on.plany.items.length
  && planHtml.includes(`class="space-y-3 ${OLD_PLAN_PANEL}"`) && !/<p class=/.test(planHtml.split("data-faq=")[1] ?? ""));
check("…its eight questions during the premiere, the old #faq-<key> anchors kept by slug", count(planHtml, /data-faq="/g) === 8
  && on.plany.items.every((i) => planHtml.includes(`id="faq-${i.slug}"`)));
const OLD_ABOUT_P = "px-5 pb-6 text-[14.5px] leading-relaxed text-muted sm:px-7";
const aboutHtml = renderToStaticMarkup(createElement(AboutFaq, { items: off["o-nas"].items.map((x) => ({ slug: x.slug, q: x.q, a: x.a })) }));
check("O nas: the same list and answer typography as before", aboutHtml.includes('class="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface"')
  && aboutHtml.includes(`class="space-y-3 ${OLD_ABOUT_P}"`));
const aboutBlock: CmsBlock = {
  id: "00000000-0000-4000-8000-0000000000a8", type: "about_faq", sort_order: 7, visible: true,
  content: { title: { pl: "Masz pytania?" }, items: [{ title: { pl: "Stare pytanie z bloku" }, description: { pl: "Stara odpowiedź." } }] },
  style: {}, anchor: "faq", analytics_id: "about.faq",
};
const aboutPage = render("pl", [aboutBlock], { faq: off });
check("about_faq reads the base, never its own old list", aboutPage.includes("Czym jest GrovBase?") && !aboutPage.includes("Stare pytanie z bloku")
  && count(aboutPage, /"@type":"FAQPage"/g) === 1);
check("about_faq without base questions draws nothing", render("pl", [aboutBlock], {}) === "");

const KONTAKT = SEED_PAGES.find((p) => p.slug === "kontakt")!;
const contactBlock: CmsBlock = {
  id: "00000000-0000-4000-8000-0000000000c1", type: "contact_page", sort_order: 0, visible: true,
  content: (() => {
    const c = structuredClone(KONTAKT.sections[0]!.content);
    c.tiles = (c.tiles ?? []).map((t) => {
      const link = FAQ_CONTACT_LINKS.find((l) => l.from === t.url || (!l.from && !t.url && t.title?.pl === l.title));
      return link ? { ...t, url: link.to } : t;
    });
    return c;
  })(),
  style: {}, anchor: null, analytics_id: null,
};
const contactHtml = render("pl", [contactBlock], { faq: off, site: { faq: faqTargetsOf(off) } });
const faqLinks = [...contactHtml.matchAll(/data-contact-faq="([^"]+)"/g)].map((m) => m[1]);
check("Kontakt: four links to /faq#slug, each a public question", faqLinks.length === 4
  && faqLinks.every((h) => /^\/faq#/.test(h!) && off.faq.items.some((i) => `/faq#${i.slug}` === h)));
check("…the VAT link stays off until its question is published", !contactHtml.includes("czy-otrzymam-fakture-vat"));

/* ── F ────────────────────────────────────────────────────────────────────── */
section("F. THE EDITOR AND THE WORDS");
const faqFields = blockFields(FAQ_BLOCK, null);
check("Edytuj stronę: every word of /faq is editable", FAQ_TEXT_KEYS.every((k) => faqFields.some((f) => f.kind === "text" && f.path.join(".") === `fields.${k}`))
  && ["badge", "title", "subtitle", "ctaLabel", "description", "cta2Label"].every((k) => faqFields.some((f) => f.kind === "text" && f.path[0] === k)));
check("…and both of its addresses", faqFields.filter((f) => f.kind === "link").map((f) => f.path[0]).join() === "ctaUrl,cta2Url"
  && (CMS_LINKS.faq_page ?? []).every((l) => l.format === "page"));
check("about_faq: only its heading is a field — the questions are the base's", CMS_FIELDS.about_faq!.text.join() === "badge,title");
const builder = fieldsFor("faq_page");
check("the builder has every /faq word", FAQ_TEXT_KEYS.every((k) => builder.some((d) => d.key === k)));
const words: string[] = [
  ...FAQ_TEXT_KEYS.map((k) => `cms.faq.text.${k}`),
  "cms.faq.text.title", "cms.faq.text.endCta", "cms.faq.searchLabel", "cms.faq.clear", "cms.faq.results", "cms.faq.resultsNone",
  "cms.faq.voteError", "cms.faq.copyFailed", "cms.faq.instagram", "cms.faq.messenger", "cms.sectionType.faq_page", "cms.nav.faq",
  "cms.faqAdminTitle", "cms.faqAdminSub", "cms.faqAdminUnavailable", "ice.bar.faq", "ice.block.faq_page", "ice.contact.linkHint.page",
  ...builder.flatMap((d) => [d.label, d.hint].filter((x): x is string => Boolean(x)).map((k) => `cms.label.${k}`)),
  ...faqFields.map((f) => `ice.faqField.${(f.path[0] === "fields" ? f.path[1]! : f.path[0]!).replace(/\./g, "_")}`),
];
// Every literal key the editor component asks for, and its template families.
const managerSrc = readFileSync("components/admin/faq/faq-manager.tsx", "utf8") + readFileSync("components/ice/editor/faq-panel.tsx", "utf8");
for (const m of managerSrc.matchAll(/t\("(ice\.faq\.[A-Za-z0-9_.]+)"/g)) words.push(m[1]!);
for (const r of ["hidden", "needs_review", "category_hidden", "no_pages", "empty_question", "empty_answer", "placeholder", "premiere_only"]) words.push(`ice.faq.reason.${r}`);
for (const a of ["save", "restore", "clear", "bulk", "external"]) words.push(`ice.faq.action.${a}`);
for (const f of ["all", "faq", "plany", "o_nas", "hidden", "needs"]) words.push(`ice.faq.filter_${f}`);
for (const p of FAQ_PAGES) words.push(`ice.faq.page_${p.replace("-", "_")}`);
for (const e of ["invalid", "conflict", "not_found", "slug_taken", "category", "category_not_empty", "stale", "category_missing", "not_restorable", "not_admin", "generic"]) words.push(`ice.faq.err.${e}`);
for (const e of ["question", "answer", "draft", "slug", "category", "pages", "note", "name", "topic", "id"]) words.push(`ice.faq.err.field.${e}`);
const missing = LOCALES.flatMap((l) => [...new Set(words)].filter((k) => typeof lookup(DICTS[l], k) !== "string").map((k) => `${l}:${k}`));
check(`every word in three languages (${new Set(words).size} keys)`, missing.length === 0, missing.slice(0, 8).join(", "));
check("the old /plany answers are gone from the dictionaries (one source)", LOCALES.every((l) => typeof lookup(DICTS[l], "pricing.faq.credits.a") !== "string"
  && typeof lookup(DICTS[l], "pricing.faq.overline") === "string"));

void (null as unknown as FaqPages);
void (null as unknown as FaqPage);
console.log(failures === 0 ? "\nAll FAQ checks passed." : `\n${failures} FAQ check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
