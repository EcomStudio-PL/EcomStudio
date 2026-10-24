/**
 * O NAS V2 — the about page, checked offline.
 *
 *   A. the nine section types are wired everywhere a type has to be (the list
 *      the database round-trips, the picker, the builder, the inline editor,
 *      the names in three languages, the ten picture slots);
 *   B. they render what the brief asks for from the seed: one <h1>, the
 *      sections in order, 3 + 2 principles, an accessible FAQ whose JSON-LD
 *      holds exactly the questions on the page, neutral canvases for empty
 *      pictures and the pictures themselves once a slot is filled;
 *   C. WHAT A VISITOR NEVER RECEIVES: a switched-off tile, question, card,
 *      point or section, and any text holding a "[…]" placeholder, is absent
 *      from the HTML (and therefore from the RSC payload and the JSON-LD) in
 *      every language — switched on or not;
 *   D. "Wypróbuj / Zacznij za darmo" follows the platform's state (sign-up,
 *      waitlist, home, the app) and never a sign-up that is switched off;
 *   E. the seed keeps the brief's copy and its honesty rules, and migration
 *      0151 is exactly what the generator prints from it.
 *
 *   npm run test:aboutpage
 */
import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/lib/i18n/config";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { I18nProvider } from "@/lib/i18n/provider";
import { lookup, makeT } from "@/lib/i18n/t";
import { BLOCK_TYPES, SECTION_GROUPS, SECTION_TYPES, lt, type CmsBlock, type CmsItem } from "@/lib/cms";
import { fieldsFor, splitFields } from "@/lib/cms-schema";
import { CMS_FIELDS } from "@/lib/ice/registry";
import { stegaMark, hasInvisible } from "@/lib/ice/stega";
import { markBlocks } from "@/lib/server/ice/cms";
import { SEED_PAGES } from "@/lib/cms-seed";
import {
  ABOUT_BLOCK_SLOTS, ABOUT_SLOT, ABOUT_SLOTS, ABOUT_TYPES, hasPlaceholder, publicText, shownItems, startCta, type StartCta,
} from "@/lib/about-page";
import { MEDIA_SLOTS } from "@/lib/media-slots";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (title: string) => console.log(`\n${title}`);

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };
const LOCALES: Locale[] = ["pl", "en", "de"];

const ABOUT = SEED_PAGES.find((p) => p.slug === "o-nas")!;
const id = (i: number) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const seedBlocks = (): CmsBlock[] => ABOUT.sections.map((s, i) => ({
  id: id(i), type: s.type, sort_order: i, visible: true,
  content: structuredClone(s.content), style: s.style, anchor: s.anchor ?? null, analytics_id: s.analyticsId ?? null,
}));
const REGISTER: StartCta = { kind: "register", href: null };

const render = (locale: Locale, blocks: CmsBlock[], opts: { slots?: SlotMap; start?: StartCta } = {}) =>
  renderToStaticMarkup(createElement(I18nProvider, {
    locale, dict: DICTS[locale],
    children: createElement(BlockRenderer, {
      blocks,
      ctx: renderContext({ locale, t: makeT(DICTS[locale]), slots: opts.slots, start: opts.start ?? REGISTER }),
    }) as ReactElement,
  }));

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const between = (html: string, from: string, to: string | null) => {
  const a = html.indexOf(from);
  const b = to ? html.indexOf(to, a + 1) : html.length;
  return a < 0 ? "" : html.slice(a, b < 0 ? html.length : b);
};
const ldOf = (html: string) => {
  const m = /<script type="application\/ld\+json" data-about-ld="[^"]*">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]!) as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] } : null;
};
const slot = (key: string, extra: Partial<ResolvedSlot> = {}): ResolvedSlot => ({
  key, mediaType: "image", alt: "", fit: "cover", position: "center center", autoplay: true, muted: true, loop: true, controls: false,
  desktop: `https://cdn.example/${key}.jpg`, desktopWidth: 2000, desktopHeight: 1000, ...extra,
});

/* ── A ────────────────────────────────────────────────────────────────────── */

section("A. NINE SECTION TYPES, WIRED EVERYWHERE A TYPE MUST BE");
for (const type of ABOUT_TYPES) {
  check(`${type}: in BLOCK_TYPES, offered in the picker (group "about"), with builder fields and inline fields`,
    (BLOCK_TYPES as readonly string[]).includes(type) && SECTION_TYPES.includes(type)
    && Boolean(SECTION_GROUPS.find((g) => g.key === "about")?.types.includes(type))
    && fieldsFor(type).length >= 3 && Boolean(CMS_FIELDS[type]));
  for (const l of LOCALES) {
    check(`${type}: named in ${l} (builder and editor)`,
      Boolean(lookup(DICTS[l], `cms.sectionType.${type}`)) && Boolean(lookup(DICTS[l], `ice.block.${type}`)));
  }
}
for (const l of LOCALES) {
  const missing = ABOUT_TYPES.flatMap((type) => fieldsFor(type).flatMap((f) => [f.label, f.hint].filter(Boolean) as string[]))
    .filter((k) => !lookup(DICTS[l], `cms.label.${k}`));
  const keys = ["cms.label.itemVisible", "cms.label.itemPlaceholder", "cms.label.itemSlot", "cms.label.aboutPoints", "cms.label.aboutAddPoint",
    "cms.label.aboutPoint", "cms.label.aboutVideoOk", "cms.label.aboutPicturesOpen", "cms.sectionGroup.about", "media.section.about",
    "ice.bar.visibility", "ice.vis.title", "ice.vis.intro", "ice.vis.sectionOff", "ice.vis.editText", "ice.vis.placeholder",
    "ice.vis.versionNote", "ice.vis.hiddenNow", "ice.vis.shownNow", "ice.vis.hidden", "ice.vis.shown", "ice.field.point"]
    .filter((k) => !lookup(DICTS[l], k));
  check(`${l}: every builder label, hint and editor string of the about page is written`, missing.length + keys.length === 0, [...missing, ...keys].join(", "));
  const slotKeys = ABOUT_SLOTS.flatMap((s) => [`media.slot.${s.label}`, `media.fb.${s.fallback}`, `ice.role.${s.label}`])
    .filter((k) => !lookup(DICTS[l], k));
  check(`${l}: every picture slot is named (Admin → Media, the editor) with its fallback`, slotKeys.length === 0, slotKeys.join(", "));
}
check("ten slots, the brief's keys, entity section/about, each with its own name",
  ABOUT_SLOTS.length === 10 && Object.values(ABOUT_SLOT).every((k) => MEDIA_SLOTS.some((m) => m.key === k && m.entityType === "section" && m.entityId === "about"))
  && new Set(ABOUT_SLOTS.map((s) => s.label)).size === 10);
check("the slots' shapes: hero 21:9 (clip + phone file), story 4:3, collage 4:5 + 1:1 + 1:1, cards 16:10, people 1:1, share 1200×630",
  ["about.hero.visual=21/9", "about.story.visual=4/3", "about.importance.main=4/5", "about.importance.secondary1=1/1",
    "about.importance.secondary2=1/1", "about.audience.small=16/10", "about.audience.large=16/10", "about.team.jakub=1/1",
    "about.team.marcel=1/1", "about.seo.og=1200/630"].every((x) => { const [k, r] = x.split("="); return ABOUT_SLOTS.find((s) => s.key === k)?.ratio === r; })
  && ABOUT_SLOTS.filter((s) => s.video).map((s) => s.key).join() === "about.hero.visual");
check("builder: about lists have a switch per row and no per-row link or picture; the audience cards have points",
  ABOUT_TYPES.filter((t) => fieldsFor(t).some((f) => f.kind === "items")).every((t) => {
    const items = fieldsFor(t).find((f) => f.kind === "items")!;
    return items.items?.hideable === true && items.items.plain === true && (items.items.points === true) === (t === "about_audience");
  }));
check("builder: the picture rows list exactly each section's block slots, and are in the quick fields",
  (["about_hero", "about_story", "about_importance"] as const).every((t) => {
    const row = fieldsFor(t).find((f) => f.kind === "slots");
    return row && JSON.stringify(row.slots) === JSON.stringify(ABOUT_BLOCK_SLOTS[t]) && splitFields(t, fieldsFor(t)).quick.includes(row);
  }));

/* ── B ────────────────────────────────────────────────────────────────────── */

section("B. THE PAGE AS THE SEED PAINTS IT");
const html = render("pl", seedBlocks());
const ORDER = ["hero", "story", "process", "importance", "values", "audience", "team", "faq", "cta"];
const positions = ORDER.map((k) => html.indexOf(`data-about="${k}"`));
check("nine sections, in the brief's order", positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1]!)), positions.join(","));
check("exactly one <h1>, the hero's headline",
  count(html, /<h1[\s>]/g) === 1 && /<h1[^>]*>Dobre zdjęcie produktu nie powinno kosztować więcej niż marża na produkcie<\/h1>/.test(html));
check("every other section heading is an <h2>, in order",
  ["Skąd się wzięliśmy", "Projektuje grafik, wykonuje AI", "Dlaczego zdjęcie ma znaczenie", "W co wierzymy", "Dla każdego, kto sprzedaje online",
    "Kto za tym stoi", "Masz pytania?", "Sprzedawaj od pierwszego spojrzenia"].every((h) => new RegExp(`<h2[^>]*>${h.replace(/[?.*+()[\]]/g, "\\$&")}</h2>`).test(html)));
check("the first screen (headline, picture) is painted at once — no entrance fade holding the largest paint",
  !/opacity-0/.test(between(html, 'data-about="hero"', 'data-about="story"')) && /opacity-0/.test(between(html, 'data-about="story"', 'data-about="process"')));
check("the story is two paragraphs and the visual comes first on a phone (order on lg only)",
  count(between(html, 'data-about="story"', 'data-about="process"'), /<p class="text-\[15\.5px\]/g) === 2
  && /data-about="story"[^>]*>\s*<div[^>]*class="[^"]*lg:order-2/.test(html));
const proc = between(html, 'data-about="process"', 'data-about="importance"');
check("process: an ordered list of three steps 01–03, an arrow into steps 2 and 3 only (down on a phone, right on lg)",
  count(proc, /data-about-step="/g) === 3 && /<ol/.test(proc) && ["01", "02", "03"].every((n) => proc.includes(`>${n}<`))
  && count(proc, /lg:hidden/g) === 2 && count(proc, /hidden lg:block/g) === 2);
const vals = between(html, 'data-about="values"', 'data-about="audience"');
check("values: five tiles numbered 01–05 by visible order — 3 + 2, the short row centred, 3/2/1 columns",
  count(vals, /data-about-value="/g) === 5 && /data-count="5"/.test(vals) && /justify-center/.test(vals)
  && /basis-full sm:basis-\[calc\(\(100%_-_1\.25rem\)\/2\)\] lg:basis-\[calc\(\(100%_-_2\.5rem\)\/3\)\]/.test(vals)
  && ["01", "02", "03", "04", "05"].every((n) => vals.includes(`>${n}<`)) && !vals.includes(">06<"));
const aud = between(html, 'data-about="audience"', 'data-about="team"');
check("audience: two cards, a 16:10 frame each, four points each",
  count(aud, /data-about-card="/g) === 2 && count(aud, /--about-ratio:16 \/ 10/g) === 2
  && count(between(aud, 'data-about-card="1"', 'data-about-card="2"'), /<li /g) === 4 && count(between(aud, 'data-about-card="2"', null), /<li /g) === 4);
const team = between(html, 'data-about="team"', 'data-about="faq"');
check("team: Jakub and Marcel, an initial each (no picture, no face), the role under the name",
  count(team, /data-about-person="/g) === 2 && />J<\/span>/.test(team) && />M<\/span>/.test(team) && !/<img/.test(team)
  && team.includes("Grafik e-commerce, współzałożyciel") && team.includes("Technologia, współzałożyciel"));
const faq = between(html, 'data-about="faq"', 'data-about="cta"');
const ld = ldOf(html);
const questions = [...faq.matchAll(/<button[^>]*>\s*<span>([^<]+)<\/span>/g)].map((m) => m[1]);
check("FAQ: four questions, ~720px wide (45rem)", questions.length === 4 && /max-w-\[45rem\]/.test(faq), questions.join(" | "));
check("FAQ: each question a button (aria-expanded, aria-controls) inside an <h3>; each answer a region labelled by it, closed and inert",
  [...faq.matchAll(/<h3[^>]*><button type="button" id="([^"]+)" aria-expanded="false" aria-controls="([^"]+)"/g)].length === 4
  && [...faq.matchAll(/<div id="([^"]+)" role="region" aria-labelledby="([^"]+)"/g)].length === 4
  && count(faq, /data-faq-answer="closed"/g) === 4 && count(faq, /inert=""/g) === 4);
check("FAQ JSON-LD: a FAQPage of exactly the four questions on the page, with their answers",
  ld?.["@type"] === "FAQPage" && ld.mainEntity.length === 4 && ld.mainEntity.every((q, i) => q.name === questions[i] && q.acceptedAnswer.text.length > 40),
  JSON.stringify(ld?.mainEntity.map((q) => q.name)));
check("the closing banner: both buttons, the second to /kontakt", /data-about-cta="register"[^>]*>Zacznij za darmo/.test(between(html, 'data-about="cta"', null))
  && /href="\/kontakt"[^>]*data-about-cta="contact"|data-about-cta="contact"[^>]*href="\/kontakt"/.test(html));
check("„Zobacz przykłady” leads to a real public page (/narzedzia, seeded)",
  /href="\/narzedzia"[^>]*data-about-cta="examples"|data-about-cta="examples"[^>]*href="\/narzedzia"/.test(html) && SEED_PAGES.some((p) => p.slug === "narzedzia"));

// Empty pictures: neutral canvases, never a stock photo or a fake result.
const frames = [...html.matchAll(/data-about-slot="([^"]+)" data-filled="([01])"/g)].map((m) => `${m[1]}=${m[2]}`);
check("every painted slot frame is on the page, empty, with a neutral canvas — no <img> anywhere",
  ["about.hero.visual", "about.story.visual", "about.importance.main", "about.importance.secondary1", "about.importance.secondary2",
    "about.audience.small", "about.audience.large", "about.team.jakub", "about.team.marcel"].every((k) => frames.includes(`${k}=0`))
  && count(html, /data-about-fallback/g) >= 8 && !/<img/.test(html), frames.join(" "));
check("the frames carry data-config-key (what the inline editor finds) and reserve their shape (no layout shift)",
  /data-config-key="about\.hero\.visual"/.test(html) && /--about-ratio:21 \/ 9;--about-ratio-m:4 \/ 3/.test(html) && /aspect-\[var\(--about-ratio\)\]/.test(html));

// Filled pictures.
{
  const slots: SlotMap = new Map([
    [ABOUT_SLOT.hero, slot(ABOUT_SLOT.hero)],
    [ABOUT_SLOT.audienceSmall, slot(ABOUT_SLOT.audienceSmall, { alt: "Sprzedawca przy biurku", altI18n: { pl: "Sprzedawca przy biurku", en: "A seller at a desk" } })],
    [ABOUT_SLOT.teamJakub, slot(ABOUT_SLOT.teamJakub)],
  ]);
  const filled = render("pl", seedBlocks(), { slots });
  check("a filled slot paints its picture (and only there); the rest keep their canvas",
    /data-about-slot="about\.hero\.visual" data-filled="1"/.test(filled) && filled.includes("https://cdn.example/about.hero.visual.jpg")
    && /data-about-slot="about\.audience\.small" data-filled="1"/.test(filled) && filled.includes('alt="Sprzedawca przy biurku"')
    && /data-about-slot="about\.story\.visual" data-filled="0"/.test(filled));
  check("…with the editor's alt per language (the section heading only when none is given)",
    render("en", seedBlocks(), { slots }).includes('alt="A seller at a desk"') && filled.includes('alt="Dobre zdjęcie produktu nie powinno kosztować więcej niż marża na produkcie"'));
  check("the hero picture loads first (priority: eager, high fetch priority); others lazy",
    /<img[^>]*src="https:\/\/cdn\.example\/about\.hero\.visual\.jpg"[^>]*>/.test(filled)
    && /loading="eager"|fetchPriority="high"|fetchpriority="high"/.test(between(filled, 'data-about="hero"', 'data-about="story"'))
    && /loading="lazy"/.test(between(filled, 'data-about="audience"', 'data-about="team"')));
  check("a person's picture replaces the initial", !/>J<\/span>/.test(between(filled, 'data-about="team"', 'data-about="faq"')) && />M<\/span>/.test(filled));
  const clip = render("pl", seedBlocks(), { slots: new Map([[ABOUT_SLOT.hero, slot(ABOUT_SLOT.hero, { mediaType: "video", desktop: "https://cdn.example/hero.mp4", poster: "https://cdn.example/hero.jpg" })]]) });
  check("a hero clip: <video> looping, inline, with its poster (muted autoplay once in view, never with reduced motion)",
    /<video[^>]*loop=""[^>]*playsInline=""|<video[^>]*playsInline=""[^>]*loop=""|<video[^>]*loop=""[^>]*playsinline=""/.test(clip) && clip.includes('poster="https://cdn.example/hero.jpg"'));
}

/* ── C ────────────────────────────────────────────────────────────────────── */

section("C. WHAT A VISITOR NEVER RECEIVES");
const SECRET: Record<Locale, string[]> = {
  pl: ["treść do potwierdzenia", "nazwa firmy", "[miasto]", "NIP", "Twoje zdjęcia są Twoje", "Co dzieje się z moimi zdjęciami", "Dane firmy"],
  en: ["content to be confirmed", "company name", "[city]", "VAT ID", "Your photos are yours", "What happens to my photos", "Company details"],
  de: ["Inhalt zu bestätigen", "Firmenname", "[Stadt]", "USt-IdNr", "Deine Fotos gehören dir", "Was passiert mit meinen Fotos", "Firmendaten"],
};
for (const l of LOCALES) {
  const out = render(l, seedBlocks());
  const leaked = SECRET[l].filter((s) => out.includes(s));
  check(`${l}: no switched-off item and no placeholder in the HTML (so none in the RSC payload or the JSON-LD)`, leaked.length === 0, leaked.join(", "));
  check(`${l}: no bracketed gap anywhere in the text`, !/>[^<]*\[[^\]<]{1,80}\][^<]*</.test(out));
  check(`${l}: the JSON-LD has the four visible questions`, ldOf(out)?.mainEntity.length === 4);
}
{
  // Switched ON but still a placeholder: still not shown — the switch alone
  // can never publish a gap.
  const blocks = seedBlocks();
  const values = blocks.find((b) => b.type === "about_values")!;
  const faqB = blocks.find((b) => b.type === "about_faq")!;
  for (const it of [...values.content.items!, ...faqB.content.items!]) delete it.hidden;
  const on = render("pl", blocks);
  check("a placeholder tile or question switched ON is still left out (5 tiles, 4 questions, no gap)",
    count(on, /data-about-value="/g) === 5 && ldOf(on)?.mainEntity.length === 4 && !on.includes("treść do potwierdzenia") && !on.includes("Twoje zdjęcia są Twoje"));
  // Written and switched on: shown, and the layout becomes 3 + 3.
  values.content.items![5]!.description = { pl: "Zatwierdzony tekst o zdjęciach." };
  const six = render("pl", blocks);
  check("…once its text is written, the sixth tile appears (06) and the rows are 3 + 3",
    count(six, /data-about-value="/g) === 6 && six.includes("Zatwierdzony tekst o zdjęciach.") && /data-count="6"/.test(six));
}
{
  const blocks = seedBlocks();
  const audB = blocks.find((b) => b.type === "about_audience")!;
  audB.content.items![1]!.hidden = true;
  audB.content.items![0]!.points![3]!.hidden = true;
  const teamB = blocks.find((b) => b.type === "about_team")!;
  teamB.content.items![1]!.hidden = true;
  const out = render("pl", blocks);
  check("a card, a point and a person switched off: gone (one card of three points, one person centred)",
    count(out, /data-about-card="/g) === 1 && !out.includes("Duzi sprzedawcy") && !out.includes("Darmowe kredyty na start")
    && count(out, /data-about-person="/g) === 1 && !out.includes("Technologia, współzałożyciel")
    && /max-w-md/.test(between(out, 'data-about="team"', 'data-about="faq"')));
}
{
  const blocks = seedBlocks();
  blocks.find((b) => b.type === "about_team")!.visible = false;
  const out = render("pl", blocks);
  check("a section switched off is not rendered at all", !out.includes('data-about="team"') && !out.includes("Kto za tym stoi") && !out.includes("Jakub,") && !out.includes(">J</span>"));
  const noFaq = seedBlocks();
  for (const it of noFaq.find((b) => b.type === "about_faq")!.content.items!) it.hidden = true;
  const empty = render("pl", noFaq);
  check("an FAQ with every question off: no section, no JSON-LD", !empty.includes('data-about="faq"') && !empty.includes("application/ld+json"));
}
check("publicText / shownItems: a gap is never text; a hidden or untitled item is never an item",
  publicText({ pl: "[treść do potwierdzenia]" }, "pl") === "" && publicText({ pl: "  Tekst " }, "pl") === "Tekst"
  && hasPlaceholder("NIP [numer]") && !hasPlaceholder("Cena [PLN] bez") === false
  && shownItems([{ title: { pl: "A" } }, { hidden: true, title: { pl: "B" } }, { title: { pl: "" } }, { title: { pl: "C" }, badge: { pl: "[rola]" } }] as CmsItem[], "pl").length === 1);
{
  // In "Edytuj stronę" the texts carry invisible markers; the JSON-LD and the
  // pictures' alt text must not.
  const marked = markBlocks(seedBlocks(), "pl", "n0nce123") as CmsBlock[];
  const out = render("pl", marked, { slots: new Map([[ABOUT_SLOT.story, slot(ABOUT_SLOT.story)]]) });
  const ldText = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(out)?.[1] ?? "";
  const alts = [...out.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]!);
  check("edit mode: every text is marked, but the JSON-LD and every alt are clean",
    out.includes(stegaMark("n0nce123.c00000000.1").slice(0, 3)) && hasInvisible(out) && !hasInvisible(ldText) && alts.length > 0 && alts.every((a) => !hasInvisible(a)));
}

/* ── D ────────────────────────────────────────────────────────────────────── */

section("D. WHERE „WYPRÓBUJ / ZACZNIJ ZA DARMO” LEADS");
check("startCta: signed in → the app; sign-up open → the sign-up dialog; before launch with a waitlist → /#zapis; otherwise → /",
  startCta({ signedIn: true, allowSignup: false, showAuth: false, waitlist: true, launchHome: true }).href === "/dashboard"
  && startCta({ signedIn: false, allowSignup: true, showAuth: true, waitlist: true, launchHome: true }).kind === "register"
  && startCta({ signedIn: false, allowSignup: false, showAuth: false, waitlist: true, launchHome: true }).href === "/#zapis"
  && startCta({ signedIn: false, allowSignup: true, showAuth: false, waitlist: false, launchHome: false }).href === "/"
  && startCta({ signedIn: false, allowSignup: false, showAuth: false, waitlist: true, launchHome: false }).href === "/");
for (const [start, want] of [
  [{ kind: "waitlist", href: "/#zapis" }, /href="\/#zapis"[^>]*data-about-cta="waitlist"/],
  [{ kind: "home", href: "/" }, /href="\/"[^>]*data-about-cta="home"/],
  [{ kind: "dashboard", href: "/dashboard" }, /href="\/dashboard"[^>]*data-about-cta="dashboard"/],
  [REGISTER, /href="[^"]*\?auth=register"[^>]*data-about-cta="register"|data-about-cta="register"[^>]*href="[^"]*\?auth=register"/],
] as [StartCta, RegExp][]) {
  const out = render("pl", seedBlocks(), { start });
  check(`start = ${start.kind}: both start buttons (story, closing banner) lead there`, count(out, new RegExp(want.source, "g")) === 2);
}
{
  const blocks = seedBlocks();
  blocks.find((b) => b.type === "about_cta")!.content.ctaUrl = "/plany";
  const out = render("pl", blocks, { start: { kind: "waitlist", href: "/#zapis" } });
  check("an address typed in the block wins over the automatic start", /href="\/plany"[^>]*data-about-cta="custom"/.test(out) && count(out, /data-about-cta="waitlist"/g) === 1);
  blocks.find((b) => b.type === "about_cta")!.content.ctaUrl = "javascript:alert(1)";
  const bad = render("pl", blocks, { start: { kind: "home", href: "/" } });
  check("…but never a script or protocol-relative address", !bad.includes("javascript:") && count(bad, /data-about-cta="home"/g) === 2);
}
check("the route computes the start from the platform's access and the active homepage (no sign-up while it is off)",
  /startCta\(\{\s*signedIn: Boolean\(user\), allowSignup: access\.allowSignup, showAuth: access\.showAuthEntry,\s*waitlist: access\.waitlistEnabled, launchHome: home\?\.kind === "launch",?\s*\}\)/.test(readFileSync("app/[slug]/page.tsx", "utf8")));
{
  const route = readFileSync("app/[slug]/page.tsx", "utf8");
  check("share image: the about.seo.og slot, else the page's SEO image, else GrovBase's default 1200×630 — summary_large_image",
    route.includes("ABOUT_SLOT.og") && route.includes('"/launch/og.jpg"') && route.includes('card: "summary_large_image"') && existsSync("public/launch/og.jpg"));
}

/* ── E ────────────────────────────────────────────────────────────────────── */

section("E. THE SEED: THE BRIEF'S COPY AND ITS RULES; 0151 IS THE GENERATOR'S OUTPUT");
{
  const byType = (t: string) => ABOUT.sections.find((s) => s.type === t)!.content;
  check("the brief's headlines and buttons, verbatim",
    lt(byType("about_hero").badge, "pl") === "O NAS"
    && lt(byType("about_hero").subtitle, "pl") === "GrovBase robi z prostego zdjęcia z telefonu gotowe materiały do sprzedaży. Bez studia, bez promptów i bez czekania na grafika."
    && lt(byType("about_story").ctaLabel, "pl") === "Wypróbuj za darmo" && lt(byType("about_importance").ctaLabel, "pl") === "Zobacz przykłady"
    && lt(byType("about_cta").ctaLabel, "pl") === "Zacznij za darmo" && lt(byType("about_cta").cta2Label, "pl") === "Napisz do nas"
    && lt(byType("about_cta").subtitle, "pl") === "Gotowe zdjęcia produktów w kilka minut."
    && lt(byType("about_process").badge, "pl") === "JAK TO DZIAŁA" && lt(byType("about_values").badge, "pl") === "NASZE ZASADY"
    && lt(byType("about_audience").badge, "pl") === "DLA KOGO" && lt(byType("about_team").badge, "pl") === "ZESPÓŁ");
  const values = byType("about_values").items!;
  const faqItems = byType("about_faq").items!;
  check("tile 06 and questions 5 and 6 ship switched OFF with their placeholders",
    values.length === 6 && values[5]!.hidden === true && hasPlaceholder(lt(values[5]!.description, "pl"))
    && faqItems.length === 6 && faqItems[4]!.hidden === true && faqItems[5]!.hidden === true
    && faqItems.slice(0, 4).every((q) => !q.hidden && !hasPlaceholder(lt(q.description, "pl"))));
  check("start buttons have no address in the seed (they follow the platform); the only links are /narzedzia and /kontakt",
    !byType("about_story").ctaUrl && !byType("about_cta").ctaUrl && byType("about_importance").ctaUrl === "/narzedzia" && byType("about_cta").cta2Url === "/kontakt"
    && ABOUT.sections.every((s) => (s.content.items ?? []).every((i) => !i.url && !i.mediaUrl)));
  const text = JSON.stringify(ABOUT.sections);
  check("no invented figures, partners, investors, reviews, user counters, phone or address",
    !/\d+\s?%|\d[\d\s]*\+|klientów|użytkowników|inwestor|partner|opini[ie] klient|tel\.|\+48|ul\.\s/i.test(text.replace(/"(en|de)":"[^"]*"/g, "")));
  check("no privacy, copyright or retention promise outside the switched-off placeholders",
    !/prywatnoś|RODO|prawa autorsk|usuwamy|przechowujemy|retencj/i.test(JSON.stringify(ABOUT.sections.map((s) => ({
      ...s, content: { ...s.content, items: (s.content.items ?? []).filter((i) => !i.hidden) },
    })))));
  check("no person's picture in the seed: the team's slots start empty (initials)",
    byType("about_team").items!.every((p) => p.slot?.startsWith("about.team.") && /^[A-Z]$/.test(p.value ?? "") && !p.mediaUrl));
  for (const l of LOCALES) {
    const missing: string[] = [];
    for (const s of ABOUT.sections) {
      for (const [k, v] of Object.entries(s.content)) {
        if (v && typeof v === "object" && !Array.isArray(v) && "pl" in (v as object) && !(v as Record<string, string>)[l]) missing.push(`${s.type}.${k}`);
      }
      for (const it of s.content.items ?? []) {
        for (const k of ["title", "description", "badge"] as const) if (it[k] && !it[k]![l]) missing.push(`${s.type}.item.${k}`);
        for (const p of it.points ?? []) if (p.title && !p.title[l]) missing.push(`${s.type}.point`);
      }
    }
    if (!ABOUT.seo[l]?.title || !ABOUT.seo[l]?.description) missing.push("seo");
    check(`${l}: every text of the page and its SEO is written`, missing.length === 0, missing.join(", "));
  }
  check("SEO: a title and a description of a search-friendly length, no share image typed in (the slot decides)",
    LOCALES.every((l) => (ABOUT.seo[l]?.title ?? "").length <= 60 && (ABOUT.seo[l]?.description ?? "").length >= 70 && (ABOUT.seo[l]?.description ?? "").length <= 170)
    && !JSON.stringify(ABOUT.seo).includes("ogImage"));
  const generated = execFileSync("node", [".next/cms-seed-sql.mjs", "--about-v2"], { encoding: "utf8" });
  const file = readFileSync("supabase/migrations/0151_about_v2.sql", "utf8");
  check("supabase/migrations/0151_about_v2.sql is the generator's current output", generated === file,
    "run: npm run -s cms:seed-sql -- --about-v2 > supabase/migrations/0151_about_v2.sql");
  check("0151 keeps the outgoing page as a version, runs once, publishes with its own version",
    file.includes("'Przed O nas V2'") && /b\.type = 'about_hero'/.test(file) && file.includes("'publish'") && file.includes("'O nas V2'"));
  check("0151 writes content only: no table, column, function or policy",
    !/create (table|or replace function|function|policy)|alter table|drop /i.test(file.replace(/^--.*$/gm, "")));
  check("0151 carries the switched-off items (so the editor can restore them) and no picture URL",
    file.includes('"hidden":true') && !/storage\/v1\/object/.test(file));
}

console.log(`\n${failures === 0 ? "All about-page tests passed." : `${failures} ABOUT-PAGE TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
