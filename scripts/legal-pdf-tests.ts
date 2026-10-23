/**
 * LEGAL DOCUMENTS — THE PDF. npm run test:legal:pdf
 *
 *   F  the vendored fonts: both Inter TTFs and the real OFL-1.1 licence are
 *      there, and both weights have a glyph for EVERY code point of the four
 *      source files (⁵, →, …, „ ” §, the Polish letters)
 *   M  the layout the PDF draws with (every OpenType feature off): one glyph
 *      per character, none moved, and a line's width is exactly the sum of
 *      its characters' widths — so the line-breaker's measure is the drawing
 *   C  what the PDF can draw (lib/legal/pdf-coverage.ts): the coverage table
 *      is exactly the code points both Inter TTFs have a glyph for, checked
 *      for all 1 114 112; tab, VT, FF, U+2028/9, the soft hyphen and the
 *      zero-width characters have their roles; legalPdfUncovered
 *   W  wrapAtSpaces: a line is cut at a space and nowhere else ("9:00-17:00"
 *      and URLs stay whole); every character lands in exactly one line; a
 *      tab, VT or FF breaks like a space, U+2028/U+2029 always end a line
 *   N  NO EMPTY BOX: a Word-style text with tabs, VT, FF, line separators, a
 *      soft hyphen and every zero-width character in Polish sentences (in a
 *      heading, a point, a link line and the footer's title) — no .notdef
 *      glyph is drawn, read from the PDF's own page content streams; with ☐ ☑
 *      ✔ and Word's U+F0B7 added, the only boxes are those five characters
 *      and legalPdfUncovered names exactly them (and nothing in the four
 *      documents); the text layer is the source minus the characters not
 *      drawn; a tab is a wide gap, U+2028 a new line; the admin overview's
 *      legalPdfGlyphGaps; the panel's warning and its Warsaw-time date
 *   R  each of the four documents renders: %PDF-1.7 … %%EOF, A4 MediaBox on
 *      every page, at least one page, the same bytes twice (deterministic)
 *   T  1:1 — pdftotext -raw of the PDF, footers removed, equals the source
 *      file after whitespace normalisation, EXACTLY; the footer reads
 *      "<title> · Wersja 1.0 · Strona X z N" on every page; the Regulamin's
 *      chapters, annexes, history, "385⁵", "→" and last line, the DPA's
 *      annexes A and B are in the PDF's text
 *   I  pdfinfo: title (the first line), author, A4 page size, page count
 *   E  pdffonts: only embedded CID TrueType (Inter) fonts
 *   H  the route's pure helpers: lang, Cache-Control, ETag, If-None-Match,
 *      file name and Content-Disposition
 *   Q  legalPdfResponse end to end with a fixture document and a counting
 *      renderer: 200 + headers, immutable only for the current ?v=, 304,
 *      404s (unknown slug, bad lang, "soon" language, no page, no document),
 *      503 without a stack, the per-instance LRU (hit, eviction, failure)
 *
 * T, I and E need poppler-utils (pdftotext, pdfinfo, pdffonts); without the
 * binary a check is reported SKIPPED, never passed. No network, no database.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import plDict from "@/lib/i18n/dictionaries/pl.json";
import enDict from "@/lib/i18n/dictionaries/en.json";
import deDict from "@/lib/i18n/dictionaries/de.json";
import { lookup } from "@/lib/i18n/t";
import { legalHeaderFacts, type LegalDocContent } from "@/lib/legal/content";
import { LEGAL_DOCS } from "@/lib/legal/docs";
import { normaliseForCompare, parseLegalText } from "@/lib/legal/document";
import {
  legalCodePointLabel, legalPdfCharRole, legalPdfGlyphRanges, legalPdfHasGlyph, legalPdfUncovered,
} from "@/lib/legal/pdf-coverage";
import { legalPdfGlyphGaps } from "@/lib/server/legal/admin";
import {
  LEGAL_PDF_FEATURES_OFF, LEGAL_PDF_FONT_FILES, legalPdfFooterText, renderLegalPdf, wrapAtSpaces,
} from "@/lib/server/legal/pdf";
import {
  legalPdfCacheControl, legalPdfDisposition, legalPdfEtag, legalPdfEtagMatches, legalPdfFileName, legalPdfLang,
  legalPdfResponse, type LegalPdfDeps,
} from "@/lib/server/legal/pdf-route";
import { legalPdfTag, legalVersionTag, type PublishedLegal } from "@/lib/server/legal/published";
import type { PublicPage } from "@/lib/server/public-site";

let failures = 0;
let passes = 0;
let skips = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passes++; console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`); }
}
function skip(name: string, why: string) {
  skips++;
  console.log(`  - SKIPPED ${name} — ${why}`);
}

const ROOT = process.cwd();
const SOURCES = ["regulamin", "polityka-prywatnosci", "polityka-cookies", "umowa-powierzenia-danych"] as const;
const SOURCE_SHA_PREFIX: Record<(typeof SOURCES)[number], string> = {
  regulamin: "151b56da",
  "polityka-prywatnosci": "7d0c1b6f",
  "polityka-cookies": "0cd23f4b",
  "umowa-powierzenia-danych": "a572bc92",
};
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const sourceOf = (slug: string) => read(`content/legal/pl/${slug}.txt`);

function hasBinary(name: string): boolean {
  const r = spawnSync(name, ["-v"], { encoding: "utf8" });
  return !r.error;
}
const HAVE = { pdftotext: hasBinary("pdftotext"), pdfinfo: hasBinary("pdfinfo"), pdffonts: hasBinary("pdffonts") };

const TMP = mkdtempSync(path.join(tmpdir(), "legal-pdf-"));

function ms(t0: bigint): string {
  return `${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)} ms`;
}

/** Where two strings first differ, with context — or -1. */
function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
function around(s: string, at: number): string {
  return JSON.stringify(s.slice(Math.max(0, at - 70), at + 70));
}

// The characters a Word export brings along — built from code points, so no
// invisible character is typed into this file.
const ch = (cp: number) => String.fromCodePoint(cp);
const TAB = ch(0x09);
const VT = ch(0x0b);
const FF = ch(0x0c);
const LS = ch(0x2028);
const PS = ch(0x2029);
const SHY = ch(0x00ad);
const ZWSP = ch(0x200b);
const ZWNJ = ch(0x200c);
const ZWJ = ch(0x200d);
const WJ = ch(0x2060);
const ZWNBSP = ch(0xfeff);
const BOX = ch(0x2610);
const BOX_CHECKED = ch(0x2611);
const CHECK = ch(0x2714);
const SYMBOL_BULLET = ch(0xf0b7);
const cpLabel = legalCodePointLabel;

/** The source without the characters the PDF does not draw at all. */
const withoutHidden = (s: string) => Array.from(s).filter((c) => legalPdfCharRole(c) !== "hidden").join("");

/** pdftotext -raw of a PDF, cut into pages, each page's footer line taken
 *  out (and counted: exactly one is expected per page). */
function textWithoutFooters(file: string, footer: (page: number) => string): { pages: number; kept: string; footerMisses: number[]; raw: string } {
  const raw = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const pages = raw.split("\f");
  if (pages.length > 0 && pages[pages.length - 1].trim() === "") pages.pop();
  const kept: string[] = [];
  const footerMisses: number[] = [];
  pages.forEach((p, i) => {
    const want = normaliseForCompare(footer(i + 1));
    const lines = p.split("\n");
    if (lines.filter((l) => normaliseForCompare(l) === want).length !== 1) footerMisses.push(i + 1);
    kept.push(...lines.filter((l) => normaliseForCompare(l) !== want));
  });
  return { pages: pages.length, kept: kept.join("\n"), footerMisses, raw };
}

/**
 * What the pages of a PDF draw, glyph by glyph: every TJ string of every
 * page content stream, decompressed. pdfkit writes a font's glyphs as 4 hex
 * digits each (Identity-H, subset ids), and glyph 0 of every subset is the
 * font's .notdef — the empty box. `fonts` are the resources that drew.
 */
function drawnGlyphs(pdf: Buffer): { total: number; notdef: number; fonts: Set<string> } {
  const s = pdf.toString("latin1");
  let total = 0;
  let notdef = 0;
  const fonts = new Set<string>();
  for (const m of s.matchAll(/\/Length (\d+)\n(?:\/[^\n]*\n)*>>\nstream\n/g)) {
    const from = (m.index ?? 0) + m[0].length;
    let content: string;
    try {
      content = inflateSync(pdf.subarray(from, from + Number(m[1]))).toString("latin1");
    } catch {
      continue;
    }
    // A page's content starts with pdfkit's flip of the coordinate system.
    if (!content.startsWith("1 0 0 -1 0 ")) continue;
    let font = "";
    for (const op of content.matchAll(/\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-f]*>|[-\d.\s])*)\] TJ/g)) {
      if (op[1]) { font = op[1]; continue; }
      for (const hex of op[2].match(/<[0-9a-f]*>/g) ?? []) {
        for (let i = 1; i + 4 < hex.length; i += 4) {
          total += 1;
          if (parseInt(hex.slice(i, i + 4), 16) === 0) notdef += 1;
        }
        fonts.add(font);
      }
    }
  }
  return { total, notdef, fonts };
}

// ── F ───────────────────────────────────────────────────────────────────────
type FontkitRun = {
  advanceWidth: number;
  glyphs: { id: number; codePoints: number[]; advanceWidth: number }[];
  positions: { xAdvance: number; xOffset: number; yOffset: number }[];
};
type FontkitFont = {
  hasGlyphForCodePoint(cp: number): boolean;
  postscriptName: string;
  layout(text: string, features?: Readonly<Partial<Record<string, boolean>>>): FontkitRun;
};
type FontkitModule = { openSync(file: string): FontkitFont };

function sectionF() {
  console.log("F. THE FONTS");
  const ofl = read("lib/server/legal/fonts/OFL.txt");
  check("OFL.txt names the Inter copyright holders", /^Copyright \d{4} The Inter Project Authors \(https:\/\/github\.com\/rsms\/inter\)/.test(ofl));
  check("OFL.txt is the SIL Open Font License 1.1 text", ofl.includes("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007")
    && ofl.includes("PERMISSION & CONDITIONS") && ofl.includes("TERMINATION"));
  // fontkit is pdfkit's own dependency, loaded from the repository's
  // node_modules at run time (not bundled).
  const fontkit = createRequire(path.join(ROOT, "package.json"))("fontkit") as FontkitModule;
  const cps = new Set<number>();
  for (const s of SOURCES) for (const ch of sourceOf(s)) { const cp = ch.codePointAt(0); if (cp !== undefined && cp >= 0x20) cps.add(cp); }
  for (const must of [0x2075, 0x2192, 0x2026, 0x201e, 0x201d, 0x00a7, 0x0105, 0x0142, 0x017c, 0x015a]) {
    check(`the sources use U+${must.toString(16).toUpperCase().padStart(4, "0")} (${String.fromCodePoint(must)})`, cps.has(must));
  }
  for (const [weight, rel] of Object.entries(LEGAL_PDF_FONT_FILES)) {
    const font = fontkit.openSync(path.join(ROOT, rel));
    const missing = [...cps].filter((cp) => !font.hasGlyphForCodePoint(cp)).map((cp) => `U+${cp.toString(16)}`);
    check(`${weight}: ${font.postscriptName} has a glyph for all ${cps.size} code points of the four documents`, missing.length === 0, missing);
  }

  console.log("M. ONE GLYPH PER CHARACTER, MEASURED = DRAWN (the layout the PDF uses)");
  const kerned = fontkit.openSync(path.join(ROOT, LEGAL_PDF_FONT_FILES.regular)).layout("7.");
  check("why kerning is off: Inter pulls \"7.\" together by more than 0.2 em (pdftotext's word-break overlap)",
    kerned.positions[0].xAdvance - kerned.glyphs[0].advanceWidth < -0.2 * 2048);
  for (const [weight, rel] of Object.entries(LEGAL_PDF_FONT_FILES)) {
    const font = fontkit.openSync(path.join(ROOT, rel));
    const charWidth = new Map<string, number>();
    let lines = 0;
    const notAdditive: string[] = [];
    const substituted: string[] = [];
    const moved: string[] = [];
    for (const slug of SOURCES) {
      for (const line of sourceOf(slug).split("\n")) {
        if (line === "") continue;
        lines += 1;
        const run = font.layout(line, LEGAL_PDF_FEATURES_OFF);
        let sum = 0;
        for (const ch of line) {
          let w = charWidth.get(ch);
          if (w === undefined) { w = font.layout(ch, LEGAL_PDF_FEATURES_OFF).advanceWidth; charWidth.set(ch, w); }
          sum += w;
        }
        if (sum !== run.advanceWidth) notAdditive.push(line.slice(0, 50));
        const cpsOut = run.glyphs.flatMap((g) => g.codePoints);
        if (run.glyphs.some((g) => g.codePoints.length !== 1 || g.id === 0) || String.fromCodePoint(...cpsOut) !== line) substituted.push(line.slice(0, 50));
        if (run.positions.some((p, i) => p.xAdvance !== run.glyphs[i].advanceWidth || p.xOffset !== 0 || p.yOffset !== 0)) moved.push(line.slice(0, 50));
      }
    }
    check(`${weight}: every one of ${lines} lines is exactly the sum of its characters' widths`, notAdditive.length === 0, notAdditive.slice(0, 3));
    check(`${weight}: one glyph per character, in order, none missing (no ligature, no substitution)`, substituted.length === 0, substituted.slice(0, 3));
    check(`${weight}: no glyph is moved (no kerning, no mark positioning)`, moved.length === 0, moved.slice(0, 3));
  }
}

// ── C ───────────────────────────────────────────────────────────────────────
function sectionC() {
  console.log("C. WHAT THE PDF CAN DRAW (lib/legal/pdf-coverage.ts)");
  const fontkit = createRequire(path.join(ROOT, "package.json"))("fontkit") as FontkitModule;
  const fonts = Object.values(LEGAL_PDF_FONT_FILES).map((rel) => fontkit.openSync(path.join(ROOT, rel)));
  // Every code point there is, against both fonts: the table is what they
  // cover, no more and no less.
  const fresh: number[] = [];
  const wrong: string[] = [];
  let mismatches = 0;
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    const covered = fonts.every((f) => f.hasGlyphForCodePoint(cp));
    if (covered !== legalPdfHasGlyph(cp)) {
      mismatches += 1;
      if (wrong.length < 5) wrong.push(`${cpLabel(cp)} fonts ${covered} table ${!covered}`);
    }
    if (!covered) continue;
    if (fresh.length > 0 && fresh[fresh.length - 1] === cp - 1) fresh[fresh.length - 1] = cp;
    else fresh.push(cp, cp);
  }
  const table = legalPdfGlyphRanges().flat();
  const same = mismatches === 0 && JSON.stringify(table) === JSON.stringify(fresh);
  check(`the coverage table is exactly the code points both Inter TTFs have a glyph for (${fresh.length / 2} ranges, all 1 114 112 code points checked)`,
    same, { mismatches, first: wrong });
  if (!same) {
    // A font file changed: the table to paste into lib/legal/pdf-coverage.ts.
    const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
    const rows: string[] = [];
    for (let i = 0; i < fresh.length; i += 12) rows.push(`  ${fresh.slice(i, i + 12).map(hex).join(", ")},`);
    console.log(`    COVERED = [\n${rows.join("\n")}\n    ]`);
  }
  // The finding's characters: neither font has a glyph for any of them —
  // which is why the PDF either gives them a role or names them.
  for (const cp of [0x09, 0x0b, 0x0c, 0xad, 0x2028, 0x2029, 0x200d, 0x2060, 0xf0b7, 0x2610, 0x2611, 0x2714]) {
    check(`no glyph for ${cpLabel(cp)} in either font`, fonts.every((f) => !f.hasGlyphForCodePoint(cp)) && !legalPdfHasGlyph(cp));
  }
  const roles = { [TAB]: "tab", [VT]: "space", [FF]: "space", [LS]: "break", [PS]: "break", [SHY]: "hidden", [ZWSP]: "hidden", [ZWNJ]: "hidden", [ZWJ]: "hidden", [WJ]: "hidden", [ZWNBSP]: "hidden" };
  const badRoles = Object.entries(roles).filter(([c, role]) => legalPdfCharRole(c) !== role).map(([c]) => cpLabel(c.codePointAt(0) ?? 0));
  check("roles: tab → tab, VT/FF → space, U+2028/U+2029 → break, soft hyphen and U+200B/C/D, U+2060, U+FEFF → hidden", badRoles.length === 0, badRoles);
  check("roles: nothing else has one (a space, a letter, ☐, U+F0B7)",
    [" ", "a", "ł", BOX, SYMBOL_BULLET, "\n"].every((c) => legalPdfCharRole(c) === null));
  check("legalPdfUncovered of a text with nothing to report is []", legalPdfUncovered(`Zażółć gęślą jaźń § 385⁵ → „x” …${TAB}${SHY}${LS}\r\n`).length === 0);
  const found = legalPdfUncovered(`a${CHECK}b${BOX}${CHECK}${ch(0x1f600)}`);
  check("legalPdfUncovered: each character once, in order of first appearance, with its count (astral code points whole)",
    JSON.stringify(found) === JSON.stringify([
      { char: CHECK, codePoint: 0x2714, count: 2 }, { char: BOX, codePoint: 0x2610, count: 1 }, { char: ch(0x1f600), codePoint: 0x1f600, count: 1 },
    ]), found);
  check("code point labels: U+0009, U+F0B7, U+1F600", cpLabel(9) === "U+0009" && cpLabel(0xf0b7) === "U+F0B7" && cpLabel(0x1f600) === "U+1F600");
}

// ── W ───────────────────────────────────────────────────────────────────────
function sectionW() {
  console.log("W. LINES ARE CUT AT SPACES ONLY");
  const measure = (s: string) => Array.from(s).length; // one unit per character
  const join = (text: string, spans: { start: number; end: number }[]) => spans.map((l) => text.slice(l.start, l.end));

  const t1 = "w dni robocze, 9:00-17:00 czasu polskiego (https://openai.com/policies/) koniec";
  const l1 = join(t1, wrapAtSpaces(t1, 34, measure));
  check("lines are whole words: joined with the spaces they broke at, they are the text",
    l1.length > 1 && l1.join(" ") === t1, l1);
  check("every line fits the width", l1.every((l) => measure(l) <= 34), l1);
  check("\"9:00-17:00\" and the URL stay whole (no break after \"-\" or \"/\")",
    l1.some((l) => l.includes("9:00-17:00")) && l1.some((l) => l.includes("(https://openai.com/policies/)")), l1);

  const long = "ab https://policies.google.com/terms/generative-ai/use-policy cd";
  const l2 = join(long, wrapAtSpaces(long, 12, measure));
  check("a word wider than the column is cut between characters, nothing lost or added",
    l2.join("").replace(/ /g, "") === long.replace(/ /g, ""), l2);
  check("…and every piece fits", l2.every((l) => measure(l) <= 12), l2);

  const t2 = "  wcięcie  i   spacje  ";
  const s2 = wrapAtSpaces(t2, 100, measure);
  check("one line keeps leading, inner and trailing spaces", s2.length === 1 && t2.slice(s2[0].start, s2[0].end) === t2, s2);
  const s3 = wrapAtSpaces("alfa beta gamma", 10, measure);
  check("breaks drop exactly the space they break at", JSON.stringify(join("alfa beta gamma", s3)) === JSON.stringify(["alfa beta", "gamma"]), join("alfa beta gamma", s3));
  check("an empty text is one empty line", JSON.stringify(wrapAtSpaces("", 10, measure)) === JSON.stringify([{ start: 0, end: 0 }]));
  const astral = wrapAtSpaces("𝔸𝔹𝔻", 1, measure);
  check("a code point is never split (surrogate pairs stay together)", astral.length === 3 && astral.every((l) => l.end - l.start === 2), astral);

  const tabbed = `alfa${TAB}beta${VT}gamma${FF}delta`;
  const lt = join(tabbed, wrapAtSpaces(tabbed, 6, measure));
  check("a tab, VT and FF are places to break, like a space (and are left out where the line breaks)",
    JSON.stringify(lt) === JSON.stringify(["alfa", "beta", "gamma", "delta"]), lt);
  const sep = `pierwszy${LS}drugi${PS}${PS}czwarty`;
  const ls = join(sep, wrapAtSpaces(sep, 100, measure));
  check("U+2028 / U+2029 always end a line — two in a row leave an empty one — and are in no line",
    JSON.stringify(ls) === JSON.stringify(["pierwszy", "drugi", "", "czwarty"]), ls);
  const sepWrap = `alfa beta${LS}gamma delta`;
  const lw = join(sepWrap, wrapAtSpaces(sepWrap, 10, measure));
  check("…and each part between them is wrapped at spaces on its own", JSON.stringify(lw) === JSON.stringify(["alfa beta", "gamma", "delta"]), lw);
  const soft = `Przetwa${SHY}rzanie danych`;
  const lsoft = join(soft, wrapAtSpaces(soft, 15, measure));
  check("a soft hyphen is not a place to break: the word stays whole", JSON.stringify(lsoft) === JSON.stringify([`Przetwa${SHY}rzanie`, "danych"]), lsoft);
  check("a word that fits is never cut", wrapAtSpaces("385⁵ Kodeksu→", 20, measure).length === 1);
}

// ── R / T / I / E ───────────────────────────────────────────────────────────
type Rendered = { slug: string; text: string; title: string; version: string; pdf: Buffer; pages: number; file: string };

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

async function sectionR(): Promise<Rendered[]> {
  console.log("R. EVERY DOCUMENT RENDERS");
  const out: Rendered[] = [];
  for (const slug of SOURCES) {
    const text = sourceOf(slug);
    const facts = legalHeaderFacts(text);
    const version = facts.version ?? "";
    const t0 = process.hrtime.bigint();
    const pdf = await renderLegalPdf({ text, version, effective: facts.effective, locale: "pl", sourceUrl: `https://grovbase.com/${slug}` });
    const took = ms(t0);
    const s = pdf.toString("latin1");
    const pages = pageCount(pdf);
    const boxes = (s.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g) ?? []).length;
    console.log(`    ${slug}: ${Array.from(text).length} chars → ${pages} pages, ${(pdf.length / 1024).toFixed(0)} KiB in ${took}`);
    check(`${slug}: the source is the owner's file (sha256 ${SOURCE_SHA_PREFIX[slug]}…)`, legalVersionTag(text).startsWith(SOURCE_SHA_PREFIX[slug]));
    check(`${slug}: version and date read from the header`, version === "1.0" && facts.effective === "2026-10-20", facts);
    check(`${slug}: a PDF 1.7 file, complete`, s.startsWith("%PDF-1.7") && /%%EOF\s*$/.test(s));
    check(`${slug}: at least one page`, pages >= 1, pages);
    check(`${slug}: every page is A4 (MediaBox 595.28 × 841.89)`, boxes === pages, { boxes, pages });
    check(`${slug}: no standard (unembedded) font is referenced`, !/\/BaseFont \/(Helvetica|Times|Courier)/.test(s));
    const file = path.join(TMP, `${slug}.pdf`);
    writeFileSync(file, pdf);
    out.push({ slug, text, title: parseLegalText(text).title ?? "", version, pdf, pages, file });
  }
  const again = await renderLegalPdf({
    text: out[2].text, version: out[2].version, effective: "2026-10-20", locale: "pl", sourceUrl: `https://grovbase.com/${out[2].slug}`,
  });
  check("deterministic: the same input renders the same bytes", Buffer.compare(again, out[2].pdf) === 0);
  return out;
}

function sectionT(docs: Rendered[]) {
  console.log("T. THE PDF's TEXT IS THE SOURCE, 1:1");
  if (!HAVE.pdftotext) {
    skip("1:1 text comparison, footers and required phrases", "pdftotext is not installed");
    return;
  }
  for (const d of docs) {
    const t0 = process.hrtime.bigint();
    const { pages, kept, footerMisses, raw } = textWithoutFooters(d.file, (page) => legalPdfFooterText(d.title, d.version, page, d.pages, "pl"));
    check(`${d.slug}: pdftotext sees ${d.pages} pages`, pages === d.pages, pages);
    check(`${d.slug}: every page has exactly one footer "… · Wersja ${d.version} · Strona X z ${d.pages}"`, footerMisses.length === 0, footerMisses);
    check(`${d.slug}: page 1 footer reads "Strona 1 z ${d.pages}"`, raw.includes(`Strona 1 z ${d.pages}`));
    const got = normaliseForCompare(kept);
    const want = normaliseForCompare(d.text);
    const at = firstDiff(got, want);
    check(`${d.slug}: extracted text equals the source exactly (${want.length} chars after whitespace normalisation) [${ms(t0)}]`,
      at === -1, at === -1 ? undefined : `first difference at ${at}: pdf ${around(got, at)} vs source ${around(want, at)}`);
    if (d.slug === "regulamin") {
      for (const phrase of ["Rozdział IX", "Załącznik nr 1", "Załącznik nr 2", "Historia wersji", "385⁵", "→", "„", "”", "…", "§ 1."]) {
        check(`regulamin: the PDF contains "${phrase}"`, got.includes(phrase) && want.includes(phrase));
      }
      const lastLine = d.text.split("\n").filter((l) => l.trim() !== "").pop() ?? "";
      check(`regulamin: the PDF ends with the source's last line ("${lastLine.slice(0, 40)}…")`, lastLine !== "" && got.endsWith(normaliseForCompare(lastLine)));
    }
    if (d.slug === "umowa-powierzenia-danych") {
      for (const phrase of ["Załącznik A", "Załącznik B"]) check(`dpa: the PDF contains "${phrase}"`, got.includes(phrase));
    }
  }
}

function sectionI(docs: Rendered[]) {
  console.log("I. DOCUMENT INFO");
  if (!HAVE.pdfinfo) {
    skip("title / author / page size / page count", "pdfinfo is not installed");
    return;
  }
  for (const d of docs) {
    const info = execFileSync("pdfinfo", ["-enc", "UTF-8", d.file], { encoding: "utf8" });
    const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(info)?.[1]?.trim() ?? "";
    check(`${d.slug}: Title is the document's first line`, field("Title") === d.title, field("Title"));
    check(`${d.slug}: Author GrovBase, Creator GrovBase`, field("Author") === "GrovBase" && field("Creator") === "GrovBase");
    check(`${d.slug}: Subject names the version and the source`, field("Subject").includes("Wersja 1.0") && field("Subject").includes(`https://grovbase.com/${d.slug}`), field("Subject"));
    check(`${d.slug}: A4 page size`, /^595\.28 x 841\.89 pts \(A4\)/.test(field("Page size")), field("Page size"));
    check(`${d.slug}: pdfinfo counts ${d.pages} pages`, Number(field("Pages")) === d.pages, field("Pages"));
  }
}

function sectionE(docs: Rendered[]) {
  console.log("E. FONTS IN THE FILE");
  if (!HAVE.pdffonts) {
    skip("embedded CID TrueType fonts only", "pdffonts is not installed");
    return;
  }
  for (const d of docs) {
    const rows = execFileSync("pdffonts", [d.file], { encoding: "utf8" }).split("\n").slice(2).filter((l) => l.trim() !== "");
    const parsed = rows.map((r) => ({ r, m: /\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.exec(r) }));
    check(`${d.slug}: two fonts (Inter Regular + SemiBold)`, rows.length === 2 && rows.some((r) => r.includes("Inter-Regular")) && rows.some((r) => r.includes("Inter-SemiBold")), rows);
    check(`${d.slug}: every font is CID TrueType, embedded, with a Unicode map`,
      parsed.every(({ r, m }) => r.includes("CID TrueType") && m !== null && m[1] === "yes" && m[3] === "yes"), rows);
  }
}

// ── N ───────────────────────────────────────────────────────────────────────

/** A text as Word exports it: tabs, VT, FF, line and paragraph separators, a
 *  soft hyphen and every zero-width character, inside Polish sentences — in
 *  the title (so the footer), a heading (the SemiBold font), points, a
 *  continuation, a link line and a paragraph long enough to wrap at tabs. */
const WORD_EXPORT = [
  `Regulamin${SHY} testowy${TAB}GrovBase`,
  "",
  "Wersja: 1.0",
  "Data wejścia w życie: 20 października 2026 r.",
  "",
  `1. Postanowienia${TAB}ogól${SHY}ne`,
  "",
  `1.${TAB}Przetwa${SHY}rzanie danych osobowych odbywa się${TAB}zgodnie z RODO.`,
  `2. Administratorem danych${VT}jest${FF}GrovBase sp. z o.o.${LS}ul. Przykładowa 1${PS}00-001 Warszawa.`,
  `3. Zgoda${ZWSP} jest${ZWNJ} dobrowolna${ZWJ} i${WJ} może${ZWNBSP} być wycofana w każdej chwili.`,
  `   Kontynuacja punktu z${TAB}tabulatorem i miękkim łączni${SHY}kiem.`,
  `${TAB}Akapit zaczynający się od tabulatora, jak w eksporcie z Worda.`,
  `- Kontakt: https://grovbase.com/regulamin lub kontakt@grovbase.com${TAB}(pn.–pt.).`,
  "",
  "2. Długi akapit",
  "",
  `${Array.from({ length: 40 }, (_, i) => `słowo${i + 1}`).join(TAB)}.`,
].join("\n");

/** The same text with characters no font glyph exists for: ☐ ☑ ✔ (twice)
 *  and Word's Symbol-font bullet U+F0B7. */
const WITH_BOXES = `${WORD_EXPORT}\n\n${[
  `${BOX} Wyrażam zgodę na przetwarzanie danych osobowych.`,
  `${BOX_CHECKED} Akceptuję regulamin${TAB}${CHECK}`,
  `${SYMBOL_BULLET}${TAB}Punkt listy wklejony z Worda (punktor z czcionki Symbol).`,
  `Zgoda${CHECK}udzielona.`,
].join("\n")}`;

async function renderFixture(name: string, text: string): Promise<{ pdf: Buffer; file: string; title: string; pages: number }> {
  const pdf = await renderLegalPdf({ text, version: "1.0", effective: "2026-10-20", locale: "pl", sourceUrl: "https://grovbase.com/regulamin" });
  const file = path.join(TMP, `${name}.pdf`);
  writeFileSync(file, pdf);
  return { pdf, file, title: parseLegalText(text).title ?? "", pages: pageCount(pdf) };
}

async function sectionN() {
  console.log("N. NO EMPTY BOX FOR A TAB, A SEPARATOR, A SOFT HYPHEN (draw-time only)");
  check("the fixture holds every character with a role",
    [TAB, VT, FF, LS, PS, SHY, ZWSP, ZWNJ, ZWJ, WJ, ZWNBSP].every((c) => WORD_EXPORT.includes(c)));

  // (3) what the admin is told
  check("legalPdfUncovered: nothing in the Word-style text (every role is handled, every other character has a glyph)",
    legalPdfUncovered(WORD_EXPORT).length === 0, legalPdfUncovered(WORD_EXPORT));
  const uncovered = legalPdfUncovered(WITH_BOXES);
  check("legalPdfUncovered: exactly ☐ ☑ ✔ U+F0B7, in order, ✔ counted twice",
    JSON.stringify(uncovered.map((u) => [cpLabel(u.codePoint), u.count])) === JSON.stringify([["U+2610", 1], ["U+2611", 1], ["U+2714", 2], ["U+F0B7", 1]]),
    uncovered.map((u) => [cpLabel(u.codePoint), u.count]));
  for (const s of SOURCES) check(`legalPdfUncovered: nothing in ${s}`, legalPdfUncovered(sourceOf(s)).length === 0, legalPdfUncovered(sourceOf(s)));

  // (1) no .notdef drawn — read from what the pages really draw
  const a = await renderFixture("word-export", WORD_EXPORT);
  const ga = drawnGlyphs(a.pdf);
  check(`the Word-style text: ${ga.total} glyphs drawn, none of them a .notdef (glyph 0)`, ga.total > 500 && ga.notdef === 0, ga);
  check("…in both fonts (the heading is SemiBold)", ga.fonts.size === 2, [...ga.fonts]);
  const b = await renderFixture("with-boxes", WITH_BOXES);
  const gb = drawnGlyphs(b.pdf);
  const boxes = uncovered.reduce((n, u) => n + u.count, 0);
  check(`with ☐ ☑ ✔ ✔ U+F0B7 added: exactly ${boxes} .notdef glyphs — one per uncovered character, none for anything else`,
    gb.notdef === boxes, { notdef: gb.notdef, boxes });
  for (const slug of SOURCES) {
    const g = drawnGlyphs(readFileSync(path.join(TMP, `${slug}.pdf`)));
    check(`${slug}: ${g.total} glyphs drawn, no .notdef`, g.total > 1000 && g.notdef === 0, g);
  }
  // Variation selectors pasted from the web: folded into the glyph before
  // them, never a box of their own — so the admin is not warned about them.
  const VS16 = ch(0xfe0f);
  const SELECTORS = `Selektory\n\nWersja: 1.0\n\n1. Znak GrovBase™${VS16} oraz ©${VS16} 2026 ❤${VS16} i ®${ch(0xfe0e)}.`;
  check("legalPdfUncovered: variation selectors after covered characters report nothing",
    legalPdfUncovered(SELECTORS).length === 0, legalPdfUncovered(SELECTORS));
  const gs = drawnGlyphs((await renderFixture("selectors", SELECTORS)).pdf);
  check(`…and the PDF draws no .notdef for them (${gs.total} glyphs)`, gs.total > 20 && gs.notdef === 0, gs);
  const checkSel = legalPdfUncovered(`Gotowe ${CHECK}${VS16}`);
  check("an uncovered base character with a selector (✔️) is reported once, as U+2714 only",
    JSON.stringify(checkSel.map((u) => cpLabel(u.codePoint))) === JSON.stringify(["U+2714"]), checkSel);

  if (!HAVE.pdftotext) {
    skip("the Word-style text's text layer, its line breaks and its tab gaps", "pdftotext is not installed");
    return;
  }
  // (2) the text layer: the source, minus what is not drawn
  const footer = (title: string, pages: number) => (page: number) => withoutHidden(legalPdfFooterText(title, "1.0", page, pages, "pl"));
  const ta = textWithoutFooters(a.file, footer(a.title, a.pages));
  check(`the footer's title is drawn without its soft hyphen, its tab a gap, on each of ${a.pages} page(s)`, ta.footerMisses.length === 0, ta.footerMisses);
  const gotA = normaliseForCompare(ta.kept);
  const wantA = normaliseForCompare(withoutHidden(WORD_EXPORT));
  const atA = firstDiff(gotA, wantA);
  check(`the Word-style text: pdftotext equals the source minus the not-drawn characters (${wantA.length} chars after whitespace normalisation)`,
    atA === -1, atA === -1 ? undefined : `first difference at ${atA}: pdf ${around(gotA, atA)} vs source ${around(wantA, atA)}`);
  check("…\"Przetwarzanie\" and \"łącznikiem\" read whole: the soft hyphen leaves no gap", gotA.includes("Przetwarzanie danych") && gotA.includes("miękkim łącznikiem."));
  // The boxes carry no text (pdfkit maps .notdef to U+0000, which pdftotext
  // drops): everything else of the text is there, in order.
  const tb = textWithoutFooters(b.file, footer(b.title, b.pages));
  const squash = (s: string) => s.replace(/\s+/g, "");
  const gotB = squash(tb.kept);
  const wantB = squash(Array.from(withoutHidden(WITH_BOXES)).filter((c) => !uncovered.some((u) => u.char === c)).join(""));
  const atB = firstDiff(gotB, wantB);
  check("with the boxes: every other character of the source is in the text layer, in order", atB === -1,
    atB === -1 ? undefined : `first difference at ${atB}: pdf ${around(gotB, atB)} vs source ${around(wantB, atB)}`);

  const lines = ta.raw.split("\n").map((l) => l.trim());
  check("U+2028 and U+2029 end a line: \"…GrovBase sp. z o.o.\" / \"ul. Przykładowa 1\" / \"00-001 Warszawa.\"",
    lines.some((l) => l.endsWith("jest GrovBase sp. z o.o.")) && lines.includes("ul. Przykładowa 1") && lines.includes("00-001 Warszawa."), lines.slice(0, 20));
  const words = [...execFileSync("pdftotext", ["-bbox", "-enc", "UTF-8", a.file, "-"], { encoding: "utf8" })
    .matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
    .map((m) => ({ x0: Number(m[1]), y: Number(m[2]), x1: Number(m[3]), w: m[4] }));
  const at = words.findIndex((w, i) => w.w === "zgodnie" && words[i - 1]?.w === "się" && words[i - 2]?.w === "odbywa");
  const spaceGap = at > 1 ? words[at - 1].x0 - words[at - 2].x1 : 0;
  const tabGap = at > 1 ? words[at].x0 - words[at - 1].x1 : 0;
  check("a tab is a wide gap: \"się⇥zgodnie\" about four spaces apart, \"odbywa się\" one", at > 1 && tabGap > 3.5 * spaceGap && tabGap < 4.5 * spaceGap,
    { spaceGap, tabGap });
  const wrapped = new Set(words.filter((w) => /^słowo\d+\.?$/.test(w.w)).map((w) => w.y));
  check(`the paragraph of 40 tab-separated words wraps (at tabs) over ${wrapped.size} lines, nothing lost`,
    wrapped.size >= 3 && words.filter((w) => /^słowo\d+\.?$/.test(w.w)).length === 40, wrapped.size);
}

function sectionAdmin() {
  console.log("N. … AND WHAT THE ADMIN SEES (legalPdfGlyphGaps, the panel)");
  const docOf = (pl: string, en = ""): LegalDocContent => ({
    pl: { status: "active", text: pl, version: "1.0", effective: "2026-10-20" },
    en: en ? { status: "active", text: en, version: "1.0", effective: "2026-10-20" } : { status: "soon", text: "", version: "", effective: null },
    de: { status: "soon", text: "", version: "", effective: null },
  });
  const brief = (gaps: ReturnType<typeof legalPdfGlyphGaps>) => gaps.map((g) => `${g.locale}:${g.source}:${g.chars.map((c) => cpLabel(c.codePoint)).join("+")}`);
  const same = brief(legalPdfGlyphGaps(docOf(WITH_BOXES), docOf(WITH_BOXES)));
  check("the draft IS the published text → one warning, \"both\"", JSON.stringify(same) === JSON.stringify(["pl:both:U+2610+U+2611+U+2714+U+F0B7"]), same);
  const draftOnly = brief(legalPdfGlyphGaps(docOf(WITH_BOXES), docOf(WORD_EXPORT)));
  check("only the draft has them → \"draft\"", JSON.stringify(draftOnly) === JSON.stringify(["pl:draft:U+2610+U+2611+U+2714+U+F0B7"]), draftOnly);
  const liveOnly = brief(legalPdfGlyphGaps(docOf(WORD_EXPORT), docOf(`${WORD_EXPORT}\n${CHECK}`)));
  check("only the published text has them → \"published\"", JSON.stringify(liveOnly) === JSON.stringify(["pl:published:U+2714"]), liveOnly);
  const both = brief(legalPdfGlyphGaps(docOf(`${BOX} szkic`, `${SYMBOL_BULLET} draft`), docOf(`${CHECK} opublikowany`)));
  check("different characters in each, and per language", JSON.stringify(both) === JSON.stringify(["pl:published:U+2714", "pl:draft:U+2610", "en:draft:U+F0B7"]), both);
  const unpublishedPage = brief(legalPdfGlyphGaps(docOf(WITH_BOXES), null));
  check("a page never published: the draft's", JSON.stringify(unpublishedPage) === JSON.stringify(["pl:draft:U+2610+U+2611+U+2714+U+F0B7"]), unpublishedPage);
  const owner = SOURCES.flatMap((s) => legalPdfGlyphGaps(docOf(sourceOf(s)), docOf(sourceOf(s))));
  check("the four documents: no warning", owner.length === 0 && legalPdfGlyphGaps(null, null).length === 0, owner.length);

  const panel = read("components/admin/cms/legal-docs-panel.tsx");
  const code = panel.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  check("panel: \"Opublikowano {date}\" is a moment in Europe/Warsaw (formatInstant), not the server's zone (formatDate)",
    /t\("cms\.legalPanel\.publishedAt", \{ date: formatInstant\(page\.publishedAt, locale\) \}\)/.test(code) && !/formatDate/.test(code));
  check("panel: a row with gaps shows the warning, each character with its U+XXXX",
    /pdfGlyphGaps\.length > 0 && <PdfGlyphWarning gaps=\{pdfGlyphGaps\}/.test(code) && /data-legal-pdf-glyphs\b/.test(code)
    && /legalCodePointLabel\(c\.codePoint\)/.test(code) && /`\$\{c\.char\} \$\{code\}`/.test(code));

  const keys = ["title", "body", "published", "draft", "both", "times"].map((k) => `cms.legalPanel.pdfGlyphs.${k}`);
  const fragmentPath = process.env.LEGAL_I18N_FRAGMENT;
  if (fragmentPath && !existsSync(fragmentPath)) {
    check(`LEGAL_I18N_FRAGMENT exists (${fragmentPath})`, false);
    return;
  }
  const fragment = fragmentPath ? JSON.parse(readFileSync(fragmentPath, "utf8")) as Record<string, Record<string, unknown>> : null;
  const dicts: Record<string, Record<string, unknown>> = { pl: plDict, en: enDict, de: deDict };
  const has = (l: string, k: string) => lookup(dicts[l], k) !== undefined || (fragment?.[l] ? lookup(fragment[l], k) !== undefined : false);
  if (!fragment && keys.every((k) => ["pl", "en", "de"].every((l) => lookup(dicts[l], k) === undefined))) {
    skip("the warning's texts in pl/en/de", "not merged into the dictionaries yet — set LEGAL_I18N_FRAGMENT to the fragment");
    return;
  }
  const missing = ["pl", "en", "de"].flatMap((l) => keys.filter((k) => !has(l, k)).map((k) => `${l}:${k}`));
  check("the warning's texts exist in pl, en and de", missing.length === 0, missing);
}

// ── H ───────────────────────────────────────────────────────────────────────
function sectionH() {
  console.log("H. THE ROUTE'S PURE HELPERS");
  check("lang: absent → pl", legalPdfLang(null) === "pl" && legalPdfLang("") === "pl");
  check("lang: en / DE accepted", legalPdfLang("en") === "en" && legalPdfLang("DE") === "de");
  check("lang: anything else refused", legalPdfLang("fr") === null && legalPdfLang("pl-PL") === null && legalPdfLang("../") === null);
  const tag = "0123456789ab";
  check("cache: ?v= the current tag → a year, immutable", legalPdfCacheControl(tag, tag) === "public, max-age=31536000, immutable");
  check("cache: no ?v= → revalidate", legalPdfCacheControl(null, tag) === "public, max-age=0, s-maxage=60, must-revalidate");
  check("cache: an old ?v= → revalidate", legalPdfCacheControl("ffffffffffff", tag) === "public, max-age=0, s-maxage=60, must-revalidate");
  check("cache: a malformed ?v= → revalidate", legalPdfCacheControl("0123456789AB", "0123456789AB") === "public, max-age=0, s-maxage=60, must-revalidate");
  check("etag: \"<tag>-<lang>\"", legalPdfEtag(tag, "pl") === `"${tag}-pl"`);
  const etag = legalPdfEtag(tag, "pl");
  check("if-none-match: exact", legalPdfEtagMatches(etag, etag));
  check("if-none-match: weak form and lists", legalPdfEtagMatches(`W/${etag}`, etag) && legalPdfEtagMatches(`"x", ${etag}`, etag));
  check("if-none-match: *", legalPdfEtagMatches("*", etag));
  check("if-none-match: another language does not match", !legalPdfEtagMatches(legalPdfEtag(tag, "en"), etag) && !legalPdfEtagMatches(null, etag));
  check("file name: Regulamin_GrovBase_v1.0.pdf", legalPdfFileName("Regulamin_GrovBase", "1.0", "pl").ascii === "Regulamin_GrovBase_v1.0.pdf");
  check("file name: a leading v is not doubled", legalPdfFileName("Regulamin_GrovBase", "v2.1", "pl").ascii === "Regulamin_GrovBase_v2.1.pdf");
  check("file name: no version → no suffix", legalPdfFileName("Polityka_Cookies_GrovBase", "  ", "pl").ascii === "Polityka_Cookies_GrovBase.pdf");
  check("file name: another language carries its code", legalPdfFileName("Regulamin_GrovBase", "1.0", "en").ascii === "Regulamin_GrovBase_v1.0_EN.pdf");
  const odd = legalPdfFileName("Regulamin_GrovBase", "1.0 \"wrzesień\"/łódź", "pl");
  check("file name: quotes, slashes and spaces never reach the header", !/["/\\ ]/.test(odd.ascii) && !/["/\\ ]/.test(odd.utf8), odd);
  check("file name: the ASCII name folds Polish letters, the UTF-8 one keeps them", odd.ascii === "Regulamin_GrovBase_v1.0_wrzesien_lodz.pdf" && odd.utf8 === "Regulamin_GrovBase_v1.0_wrzesień_łódź.pdf", odd);
  const disp = legalPdfDisposition("Regulamin_GrovBase", "1.0", "pl");
  check("disposition: attachment with filename and filename*", disp === "attachment; filename=\"Regulamin_GrovBase_v1.0.pdf\"; filename*=UTF-8''Regulamin_GrovBase_v1.0.pdf", disp);
  check("disposition: filename* is percent-encoded UTF-8", legalPdfDisposition("Regulamin_GrovBase", "ł", "pl").endsWith("filename*=UTF-8''Regulamin_GrovBase_v%C5%82.pdf"));
}

// ── Q ───────────────────────────────────────────────────────────────────────
const PAGE = (slug: string): PublicPage => ({
  slug, title: slug, kind: "legal", blocks: [], seo: {}, headerMode: "global", footerMode: "global",
  promo: undefined, publishedAt: null, updatedAt: null,
});

function docWith(pl: string, en?: string): LegalDocContent {
  return {
    pl: { status: "active", text: pl, version: "1.0", effective: "2026-10-20" },
    en: en ? { status: "active", text: en, version: "1.0", effective: "2026-10-20" } : { status: "soon", text: "", version: "", effective: null },
    de: { status: "soon", text: "", version: "", effective: null },
  };
}

async function sectionQ() {
  console.log("Q. THE ROUTE, END TO END (fixture document, counting renderer)");
  const regulamin = sourceOf("regulamin");
  const cookies = sourceOf("polityka-cookies");
  let renders = 0;
  const counting: LegalPdfDeps["render"] = async (input) => { renders += 1; return renderLegalPdf(input); };
  const fixed = (published: PublishedLegal): Partial<LegalPdfDeps> => ({ load: async () => published, render: counting });
  const req = (url: string, headers: Record<string, string> = {}) => new Request(`https://grovbase.com${url}`, { headers });
  const englishCookies = `Cookie policy GrovBase\n\nVersion: 1.0\n\n1. What cookies are\n\n1. A test text, English.`;
  const published: PublishedLegal = { page: PAGE("regulamin"), doc: docWith(regulamin) };
  const tag = legalPdfTag(published.doc!.pl, "pl");

  let t0 = process.hrtime.bigint();
  const r1 = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed(published));
  const body1 = Buffer.from(await r1.arrayBuffer());
  console.log(`    first request (render): ${ms(t0)}`);
  check("200 with a PDF body", r1.status === 200 && body1.subarray(0, 5).toString("latin1") === "%PDF-");
  check("Content-Type application/pdf", r1.headers.get("content-type") === "application/pdf");
  check("Content-Disposition names Regulamin_GrovBase_v1.0.pdf", r1.headers.get("content-disposition") === "attachment; filename=\"Regulamin_GrovBase_v1.0.pdf\"; filename*=UTF-8''Regulamin_GrovBase_v1.0.pdf", r1.headers.get("content-disposition"));
  check("Content-Length is the body's", r1.headers.get("content-length") === String(body1.length));
  check("ETag \"<tag>-pl\"", r1.headers.get("etag") === `"${tag}-pl"`, r1.headers.get("etag"));
  check("no ?v= → revalidating cache", r1.headers.get("cache-control") === "public, max-age=0, s-maxage=60, must-revalidate");
  check("X-Robots-Tag noindex", r1.headers.get("x-robots-tag") === "noindex");
  check("rendered once", renders === 1, renders);

  t0 = process.hrtime.bigint();
  const r2 = await legalPdfResponse(req(`/regulamin/pdf?v=${tag}`), "regulamin", fixed(published));
  const body2 = Buffer.from(await r2.arrayBuffer());
  console.log(`    second request (warm cache): ${ms(t0)}`);
  check("?v=<current tag> → public, max-age=31536000, immutable", r2.headers.get("cache-control") === "public, max-age=31536000, immutable");
  check("the warm instance does not render again, same bytes", renders === 1 && Buffer.compare(body1, body2) === 0, renders);
  const r3 = await legalPdfResponse(req("/regulamin/pdf?v=000000000000"), "regulamin", fixed(published));
  check("?v=<old tag> → the current PDF, revalidating cache", r3.status === 200 && r3.headers.get("cache-control") === "public, max-age=0, s-maxage=60, must-revalidate");

  const r4 = await legalPdfResponse(req("/regulamin/pdf", { "If-None-Match": `"${tag}-pl"` }), "regulamin", fixed(published));
  check("If-None-Match → 304, no body, ETag kept", r4.status === 304 && (await r4.arrayBuffer()).byteLength === 0 && r4.headers.get("etag") === `"${tag}-pl"`);

  const r5 = await legalPdfResponse(req("/regulamin/pdf?lang=en"), "regulamin", fixed(published));
  check("?lang=en while English is \"soon\" → 404", r5.status === 404);
  const r6 = await legalPdfResponse(req("/regulamin/pdf?lang=fr"), "regulamin", fixed(published));
  check("?lang=fr → 404", r6.status === 404);
  const r7 = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed({ page: null, doc: null }));
  check("no published page → 404", r7.status === 404 && r7.headers.get("content-type")?.startsWith("text/plain") === true);
  const r8 = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed({ page: PAGE("regulamin"), doc: null }));
  check("a page without a document section → 404", r8.status === 404);
  const r9 = await legalPdfResponse(req("/kontakt/pdf"), "kontakt", fixed(published));
  check("a slug that is not a legal document → 404", r9.status === 404);
  const soonPl = docWith(regulamin);
  soonPl.pl = { status: "soon", text: regulamin, version: "1.0", effective: null };
  const r10 = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed({ page: PAGE("regulamin"), doc: soonPl }));
  check("Polish marked \"soon\" → 404 (no PDF of an inactive text)", r10.status === 404);

  const origError = console.error;
  console.error = () => {};
  const r11 = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", {
    load: async () => { throw new Error("db down at /secret/stack/path.ts:12"); },
  });
  const failRender = await legalPdfResponse(req("/polityka-cookies/pdf"), "polityka-cookies", {
    load: async () => ({ page: PAGE("polityka-cookies"), doc: docWith(`${cookies}\n`) }),
    render: async () => { throw new Error("font missing"); },
  });
  console.error = origError;
  const text11 = await r11.text();
  check("a failing read → 503, plain, no stack, not cached", r11.status === 503 && text11 === "Service Unavailable" && r11.headers.get("cache-control") === "no-store");
  check("a failing render → 503", failRender.status === 503);
  const before = renders;
  const retry = await legalPdfResponse(req("/polityka-cookies/pdf"), "polityka-cookies", fixed({ page: PAGE("polityka-cookies"), doc: docWith(`${cookies}\n`) }));
  check("a failed render is not remembered: the next request renders", retry.status === 200 && renders === before + 1, renders - before);

  const en = await legalPdfResponse(req("/polityka-cookies/pdf?lang=en"), "polityka-cookies", fixed({ page: PAGE("polityka-cookies"), doc: docWith(cookies, englishCookies) }));
  const enTag = legalPdfTag(docWith(cookies, englishCookies).en, "en");
  check("an active English text → its PDF, _EN file name, ETag \"<tag>-en\"",
    en.status === 200 && en.headers.get("etag") === `"${enTag}-en"`
    && en.headers.get("content-disposition")?.includes("filename=\"Polityka_Cookies_GrovBase_v1.0_EN.pdf\"") === true,
    { etag: en.headers.get("etag"), disp: en.headers.get("content-disposition") });
  if (HAVE.pdftotext) {
    const file = path.join(TMP, "en.pdf");
    writeFileSync(file, Buffer.from(await en.arrayBuffer()));
    const raw = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", file, "-"], { encoding: "utf8" });
    check("the English PDF's footer is in English (\"Version 1.0 · Page 1 of 1\")", raw.includes("Cookie policy GrovBase · Version 1.0 · Page 1 of 1"), raw);
  } else {
    skip("the English PDF's footer text", "pdftotext is not installed");
  }

  // LRU: every document × language, twice (4 × 3 × 2 = 24). Three PDFs are
  // cached by now (the Regulamin — the oldest —, the cookie policy in Polish
  // and in English), so 21 more texts fill it exactly and the Regulamin stays…
  const short = (i: number) => `Dokument ${i}\n\nWersja: 1.0\n\n1. Punkt ${i}.`;
  const startRenders = renders;
  for (let i = 0; i < 21; i += 1) {
    await legalPdfResponse(req("/polityka-cookies/pdf"), "polityka-cookies", fixed({ page: PAGE("polityka-cookies"), doc: docWith(short(i)) }));
  }
  const warm = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed(published));
  check("23 other PDFs later the Regulamin is still warm (room for 4 documents × 3 languages × 2)",
    warm.status === 200 && renders === startRenders + 21, renders - startRenders);
  // …until 24 newer texts have pushed it out as the least recently used.
  for (let i = 21; i < 45; i += 1) {
    await legalPdfResponse(req("/polityka-cookies/pdf"), "polityka-cookies", fixed({ page: PAGE("polityka-cookies"), doc: docWith(short(i)) }));
  }
  const evicted = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed(published));
  check("the LRU holds at most 24 PDFs: the oldest is rendered again", evicted.status === 200 && renders === startRenders + 46, renders - startRenders);

  // Everything the PDF prints is in its tag: a corrected version label or
  // effective date (same text) is a new ETag and a new ?v=, and a new render.
  const metaChange = docWith(regulamin);
  metaChange.pl = { ...metaChange.pl, version: "1.0.1" };
  const rv = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed({ page: PAGE("regulamin"), doc: metaChange }));
  check("a changed version label (same text) is a new render, not the cached file", renders === startRenders + 47, renders - startRenders);
  const dateChange = docWith(regulamin);
  dateChange.pl = { ...dateChange.pl, effective: "2026-11-01" };
  const rd = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed({ page: PAGE("regulamin"), doc: dateChange }));
  const etags = [r1.headers.get("etag"), rv.headers.get("etag"), rd.headers.get("etag")];
  check("…with its own ETag, and so does a changed effective date", new Set(etags).size === 3 && etags.every(Boolean), etags);
  const oldTagAfterVersion = await legalPdfResponse(req(`/regulamin/pdf?v=${tag}`), "regulamin", fixed({ page: PAGE("regulamin"), doc: metaChange }));
  check("the old ?v= is no longer immutable once the version label changed",
    oldTagAfterVersion.headers.get("cache-control") === "public, max-age=0, s-maxage=60, must-revalidate");
  const stale = await legalPdfResponse(req("/regulamin/pdf", { "If-None-Match": `"${tag}-pl"` }), "regulamin", fixed({ page: PAGE("regulamin"), doc: dateChange }));
  check("a browser holding the old ETag gets the new file (200), not 304", stale.status === 200);
  check("the tag differs per language for the same text",
    legalPdfTag(published.doc!.pl, "pl") !== legalPdfTag(published.doc!.pl, "en"));
}

async function main() {
  const t0 = process.hrtime.bigint();
  console.log(`poppler: pdftotext ${HAVE.pdftotext ? "yes" : "NO"}, pdfinfo ${HAVE.pdfinfo ? "yes" : "NO"}, pdffonts ${HAVE.pdffonts ? "yes" : "NO"}`);
  check("the registry lists the four documents this suite renders", JSON.stringify(LEGAL_DOCS.map((d) => d.slug)) === JSON.stringify(SOURCES));
  sectionF();
  sectionC();
  sectionW();
  const docs = await sectionR();
  sectionT(docs);
  sectionI(docs);
  sectionE(docs);
  await sectionN();
  sectionAdmin();
  sectionH();
  await sectionQ();
  console.log(`\n(total ${ms(t0)}; PDFs in ${TMP})`);
  const tail = `${passes} passed${skips ? `, ${skips} SKIPPED` : ""}`;
  console.log(failures === 0 ? `\nAll legal PDF tests passed (${tail}).` : `\n${failures} LEGAL PDF TEST(S) FAILED (${tail}).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
