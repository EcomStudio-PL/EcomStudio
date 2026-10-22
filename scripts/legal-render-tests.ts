/**
 * THE LEGAL DOCUMENTS ON SCREEN — 1:1 WITH THE OWNER'S FILES, WITHOUT A BROWSER.
 *
 * The absolute rule of the legal documents is that the text a visitor reads
 * is the text that was supplied: no line dropped, merged, re-numbered or
 * "tidied". The page renders it through LegalText (components/legal), so this
 * suite renders LegalText — and the whole public document view around it —
 * to static markup for the four source files in content/legal/pl and proves
 * the visible text equals the file.
 *
 * Sections:
 *   A  LegalText, file by file: the visible text is exactly the parsed lines,
 *      equal to the source after whitespace normalisation, line for line, with
 *      the special characters (⁵ →  „ ” … §) intact and one H1
 *   B  headings: ids unique, equal to outline.headings, the ToC tree covers
 *      every one (Regulamin: 9 chapters, 34 §, 2 annexes, version history)
 *   C  links: every web and e-mail address is a link with identical text
 *   D  legalViewFor: which text a visitor gets (pl active / en, de soon …)
 *   E  the page's pure helpers: ToC tree, switcher, related, PDF, date, languages
 *   F  the rendered page: doc mode, ?lang=pl fallback, soon mode, no text
 *   G  the builder preview (BlockRenderer `legal` case)
 *   H  the checkout line, the footers, the routes, the sitemap, the probes
 *
 * Run:
 *   esbuild scripts/legal-render-tests.ts --bundle --platform=node --format=cjs --jsx=automatic \
 *     --alias:@=. --alias:server-only=./scripts/server-only-stub.js \
 *     --alias:next/image=./scripts/stubs/next-image.tsx --alias:next/link=./scripts/stubs/next-link.tsx \
 *     --alias:next/navigation=./scripts/stubs/next-navigation.ts \
 *     --external:sharp --external:@opentelemetry/api --outfile=.next/legal-render-tests.cjs --log-level=error \
 *   && node .next/legal-render-tests.cjs
 *
 * Before the dictionaries carry the new legal.* keys (the integrator merges
 * the i18n fragment), point LEGAL_I18N_FRAGMENT at the fragment JSON and it
 * is laid over the shipped dictionaries for this run only.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { makeT } from "@/lib/i18n/t";
import { LEGAL_DOCS, type LegalLocale } from "@/lib/legal/docs";
import {
  legalViewFor, normalizeLegalText, readLegalDoc, type LegalDocContent, type LegalLocaleDoc,
} from "@/lib/legal/content";
import { nodeText, normaliseForCompare, parseLegalText, legalPlainText, type LegalHeading } from "@/lib/legal/document";
import { consentParts, consentPlainText } from "@/lib/launch/fields";
import { LegalText } from "@/components/legal/legal-text";
import { LegalDocument, LegalSoon } from "@/components/legal/legal-document";
import {
  legalDateLabel, legalHref, legalLanguages, legalPdfHref, legalRelated, legalShortKey, legalSwitcher,
  legalTocIds, legalTocTree,
} from "@/components/legal/legal-view";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import type { CmsBlock } from "@/lib/cms";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (title: string) => console.log(`\n${title}`);
const read = (p: string) => readFileSync(p, "utf8");

/* ── dictionaries (optionally with the track's fragment laid over) ───────── */

type Dict = Record<string, unknown>;
function overlay(base: Dict, extra: Dict | undefined): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    const prev = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object"
      ? overlay(prev as Dict, v as Dict) : v;
  }
  return out;
}
const fragmentPath = process.env.LEGAL_I18N_FRAGMENT;
const fragment = fragmentPath && existsSync(fragmentPath)
  ? JSON.parse(read(fragmentPath)) as Record<string, Dict>
  : null;
if (fragmentPath && !fragment) { console.error(`LEGAL_I18N_FRAGMENT not found: ${fragmentPath}`); process.exit(2); }
const DICTS: Record<LegalLocale, Dict> = {
  pl: overlay(pl as Dict, fragment?.pl),
  en: overlay(en as Dict, fragment?.en),
  de: overlay(de as Dict, fragment?.de),
};
const LOCALES: LegalLocale[] = ["pl", "en", "de"];

/* ── markup helpers ─────────────────────────────────────────────────────── */

/** What React escapes in text and attributes, undone. */
function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
/** The text a browser shows for a piece of static markup. */
const visibleText = (html: string) => decode(html.replace(/<[^>]*>/g, ""));
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** The owner's four files (lib/legal/docs.ts slugs), with the digests they
 *  were delivered with — a changed fixture is a failed test, not a new truth. */
const SOURCES: { slug: string; sha: string }[] = [
  { slug: "regulamin", sha: "151b56da" },
  { slug: "polityka-prywatnosci", sha: "7d0c1b6f" },
  { slug: "polityka-cookies", sha: "0cd23f4b" },
  { slug: "umowa-powierzenia-danych", sha: "a572bc92" },
];
const sourceOf = (slug: string) => normalizeLegalText(read(`content/legal/pl/${slug}.txt`));

function docWith(plText: string, over: Partial<Record<LegalLocale, Partial<LegalLocaleDoc>>> = {}): LegalDocContent {
  const base = (status: "active" | "soon", text: string): LegalLocaleDoc =>
    ({ status, text, version: status === "active" ? "1.0" : "", effective: status === "active" ? "2026-10-20" : null });
  return {
    pl: { ...base("active", plText), ...over.pl },
    en: { ...base("soon", ""), ...over.en },
    de: { ...base("soon", ""), ...over.de },
  };
}

function main() {
  /* ═════════════════════════════════════════════════════════════════════ */
  section("A. LEGALTEXT SHOWS EVERY LINE OF THE FILE, VERBATIM");
  const rendered: Record<string, { html: string; visible: string }> = {};
  for (const { slug, sha } of SOURCES) {
    const raw = read(`content/legal/pl/${slug}.txt`);
    check(`${slug}: the fixture is the owner's file (sha256 ${sha}…)`, sha256(raw).startsWith(sha), sha256(raw).slice(0, 16));
    const text = normalizeLegalText(raw);
    const outline = parseLegalText(text);
    const html = renderToStaticMarkup(createElement(LegalText, { outline, lang: "pl" }));
    const visible = visibleText(html);
    rendered[slug] = { html, visible };

    check(`${slug}: the visible text is exactly the parsed lines, one per node`,
      visible === outline.nodes.map((n) => `${nodeText(n)}\n`).join(""));
    check(`${slug}: visible text = source (whitespace-normalised, 1:1)`,
      normaliseForCompare(visible) === normaliseForCompare(text),
      `${normaliseForCompare(visible).length} vs ${normaliseForCompare(text).length} chars`);
    check(`${slug}: legalPlainText agrees with the markup`,
      normaliseForCompare(legalPlainText(outline)) === normaliseForCompare(visible));

    // LINE FOR LINE: every non-blank source line is one rendered line, in order.
    const srcLines = text.split("\n").filter((l) => l.trim()).map((l) => l.replace(/\s+/g, " ").trim());
    const outLines = visible.split("\n").filter((l) => l.trim()).map((l) => l.replace(/\s+/g, " ").trim());
    const firstDiff = srcLines.findIndex((l, i) => outLines[i] !== l);
    check(`${slug}: ${srcLines.length} source lines → the same ${srcLines.length} lines on screen, same order`,
      srcLines.length === outLines.length && firstDiff === -1,
      firstDiff >= 0 ? `line ${firstDiff + 1}: «${srcLines[firstDiff]?.slice(0, 60)}» vs «${outLines[firstDiff]?.slice(0, 60)}»` : `${outLines.length} lines`);

    for (const ch of ["„", "”", "…", "§", "⁵", "→", "–", "—", "«", "»"]) {
      if (count(text, ch) > 0) {
        check(`${slug}: every "${ch}" survives (${count(text, ch)}×)`, count(visible, ch) === count(text, ch),
          `${count(visible, ch)} on screen`);
      }
    }
    check(`${slug}: exactly one H1, and it is the document's first line`,
      count(html, "<h1") === 1 && visibleText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "") === text.split("\n")[0].trim());
  }
  {
    const reg = sourceOf("regulamin");
    check("Regulamin: the special characters ⁵ (U+2075) and → (U+2192) are in the source",
      reg.includes("⁵") && reg.includes("→"));
    check("Regulamin: ~75 000 characters reached the screen",
      normaliseForCompare(rendered.regulamin.visible).length > 70_000);
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("B. HEADINGS: UNIQUE IDS, THE OUTLINE'S OWN, ALL IN THE TABLE OF CONTENTS");
  for (const { slug } of SOURCES) {
    const outline = parseLegalText(sourceOf(slug));
    const { html } = rendered[slug];
    const found = [...html.matchAll(/<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)]
      .map((m) => ({ level: Number(m[1]), id: m[2], text: visibleText(m[3]) }));
    check(`${slug}: ${found.length} headings rendered = outline.headings`,
      JSON.stringify(found) === JSON.stringify(outline.headings.map((h) => ({ level: h.level, id: h.id, text: h.text }))));
    check(`${slug}: heading ids are unique`, new Set(found.map((h) => h.id)).size === found.length);
    const tree = legalTocTree(outline.headings);
    check(`${slug}: the ToC links every heading, in order`,
      JSON.stringify(legalTocIds(tree)) === JSON.stringify(outline.headings.map((h) => h.id)));
    check(`${slug}: every heading id is a safe fragment`, found.every((h) => /^[a-z0-9][a-z0-9-]*$/.test(h.id)));
  }
  {
    const tree = legalTocTree(parseLegalText(sourceOf("regulamin")).headings);
    const chapters = tree.filter((e) => e.id.startsWith("rozdzial-"));
    const pars = tree.flatMap((e) => e.children).map((c) => c.id);
    check("Regulamin: 9 chapters at the top level", chapters.length === 9,
      chapters.map((c) => c.id).join(","));
    check("Regulamin: § 1 … § 34 nested under the chapters, in order",
      pars.length === 34 && pars.every((id, i) => id === `par-${i + 1}`), pars.join(","));
    check("Regulamin: every chapter has its paragraphs", chapters.every((c) => c.children.length > 0));
    check("Regulamin: both annexes and the version history are top-level entries",
      ["zalacznik-nr-1", "zalacznik-nr-2", "historia-wersji"].every((id) => tree.some((e) => e.id === id && e.children.length === 0)));
    const dpa = legalTocTree(parseLegalText(sourceOf("umowa-powierzenia-danych")).headings);
    check("DPA: § headings are top-level when the document has no chapters",
      dpa.filter((e) => e.id.startsWith("par-")).length === 10);
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("C. EVERY WEB AND E-MAIL ADDRESS IS A LINK THAT SAYS WHAT IT IS");
  for (const { slug } of SOURCES) {
    const text = sourceOf(slug);
    const { html, visible } = rendered[slug];
    const anchors = [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
      attrs: m[1], href: decode(/href="([^"]*)"/.exec(m[1])?.[1] ?? ""), text: visibleText(m[2]),
    }));
    const web = anchors.filter((a) => a.href.startsWith("http"));
    const mail = anchors.filter((a) => a.href.startsWith("mailto:"));
    check(`${slug}: every link's text is exactly its address (${anchors.length} links)`,
      anchors.every((a) => a.href === a.text || a.href === `mailto:${a.text}`),
      anchors.filter((a) => a.href !== a.text && a.href !== `mailto:${a.text}`).map((a) => `${a.href}≠${a.text}`).join("; "));
    check(`${slug}: one web link per "http(s)://" in the file (${web.length})`,
      web.length === count(text, "https://") + count(text, "http://"));
    // Take the links out; nothing that looks like an address may be left over.
    let rest = html;
    for (const m of html.matchAll(/<a [^>]*>[\s\S]*?<\/a>/g)) rest = rest.replace(m[0], "");
    const leftover = visibleText(rest);
    check(`${slug}: no address is left as plain text`,
      !/https?:\/\//.test(leftover) && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(leftover),
      (/\S*(https?:\/\/|@)\S*/.exec(leftover) ?? [""])[0]);
    check(`${slug}: e-mail links are mailto: (${mail.length})`,
      mail.length === (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).length);
    check(`${slug}: web links open in a new tab without an opener`,
      web.every((a) => /target="_blank"/.test(a.attrs) && /rel="noopener noreferrer"/.test(a.attrs)));
    check(`${slug}: linking changed no character`, normaliseForCompare(visible) === normaliseForCompare(text));
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("D. WHICH TEXT A VISITOR GETS (legalViewFor)");
  {
    const doc = docWith("Regulamin\n\n§ 1. Test\n\n1. Punkt.");
    const v = (l: string, force = false) => legalViewFor(doc, l, force);
    const pl0 = v("pl");
    check("pl visitor → the Polish text, no fallback", pl0.mode === "doc" && pl0.locale === "pl" && pl0.fallbackFrom === null);
    const en0 = v("en");
    check("en visitor, en soon → soon, with the Polish text to offer",
      en0.mode === "soon" && en0.locale === "en" && en0.polish?.text === doc.pl.text);
    const de0 = v("de");
    check("de visitor, de soon → soon, with the Polish text to offer", de0.mode === "soon" && de0.locale === "de" && !!de0.polish);
    const enPl = v("en", true);
    check("en visitor + ?lang=pl → the Polish text, marked as a fallback from en",
      enPl.mode === "doc" && enPl.locale === "pl" && enPl.fallbackFrom === "en");
    const plPl = v("pl", true);
    check("pl visitor + ?lang=pl → the Polish text, no fallback notice", plPl.mode === "doc" && plPl.fallbackFrom === null);
    const fr = v("fr");
    check("an unknown locale reads Polish", fr.mode === "doc" && fr.locale === "pl");

    const blank = docWith("  \n ");
    const b1 = legalViewFor(blank, "pl");
    check("an active Polish text that is blank → soon, nothing to offer", b1.mode === "soon" && b1.polish === null);
    const b2 = legalViewFor(blank, "en", true);
    check("…and ?lang=pl cannot conjure it", b2.mode === "soon" && b2.polish === null);

    const withEn = docWith("PL text", { en: { status: "active", text: "EN text", version: "1.0", effective: "2026-10-20" } });
    const e1 = legalViewFor(withEn, "en");
    check("an active English text is what an English visitor reads", e1.mode === "doc" && e1.locale === "en" && e1.entry.text === "EN text");
    const e2 = legalViewFor(withEn, "en", true);
    check("…unless they asked for Polish", e2.mode === "doc" && e2.locale === "pl" && e2.fallbackFrom === "en");
    const d1 = legalViewFor(withEn, "de");
    check("German stays soon while only English is ready", d1.mode === "soon" && d1.locale === "de");
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("E. THE PAGE'S PURE HELPERS");
  {
    const h = (id: string, level: 2 | 3): LegalHeading => ({ id, text: id.toUpperCase(), level });
    const tree = legalTocTree([h("a", 3), h("b", 3), h("c", 2), h("c1", 3), h("d", 2)]);
    check("an h3 before any h2 stands on its own (never swallowed)",
      tree.length === 4 && tree[0].id === "a" && tree[1].id === "b" && tree[0].children.length === 0);
    check("h3s nest under the h2 before them", tree[2].children.map((c) => c.id).join() === "c1" && tree[3].children.length === 0);
    check("the ToC ids are the headings, in order", legalTocIds(tree).join() === "a,b,c,c1,d");
    check("no headings → no table of contents", legalTocTree([]).length === 0);

    const sw = legalSwitcher("polityka-cookies");
    check("the switcher lists the four documents in navigation order",
      sw.map((s) => s.slug).join() === "regulamin,polityka-prywatnosci,polityka-cookies,umowa-powierzenia-danych");
    check("exactly one is current", sw.filter((s) => s.current).map((s) => s.slug).join() === "polityka-cookies");
    check("a reader of the Polish text stays on it (?lang=pl kept)",
      legalSwitcher("regulamin", true).every((s) => s.href === `/${s.slug}?lang=pl`));
    check("every document has its own short name key",
      LEGAL_DOCS.every((d) => legalShortKey(d.slug) !== d.titleKey) && new Set(LEGAL_DOCS.map((d) => legalShortKey(d.slug))).size === 4);

    const reg = legalRelated("regulamin");
    check("Regulamin → its annex, the Umowa powierzenia (Załącznik nr 2)",
      reg.length === 1 && reg[0].slug === "umowa-powierzenia-danych" && reg[0].relation === "annex" && reg[0].labelKey === "legal.annex2");
    const dpa = legalRelated("umowa-powierzenia-danych");
    check("Umowa powierzenia → back to the Regulamin it belongs to",
      dpa.length === 1 && dpa[0].slug === "regulamin" && dpa[0].relation === "parent" && dpa[0].href === "/regulamin");
    check("the policies have no annex relation", legalRelated("polityka-prywatnosci").length === 0 && legalRelated("polityka-cookies").length === 0);
    check("related links keep ?lang=pl too", legalRelated("regulamin", true)[0].href === "/umowa-powierzenia-danych?lang=pl");

    check("PDF: Polish is the route's default, no &lang", legalPdfHref("regulamin", "0123456789ab") === "/regulamin/pdf?v=0123456789ab");
    check("PDF: another active language names itself", legalPdfHref("regulamin", "0123456789ab", "en") === "/regulamin/pdf?v=0123456789ab&lang=en");
    check("legalHref", legalHref("regulamin") === "/regulamin" && legalHref("regulamin", true) === "/regulamin?lang=pl");

    check("date: pl → 20 października 2026", legalDateLabel("2026-10-20", "pl") === "20 października 2026", legalDateLabel("2026-10-20", "pl"));
    check("date: en → 20 October 2026", legalDateLabel("2026-10-20", "en") === "20 October 2026", legalDateLabel("2026-10-20", "en"));
    check("date: de → 20. Oktober 2026", legalDateLabel("2026-10-20", "de") === "20. Oktober 2026", legalDateLabel("2026-10-20", "de"));
    check("date: 1 January stays 1 January in any server time zone", legalDateLabel("2027-01-01", "en") === "1 January 2027");

    const doc = docWith("PL");
    const langs = legalLanguages(doc, "regulamin", "pl", "pl");
    check("languages: PL active and current, EN/DE soon with no link",
      JSON.stringify(langs.map((l) => [l.locale, l.active, l.current, l.href])) ===
      JSON.stringify([["pl", true, true, null], ["en", false, false, null], ["de", false, false, null]]));
    const enReadingPl = legalLanguages(doc, "regulamin", "pl", "en");
    check("languages: an English visitor on the Polish text sees PL current, EN soon",
      enReadingPl[0].current && !enReadingPl[1].active && enReadingPl[1].href === null);
    const withEn = docWith("PL", { en: { status: "active", text: "EN" } });
    const back = legalLanguages(withEn, "regulamin", "pl", "en");
    check("languages: with English ready, an English visitor on ?lang=pl gets a way back to English",
      back[1].active && back[1].href === "/regulamin");
    const soonView = legalLanguages(doc, "regulamin", "en", "en");
    check("languages: an English visitor on the soon page gets the Polish link",
      soonView[0].href === "/regulamin?lang=pl" && soonView[1].current && !soonView[1].active);
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("F. THE PUBLIC PAGE, RENDERED");
  const t = (l: LegalLocale) => makeT(DICTS[l]);
  {
    // Every key the public components name exists in pl/en/de.
    const files = [
      "components/legal/legal-document.tsx", "components/legal/legal-view.ts", "components/legal/legal-toc.tsx",
      "components/cms/legal-page.tsx", "components/cms/blocks.tsx", "components/cms/site-shell.tsx",
      "lib/legal/docs.ts", "components/checkout/checkout-view.tsx",
    ];
    const keys = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/["'`]((?:legal|checkout)\.[A-Za-z0-9]+)["'`]/g)) keys.add(m[1]);
    const lookup = (d: Dict, k: string) => k.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Dict)[p] : undefined), d);
    const missing = [...keys].flatMap((k) => LOCALES.filter((l) => typeof lookup(DICTS[l], k) !== "string").map((l) => `${l}:${k}`));
    check(`every legal.* / checkout.* key the public files use exists in pl/en/de (${keys.size} keys)`,
      missing.length === 0, `${missing.slice(0, 8).join(", ")}${missing.length ? " — merge the fragment or set LEGAL_I18N_FRAGMENT" : ""}`);
  }

  const page = (slug: string, visitor: LegalLocale, forcePolish = false, doc?: LegalDocContent) => {
    const d = doc ?? docWith(sourceOf(slug));
    const view = legalViewFor(d, visitor, forcePolish);
    if (view.mode === "doc") {
      return renderToStaticMarkup(createElement(LegalDocument, {
        slug, t: t(visitor), visitor, doc: d, view,
        outline: parseLegalText(view.entry.text),
        pdfTag: sha256(view.entry.text).slice(0, 12),
        publishedAt: "2026-10-21T10:00:00Z",
      }));
    }
    return renderToStaticMarkup(createElement(LegalSoon, {
      slug, titleKey: LEGAL_DOCS.find((x) => x.slug === slug)?.titleKey ?? "", t: t(visitor), visitor, doc: d,
      shown: view.locale, polishTag: view.polish ? sha256(view.polish.text).slice(0, 12) : null,
    }));
  };
  const hrefs = (html: string, attr: string) =>
    [...html.matchAll(new RegExp(`<a [^>]*${attr}[^>]*>`, "g"))].map((m) => decode(/href="([^"]*)"/.exec(m[0])?.[1] ?? ""));
  const TOKEN = /\{[a-z]+\}/i;

  for (const { slug } of SOURCES) {
    const text = sourceOf(slug);
    const html = page(slug, "pl");
    const tag = sha256(text).slice(0, 12);
    const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "";
    check(`${slug} (pl): the article on the page is the file, 1:1`,
      normaliseForCompare(visibleText(article)) === normaliseForCompare(text));
    check(`${slug} (pl): one H1 — the document's own`, count(html, "<h1") === 1);
    check(`${slug} (pl): both "Pobierz PDF" buttons point at /${slug}/pdf?v=<tag of this text>`,
      JSON.stringify(hrefs(html, "data-legal-pdf")) === JSON.stringify([`/${slug}/pdf?v=${tag}`, `/${slug}/pdf?v=${tag}`])
      && count(html, ">Pobierz PDF<") === 2, hrefs(html, "data-legal-pdf").join(" "));
    check(`${slug} (pl): no download attribute, no window.open`, !/\sdownload[=\s>]/.test(html) && !/window\.open/.test(html));
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => /href="([^"]*)"/.exec(m[0])?.[1]);
    check(`${slug} (pl): the switcher marks this document, and only this one`,
      current.length === 1 && current[0] === `/${slug}`);
    check(`${slug} (pl): the switcher lists all four`, count(html, "data-legal-switcher") === 1
      && LEGAL_DOCS.every((d) => html.includes(`href="/${d.slug}"`)));
    check(`${slug} (pl): version and effective date in the meta row`,
      html.includes(">Wersja 1.0<") && html.includes("Obowiązuje od 20 października 2026") && html.includes('dateTime="2026-10-20"'));
    check(`${slug} (pl): PL • EN • DE with EN and DE marked soon`,
      /data-legal-lang="pl" data-state="active"/.test(html) && /data-legal-lang="en" data-state="soon"/.test(html)
      && /data-legal-lang="de" data-state="soon"/.test(html) && count(html, ">wkrótce<") === 2);
    const mobile = html.indexOf('data-legal-toc="mobile"');
    const art = html.indexOf("<article");
    check(`${slug} (pl): the phone table of contents is a <details> ABOVE the article`,
      mobile > 0 && mobile < art && /<details[^>]*data-legal-toc="mobile"/.test(html));
    check(`${slug} (pl): the desktop table of contents is a sticky column with its own scroll`,
      /data-legal-toc="aside" class="sticky top-24"/.test(html) && /max-h-\[calc\(100dvh-9\.5rem\)\] overflow-y-auto/.test(html));
    const outline = parseLegalText(text);
    check(`${slug} (pl): the ToC links every heading of the text`,
      outline.headings.every((hd) => html.includes(`href="#${hd.id}"`)));
    check(`${slug} (pl): the plain link home is still there`, /<a href="\/" data-legal-back/.test(html));
    check(`${slug} (pl): no fallback notice for a Polish reader`, !html.includes("data-legal-fallback"));
    check(`${slug} (pl): no raw {token} anywhere`, !TOKEN.test(visibleText(html.replace(/<article[\s\S]*<\/article>/, ""))));
  }
  {
    const reg = page("regulamin", "pl");
    check("Regulamin: the related box links its annex, labelled Załącznik nr 2",
      /data-legal-related-link="annex"/.test(reg) && hrefs(reg, "data-legal-related-link").join() === "/umowa-powierzenia-danych"
      && reg.includes("Załącznik nr 2 do Regulaminu"));
    const dpa = page("umowa-powierzenia-danych", "pl");
    check("Umowa powierzenia: the related box links back to the Regulamin",
      /data-legal-related-link="parent"/.test(dpa) && hrefs(dpa, "data-legal-related-link").join() === "/regulamin"
      && dpa.includes("Załącznik nr 2 do Regulaminu"));
    const cookies = page("polityka-cookies", "pl");
    check("Polityka cookies: no related box (nothing is bound to it)", !cookies.includes("data-legal-related"));
  }
  for (const visitor of ["en", "de"] as const) {
    const html = page("regulamin", visitor, true);
    const text = sourceOf("regulamin");
    check(`${visitor} + ?lang=pl: the Polish text, 1:1, lang="pl"`,
      normaliseForCompare(visibleText(/<article[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "")) === normaliseForCompare(text)
      && /<div lang="pl" data-legal-text/.test(html));
    check(`${visitor} + ?lang=pl: a notice in the visitor's language says it is the binding Polish version`,
      html.includes(`data-legal-fallback="${visitor}"`) && html.includes(t(visitor)("legal.fallbackNotice").replace(/'/g, "&#x27;")));
    check(`${visitor} + ?lang=pl: moving to another document keeps the Polish text`,
      hrefs(html, 'aria-current="page"').join() === "/regulamin?lang=pl" && html.includes('href="/polityka-cookies?lang=pl"'));
    check(`${visitor} + ?lang=pl: the PDF is the Polish one (no &lang)`,
      hrefs(html, "data-legal-pdf").every((h) => /^\/regulamin\/pdf\?v=[0-9a-f]{12}$/.test(h)));
    check(`${visitor} + ?lang=pl: the date reads in the visitor's language`,
      html.includes(t(visitor)("legal.effectiveFrom", { date: legalDateLabel("2026-10-20", visitor) })));

    const soon = page("regulamin", visitor);
    check(`${visitor}: soon mode — the H1 is the document's name in ${visitor}`,
      count(soon, "<h1") === 1 && visibleText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(soon)?.[1] ?? "") === t(visitor)("legal.termsTitle"));
    check(`${visitor}: soon mode — the notice in the visitor's language`,
      soon.includes(t(visitor)("legal.soonBody").replace(/'/g, "&#x27;")) && !t(visitor)("legal.soonBody").startsWith("Soon"));
    check(`${visitor}: soon mode — "read the Polish version" → /regulamin?lang=pl`,
      hrefs(soon, "data-legal-read-polish").join() === "/regulamin?lang=pl");
    check(`${visitor}: soon mode — "download the Polish PDF" → /regulamin/pdf?v=<tag>`,
      hrefs(soon, 'data-legal-pdf="polish"').join() === `/regulamin/pdf?v=${sha256(text).slice(0, 12)}`);
    check(`${visitor}: soon mode — no Polish text dressed up as ${visitor}`,
      !soon.includes("data-legal-text") && !soon.includes("Postanowienia ogólne") && !soon.includes("Rozdział"));
    check(`${visitor}: soon mode — no raw {token}`, !TOKEN.test(visibleText(soon)));
  }
  {
    const none = page("regulamin", "en", false, docWith("  "));
    check("no Polish text at all → the 'being finalised' copy, no link to a text that does not exist",
      none.includes(t("en")("legal.pendingBody")) && !none.includes("data-legal-read-polish") && !none.includes("/pdf?"));
    const noVersion = page("polityka-cookies", "pl", false, docWith(sourceOf("polityka-cookies"), { pl: { version: "", effective: null } }));
    check("no version / date set → no empty chips", !noVersion.includes("data-legal-version") && !noVersion.includes("data-legal-effective"));
    const noHeadings = page("polityka-cookies", "pl", false, docWith("Tytuł\n\nJeden akapit bez nagłówków."));
    check("a text without headings → no table of contents, still the text",
      !noHeadings.includes("data-legal-toc") && noHeadings.includes("Jeden akapit bez nagłówków."));
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("G. THE BUILDER PREVIEW (BlockRenderer, `legal` section)");
  {
    const text = sourceOf("polityka-cookies");
    const block = (content: Record<string, unknown>): CmsBlock => ({
      type: "legal", sort_order: 0, visible: true, content, style: {},
    } as unknown as CmsBlock);
    const render = (b: CmsBlock, locale: LegalLocale) =>
      renderToStaticMarkup(createElement(BlockRenderer, { blocks: [b], ctx: renderContext({ locale, t: t(locale), admin: true }) }));
    const doc = docWith(text);
    check("readLegalDoc reads the stored doc back", readLegalDoc({ doc })?.pl.text === text);
    const plHtml = render(block({ doc }), "pl");
    check("a document section shows the text, 1:1",
      plHtml.includes("data-legal-text")
      && normaliseForCompare(visibleText(/<div lang="pl" data-legal-text[^>]*>([\s\S]*)<\/div>/.exec(plHtml)?.[1] ?? "")) === normaliseForCompare(text));
    const enHtml = render(block({ doc }), "en");
    check("…and in a language that is not ready, the notice — not the Polish text",
      enHtml.includes("data-legal-soon") && !enHtml.includes("data-legal-text"));
    const legacy = render(block({ html: { pl: "<h2>Stary</h2><p>Tekst</p>" } }), "pl");
    check("a legacy section (html) still renders through the sanitiser path", legacy.includes('id="sek-1"') && legacy.includes("Tekst"));
    const described = render(block({ description: { pl: "Akapit A\n\nAkapit B" } }), "pl");
    check("a legacy section (description) still renders its paragraphs", described.includes("<p>Akapit A</p>"));
    const blocks = read("components/cms/blocks.tsx");
    check("blocks.tsx still prints markup in exactly one place",
      (blocks.match(/dangerouslySetInnerHTML/g) ?? []).length === 1);
  }

  /* ═════════════════════════════════════════════════════════════════════ */
  section("H. LINKS INTO THE DOCUMENTS: CHECKOUT, FOOTERS, ROUTES, SITEMAP, PROBES");
  {
    for (const l of LOCALES) {
      const tl = t(l);
      const labels = { terms: tl("legal.acceptTerms"), privacy: tl("legal.acceptPrivacy") };
      const parts = consentParts(tl("checkout.legalLinked"), labels);
      check(`${l}: the checkout line links both documents`,
        parts.filter((p) => p.kind === "link").map((p) => p.kind === "link" ? p.link : "").join() === "terms,privacy");
      check(`${l}: …and reads exactly as the old unlinked sentence`,
        consentPlainText(tl("checkout.legalLinked"), labels) === tl("checkout.legal"),
        `${consentPlainText(tl("checkout.legalLinked"), labels)} ≠ ${tl("checkout.legal")}`);
    }
    const checkout = read("components/checkout/checkout-view.tsx");
    check("checkout: the line uses the linked sentence, opening /regulamin and /polityka-prywatnosci in a new tab",
      /consentParts\(t\("checkout\.legalLinked"\)/.test(checkout)
      && /"\/regulamin" : "\/polityka-prywatnosci"\} target="_blank" rel="noopener noreferrer"/.test(checkout));
    check("checkout: the old key stays in the dictionaries", LOCALES.every((l) => typeof (DICTS[l].checkout as Dict).legal === "string"));

    const shell = read("components/cms/site-shell.tsx");
    check("both public footers link the cookie policy after the two documents",
      (shell.match(/href="\/regulamin"[^\n]*\n[^\n]*href="\/polityka-prywatnosci"[^\n]*\n[^\n]*href="\/polityka-cookies"[^\n]*legal\.cookiesShort/g) ?? []).length === 2);

    for (const d of LEGAL_DOCS) {
      const file = `app/${d.slug}/page.tsx`;
      const src = existsSync(file) ? read(file) : "";
      check(`/${d.slug}: a route that is dynamic, names itself and passes ?lang through`,
        /export const dynamic = "force-dynamic"/.test(src)
        && src.includes(`legalMetadata("${d.slug}", "${d.titleKey}")`)
        && src.includes(`<LegalPage slug="${d.slug}" titleKey="${d.titleKey}" searchParams={searchParams} />`));
    }
    const sitemap = read("app/sitemap.ts");
    check("the sitemap lists all four documents",
      LEGAL_DOCS.every((d) => sitemap.includes(`{ path: "/${d.slug}", priority: 0.3, changeFrequency: "yearly" as const }`)));
    for (const probe of ["scripts/mobile-check.mjs", "scripts/smoke-probe.mjs", "scripts/public-bundle-probe.mjs"]) {
      const src = read(probe);
      check(`${probe.replace("scripts/", "")} visits all four documents`, LEGAL_DOCS.every((d) => src.includes(`"/${d.slug}"`)));
    }

    const legalPage = read("components/cms/legal-page.tsx");
    check("the page reads the document through the one shared reader", /getPublishedLegal\(slug\)/.test(legalPage));
    check("the page never imports the browser Supabase client",
      [legalPage, read("components/legal/legal-document.tsx"), read("components/legal/legal-toc.tsx"), read("components/legal/legal-view.ts")]
        .every((s) => !/lib\/supabase\/client/.test(s)));
    check("only the table of contents is client code",
      read("components/legal/legal-toc.tsx").startsWith('"use client"')
      && !read("components/legal/legal-document.tsx").includes('"use client"')
      && !read("components/legal/legal-text.tsx").includes('"use client"'));
    check("today's page is kept for a document that has not been imported yet",
      /<LegacyLegal /.test(legalPage) && /t\("legal\.pendingBody"\)/.test(legalPage));
  }

  console.log(failures === 0 ? "\nAll legal render tests passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

main();
