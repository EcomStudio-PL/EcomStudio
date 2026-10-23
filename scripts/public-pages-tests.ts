/**
 * PUBLIC PAGES V1 — Kontakt, O nas and the site footer, checked offline.
 *
 * What this holds still:
 *
 *   A. the two new section types are wired everywhere a type has to be (the
 *      list the database round-trips, the picker, the builder's fields, the
 *      inline editor's fields) — a type missing from BLOCK_TYPES is silently
 *      dropped by every "Przywróć";
 *   B. they render what the brief asks for: a centred subpage header that
 *      owns the page's <h1>, a before/after visual from two pictures, a
 *      contact form beside real channels only, a text section that does not
 *      draw an empty frame while its photo is still to come;
 *   C. the footer prints each address once, in the visitor's language, with
 *      the three documents always present and the admin's own headings;
 *   D. the seed copy keeps the brief's honesty rules — no link into the
 *      signed-in app, no invented channel, "Wkrótce" on what is not released,
 *      no stock pictures — and migration 0148 is exactly what the generator
 *      prints from it;
 *   E. the contact route refuses what it should, with the code the form
 *      turns into a sentence, and never tells a refused sender "ok" — run
 *      against a fake database, so no message reaches anybody's inbox.
 *
 *   npm run test:publicpages
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/lib/i18n/config";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { I18nProvider } from "@/lib/i18n/provider";
import { lookup, makeT } from "@/lib/i18n/t";
import { BLOCK_TYPES, SECTION_TYPES, lt, type CmsBlock, type CmsBlockContent } from "@/lib/cms";
import { CONTACT_EMAIL_PATTERN, CONTACT_TOPICS, isContactTopic } from "@/lib/cms-forms";
import { fieldsFor } from "@/lib/cms-schema";
import { CMS_FIELDS } from "@/lib/ice/registry";
import { CMS_ICONS } from "@/lib/cms-icons";
import { SEED_PAGES, SEED_GLOBALS, FOOTER_ITEMS } from "@/lib/cms-seed";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { SiteFooter, footerLinks } from "@/components/cms/site-shell";
import type { NavPage } from "@/lib/server/public-site";
import { POST as contactPost } from "@/app/api/public/contact/route";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (title: string) => console.log(`\n${title}`);

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };
const LOCALES: Locale[] = ["pl", "en", "de"];

const markup = (locale: Locale, child: ReactElement) =>
  renderToStaticMarkup(createElement(I18nProvider, { locale, dict: DICTS[locale], children: child }));

const page = (slug: string) => {
  const found = SEED_PAGES.find((p) => p.slug === slug);
  if (!found) throw new Error(`no seed page ${slug}`);
  return found;
};
const blocksOf = (slug: string): CmsBlock[] => page(slug).sections.map((s, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, type: s.type, sort_order: i, visible: true,
  content: s.content, style: s.style, anchor: s.anchor ?? null, analytics_id: s.analyticsId ?? null,
}));
const render = (locale: Locale, blocks: CmsBlock[], admin = false) => markup(locale,
  createElement(BlockRenderer, { blocks, ctx: renderContext({ locale, t: makeT(DICTS[locale]), admin }) }));

/* ── A ────────────────────────────────────────────────────────────────────── */

section("A. THE TWO NEW SECTION TYPES ARE WIRED EVERYWHERE A TYPE MUST BE");
for (const type of ["page_hero", "contact_hub"]) {
  check(`${type}: in BLOCK_TYPES (survives Historia → Przywróć)`, (BLOCK_TYPES as readonly string[]).includes(type));
  check(`${type}: offered in the section picker`, SECTION_TYPES.includes(type));
  check(`${type}: has its own builder fields`, fieldsFor(type).length > 2);
  check(`${type}: editable in "Edytuj stronę"`, Boolean(CMS_FIELDS[type]));
  for (const l of LOCALES) {
    check(`${type}: named in ${l}`, Boolean(lookup(DICTS[l], `cms.sectionType.${type}`)));
  }
}
for (const l of LOCALES) {
  const missing = [...fieldsFor("page_hero"), ...fieldsFor("contact_hub")]
    .flatMap((f) => [f.label, f.hint].filter(Boolean) as string[])
    .filter((k) => !lookup(DICTS[l], `cms.label.${k}`));
  check(`${l}: every builder label and hint of the new types exists`, missing.length === 0, missing.join(", "));
}
check("the tiles list is edited by the builder (a second `items` field keyed `tiles`)",
  fieldsFor("contact_hub").some((f) => f.key === "tiles" && f.kind === "items"));
check("the inline editor never offers a link, an address or a topic code",
  [...CMS_FIELDS.page_hero.text, ...CMS_FIELDS.contact_hub.text]
    .every((p) => !/url|Url|value|icon|items\./.test(p)));
check("the tiles' icons exist in the allowlist", ["mail", "support", "handshake"].every((n) => Boolean(CMS_ICONS[n])));

/* ── B ────────────────────────────────────────────────────────────────────── */

section("B. WHAT THE PAGES RENDER");
{
  const html = render("pl", blocksOf("kontakt"));
  check("Kontakt: exactly one <h1>, and it is „Porozmawiajmy.”",
    (html.match(/<h1[\s>]/g) ?? []).length === 1 && /<h1[^>]*>Porozmawiajmy\.<\/h1>/.test(html));
  check("…a centred header with no picture and no dashboard mock-up",
    /data-page-hero="text"/.test(html) && !/select-none rounded-3xl/.test(html));
  check("the form posts to the approved contact handler", /data-cms-form="contact"/.test(html));
  check("…validates in the page's language (no browser bubbles)", /<form[^>]*noValidate|<form[^>]*novalidate/.test(html));
  const options = [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  check("…topics: Pytanie, Pomoc techniczna, Współpraca, Inne",
    JSON.stringify(options) === JSON.stringify([["question", "Pytanie"], ["support", "Pomoc techniczna"], ["partnership", "Współpraca"], ["other", "Inne"]]),
    JSON.stringify(options));
  check("…every topic is one the route and the database accept", options.every(([v]) => isContactTopic(v!)));
  check("…the honeypot is there", /name="company"[^>]*tabindex="-1"|tabIndex="-1"[^>]*name="company"|name="company"/.test(html));
  check("…the privacy policy is one click from the consent line", /href="\/polityka-prywatnosci"/.test(html));
  check("…the submit button says „Wyślij wiadomość”", /<button type="submit"[^>]*>(<[^>]+>)*Wyślij wiadomość/.test(html));
  const tiles = [...html.matchAll(/<a href="(mailto:[^"]+)"/g)].map((m) => m[1]);
  check("quick contact: three tiles, all the verified mailbox", tiles.length === 3 && tiles.every((h) => h === "mailto:contact@grovbase.com"), tiles.join(" "));
  check("…each spells the address out", (html.match(/>contact@grovbase\.com</g) ?? []).length === 3);
  check("…no phone, office or opening hours anywhere on the page", !/tel:|\+48|9:00|godzin/i.test(html));
  check("FAQ: four questions", (html.match(/<details/g) ?? []).length === 4);
  for (const l of ["en", "de"] as const) {
    const other = render(l, blocksOf("kontakt"));
    check(`${l}: the page is in ${l} (title, topics, button)`,
      !/Porozmawiajmy|Pytanie|Wyślij wiadomość/.test(other) && /<h1/.test(other));
  }
}
{
  const html = render("pl", blocksOf("o-nas"));
  check("O nas: one <h1> with the brief's headline",
    (html.match(/<h1[\s>]/g) ?? []).length === 1
    && /Tworzymy prostszy sposób na profesjonalne zdjęcia produktów\./.test(html));
  check("…the badge „POZNAJ GROVBASE”", /POZNAJ GROVBASE/.test(html));
  check("…a before/after visual: two pictures, labelled", /data-page-hero="pair"/.test(html)
    && /miniaturka\.png/.test(html) && /zestaw\.png/.test(html) && />Przed</.test(html) && />Po</.test(html));
  check("…sections as H2: Dlaczego GrovBase?, Co tworzymy?, Nasze podejście, the closing call",
    ["Dlaczego GrovBase?", "Co tworzymy?", "Nasze podejście", "Zobacz, co możesz stworzyć z GrovBase."]
      .every((h) => new RegExp(`<h2[^>]*>${h.replace(/[?.]/g, "\\$&")}</h2>`).test(html)));
  check("…three „Dlaczego” cards: Prostota, E-commerce, Jedna platforma",
    ["Prostota", "E-commerce", "Jedna platforma"].every((t) => new RegExp(`<h3[^>]*>${t}</h3>`).test(html)));
  check("…the closing call goes to the premiere page and the cennik",
    /href="\/"[^>]*>Sprawdź możliwości/.test(html) && /href="\/plany"[^>]*>Zobacz cennik/.test(html));
  check("…„Nasze podejście” without its photo is text only — no empty frame for a visitor",
    !/cms\.photoPlaceholder|Miejsce na zdjęcie/.test(html));
  const admin = render("pl", blocksOf("o-nas"), true);
  check("…while the builder's preview shows where the photo will go", /Miejsce na zdjęcie/.test(admin));
  check("…and nothing links into the signed-in app",
    ![...html.matchAll(/href="([^"]+)"/g)].some((m) => /^\/(home|dashboard|generator|retusz|tools|k|plan|register|login)(\/|$|\?)/.test(m[1]!)));
}

/* ── C ────────────────────────────────────────────────────────────────────── */

section("C. THE FOOTER");
const NAV: NavPage[] = [
  { slug: "o-nas", title: "O nas", navGroup: "company", navOrder: 10 },
  { slug: "kontakt", title: "Kontakt", navGroup: "company", navOrder: 20 },
  { slug: "regulamin", title: "Regulamin", navGroup: "legal", navOrder: 10 },
  { slug: "polityka-prywatnosci", title: "Polityka prywatności", navGroup: "legal", navOrder: 20 },
  { slug: "polityka-cookies", title: "Polityka cookies", navGroup: "legal", navOrder: 30 },
  { slug: "umowa-powierzenia-danych", title: "Umowa powierzenia danych", navGroup: "legal", navOrder: 40 },
];
const FOOTER = SEED_GLOBALS.footer.content as unknown as CmsBlockContent;
{
  const links = footerLinks(FOOTER, NAV, "pl", makeT(DICTS.pl));
  const urls = links.map((l) => l.url);
  check("every address once", new Set(urls).size === urls.length, urls.join(" "));
  check("GrovBase column: O nas, Kontakt, Cennik (/plany)",
    JSON.stringify(links.filter((l) => l.group === "company").map((l) => [l.label, l.url]))
      === JSON.stringify([["O nas", "/o-nas"], ["Kontakt", "/kontakt"], ["Cennik", "/plany"]]));
  check("Informacje column: the three documents first, then the other published legal pages",
    JSON.stringify(links.filter((l) => l.group === "legal").map((l) => l.url))
      === JSON.stringify(["/regulamin", "/polityka-prywatnosci", "/polityka-cookies", "/umowa-powierzenia-danych"]));
  const bare = footerLinks({}, [], "pl", makeT(DICTS.pl));
  check("with nothing configured the three documents are still there",
    JSON.stringify(bare.map((l) => l.url)) === JSON.stringify(["/regulamin", "/polityka-prywatnosci", "/polityka-cookies"]));
  const enLinks = footerLinks(FOOTER, NAV, "en", makeT(DICTS.en));
  check("en: the authored links speak English (not the pages' Polish titles)",
    ["About us", "Contact", "Pricing", "Terms"].every((label) => enLinks.some((l) => l.label === label))
    && !enLinks.some((l) => ["O nas", "Cennik", "Regulamin"].includes(l.label)));
  check("the pricing link is the public /plany (never the in-app /plan)",
    FOOTER_ITEMS.some((i) => i.url === "/plany") && !urls.includes("/plan"));
}
{
  const site = { instagramUrl: "", facebookUrl: "", linkedinUrl: "", xUrl: "" };
  const html = markup("pl", createElement(SiteFooter, {
    global: { footer: { slot: "footer", visible: true, content: FOOTER } }, nav: NAV, site, locale: "pl", t: makeT(DICTS.pl),
  }));
  check("one <footer>", (html.match(/<footer/g) ?? []).length === 1);
  check("the admin's headings win: „GrovBase” and „Informacje”",
    />GrovBase<\/h2>/.test(html) && />Informacje<\/h2>/.test(html));
  check("the real logo links home", /href="\/"/.test(html) && /\/brand\/logo-on-/.test(html));
  check("bottom bar: © year GrovBase and the brand line",
    new RegExp(`© ${new Date().getFullYear()} GrovBase`).test(html) && /Narzędzia AI dla e-commerce/.test(html));
  check("the language switch and the way back to the top", /data-footer-locale/.test(html) && /href="#top"/.test(html));
  check("no social row while no profile is configured", !/aria-label="Instagram"|aria-label="Facebook"/.test(html));
  const withSocial = markup("pl", createElement(SiteFooter, {
    global: {}, nav: [], locale: "pl", t: makeT(DICTS.pl),
    site: { ...site, instagramUrl: "https://instagram.com/grovbase" },
  }));
  check("…and exactly the configured one when there is one",
    /aria-label="Instagram"/.test(withSocial) && !/aria-label="Facebook"/.test(withSocial) && /rel="noopener noreferrer"/.test(withSocial));
  check("the premiere page's footer uses the on-dark logo whatever the theme",
    /logo-on-dark/.test(markup("pl", createElement(SiteFooter, { global: {}, nav: [], site, locale: "pl", t: makeT(DICTS.pl), forceDark: true }))));
}

/* ── D ────────────────────────────────────────────────────────────────────── */

section("D. THE COPY KEEPS THE BRIEF'S RULES; 0148 IS THE GENERATOR'S OUTPUT");
{
  const about = page("o-nas");
  const contact = page("kontakt");
  const links = [about, contact].flatMap((p) => p.sections.flatMap((s) => {
    const c = s.content;
    return [c.ctaUrl, c.cta2Url, ...(c.items ?? []).map((i) => i.url), ...(c.tiles ?? []).map((i) => i.url)]
      .filter((u): u is string => Boolean(u));
  }));
  check("every link is public: /, /kontakt, /plany, an anchor or the mailbox",
    links.every((u) => ["/", "/kontakt", "/plany"].includes(u) || u.startsWith("#") || u === "mailto:contact@grovbase.com"),
    links.join(" "));
  check("the mailbox is a valid address", CONTACT_EMAIL_PATTERN.test("contact@grovbase.com"));
  const cards = about.sections.find((s) => s.type === "cards")!.content.items ?? [];
  check("„Co tworzymy?”: Retusz AI, Miniaturki produktowe, GrovShot, Edycja zdjęć, Narzędzia e-commerce",
    ["Retusz AI", "Miniaturki produktowe", "GrovShot", "Edycja zdjęć", "Narzędzia e-commerce"]
      .every((name) => cards.some((c) => lt(c.title, "pl") === name)));
  check("…what is not released says „Wkrótce” (and only that card)",
    cards.filter((c) => lt(c.badge, "pl") === "Wkrótce").map((c) => lt(c.title, "pl")).join() === "Sesje modowe");
  const pictures = [...cards.map((c) => c.mediaUrl), about.sections[0]!.content.mediaUrl, about.sections[0]!.content.media2Url];
  check("every picture is a file from the GrovBase media library (no stock)",
    pictures.every((u) => typeof u === "string" && u.startsWith("https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/")));
  const text = JSON.stringify([about, contact]);
  check("no invented numbers: customers, awards, team size, years, founders' names",
    !/klient(ów|ami)|nagrod|pracownik|lat doświadczenia|założyciel/i.test(text.replace(/"pl":"[^"]*Polityka[^"]*"/g, "")));
  check("no reply-time promise (the old seed's „zwykle tego samego dnia”)", !/tego samego dnia|same day|am selben Tag/.test(text));
  check("every contact topic in the seed is on the closed list",
    (contact.sections.find((s) => s.type === "contact_hub")!.content.items ?? []).every((i) => isContactTopic(i.value ?? ""))
    && (CONTACT_TOPICS as readonly string[]).includes("question"));
  for (const l of LOCALES) {
    const missing: string[] = [];
    for (const p of [about, contact]) {
      for (const s of p.sections) {
        const c = s.content as Record<string, unknown>;
        for (const [k, v] of Object.entries(c)) {
          if (v && typeof v === "object" && !Array.isArray(v) && "pl" in (v as object) && !(v as Record<string, string>)[l]) missing.push(`${p.slug}.${s.type}.${k}`);
        }
        for (const it of [...(s.content.items ?? []), ...(s.content.tiles ?? [])]) {
          for (const k of ["title", "description", "badge", "alt"] as const) {
            if (it[k] && !it[k]![l]) missing.push(`${p.slug}.${s.type}.item.${k}`);
          }
        }
      }
      if (!p.seo[l]?.title || !p.seo[l]?.description) missing.push(`${p.slug}.seo`);
    }
    check(`${l}: every text of both pages and their SEO is written`, missing.length === 0, missing.join(", "));
  }
  const generated = execFileSync("node", [".next/cms-seed-sql.mjs", "--release"], { encoding: "utf8" });
  const file = readFileSync("supabase/migrations/0148_public_pages_v1.sql", "utf8");
  check("supabase/migrations/0148_public_pages_v1.sql is the generator's current output", generated === file,
    "run: npm run -s cms:seed-sql -- --release > supabase/migrations/0148_public_pages_v1.sql");
  check("0148 keeps the outgoing pages as a version before replacing them",
    (file.match(/'Przed Public pages V1'/g) ?? []).length === 2 && (file.match(/'publish', 'Public pages V1'/g) ?? []).length === 2);
  check("0148 runs once: a page already on the new layout is left alone",
    /analytics_id = 'about\.hero'/.test(file) && /analytics_id = 'contact\.hero'/.test(file));
  check("0148 patches the footer only while it has no links of its own", /jsonb_array_length\(content->'items'\), 0\) = 0/.test(file));
  check("0148's address check is 0086's, byte for byte",
    file.includes(`'^[^@\\s]+@[^@\\s.]+\\.[^@\\s]{2,}$'`)
    && readFileSync("supabase/migrations/0086_cms_contact_messages.sql", "utf8").includes(`'^[^@\\s]+@[^@\\s.]+\\.[^@\\s]{2,}$'`));
}

/* ── E ────────────────────────────────────────────────────────────────────── */

section("E. THE CONTACT ROUTE (fake database — nothing is stored or sent)");
void (async () => {
  type Call = { fn: string; args: Record<string, unknown> };
  const calls: Call[] = [];
  let answer: Record<string, unknown> = { status: "created", id: "m1" };
  (globalThis as unknown as { __prelaunchSession: unknown }).__prelaunchSession = {
    client: {
      auth: { getUser: async () => ({ data: { user: null } }) },
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: answer, error: null }; },
    },
  };
  let ip = 0;
  const post = async (body: Record<string, unknown>, from = `198.51.100.${++ip}`) => {
    const res = await contactPost(new Request("https://grovbase.com/api/public/contact", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as { ok?: boolean; error?: string } };
  };
  const good = { name: "Anna", email: "anna@example.com", topic: "question", message: "Dzień dobry, mam pytanie.", locale: "pl", elapsed: 6000 };

  let r = await post(good);
  check("a real message: 200 ok, stored through submit_contact_message as 'question'",
    r.status === 200 && r.body.ok === true && calls.length === 1 && calls[0]!.fn === "submit_contact_message"
    && calls[0]!.args.p_topic === "question" && calls[0]!.args.p_source === "website");
  check("…with no IP in what is stored", !JSON.stringify(calls[0]!.args).includes("198.51.100."));

  calls.length = 0;
  r = await post({ ...good, elapsed: 400 });
  check("sent 0.4 s after the form opened: refused as too_fast, nothing stored, never 'ok'",
    r.status === 400 && r.body.ok === false && r.body.error === "too_fast" && calls.length === 0);
  r = await post({ ...good, company: "ACME" });
  check("the honeypot filled: a bot is told ok and nothing is stored", r.status === 200 && r.body.ok === true && calls.length === 0);
  r = await post({ ...good, email: "anna@example" });
  check("an incomplete address: 400 invalid, nothing stored", r.status === 400 && r.body.error === "invalid" && calls.length === 0);
  r = await post({ ...good, message: "hej" });
  check("a message under five characters: 400 invalid", r.status === 400 && r.body.error === "invalid" && calls.length === 0);
  r = await post({ ...good, name: "   " });
  check("no name: 400 invalid", r.status === 400 && r.body.error === "invalid" && calls.length === 0);

  const { elapsed: _omit, ...older } = good;
  void _omit;
  r = await post(older);
  check("a form cached before the time trap (no `elapsed`) still works", r.status === 200 && r.body.ok === true && calls.length === 1);
  calls.length = 0;
  r = await post({ ...good, topic: "<script>" });
  check("a topic off the closed list is stored as 'other'", r.status === 200 && calls[0]?.args.p_topic === "other");

  calls.length = 0;
  answer = { status: "rate_limited" };
  r = await post(good);
  check("the database's per-address limit: 429 rate_limited (the form says so in words)",
    r.status === 429 && r.body.error === "rate_limited");
  answer = { status: "created", id: "m2" };

  const burst: number[] = [];
  for (let i = 0; i < 9; i++) burst.push((await post(good, "203.0.113.9")).status);
  check("the ninth message within the hour from one address is refused before the database",
    burst.slice(0, 8).every((s) => s === 200) && burst[8] === 429, burst.join(","));
})().then(() => {
  console.log(failures === 0 ? "\nAll public pages tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}, (e: unknown) => {
  console.error(e);
  process.exit(1);
});
