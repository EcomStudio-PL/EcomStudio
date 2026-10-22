/**
 * LEGAL DOCUMENTS — THE PDF. npm run test:legal:pdf
 *
 *   F  the vendored fonts: both Inter TTFs and the real OFL-1.1 licence are
 *      there, and both weights have a glyph for EVERY code point of the four
 *      source files (⁵, →, …, „ ” §, the Polish letters)
 *   M  the layout the PDF draws with (every OpenType feature off): one glyph
 *      per character, none moved, and a line's width is exactly the sum of
 *      its characters' widths — so the line-breaker's measure is the drawing
 *   W  wrapAtSpaces: a line is cut at a space and nowhere else ("9:00-17:00"
 *      and URLs stay whole); every character lands in exactly one line
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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { legalHeaderFacts, type LegalDocContent } from "@/lib/legal/content";
import { LEGAL_DOCS } from "@/lib/legal/docs";
import { normaliseForCompare, parseLegalText } from "@/lib/legal/document";
import {
  LEGAL_PDF_FEATURES_OFF, LEGAL_PDF_FONT_FILES, legalPdfFooterText, renderLegalPdf, wrapAtSpaces,
} from "@/lib/server/legal/pdf";
import {
  legalPdfCacheControl, legalPdfDisposition, legalPdfEtag, legalPdfEtagMatches, legalPdfFileName, legalPdfLang,
  legalPdfResponse, type LegalPdfDeps,
} from "@/lib/server/legal/pdf-route";
import { legalVersionTag, type PublishedLegal } from "@/lib/server/legal/published";
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
    const raw = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", d.file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const pages = raw.split("\f");
    if (pages.length > 0 && pages[pages.length - 1].trim() === "") pages.pop();
    check(`${d.slug}: pdftotext sees ${d.pages} pages`, pages.length === d.pages, pages.length);
    const kept: string[] = [];
    const footerMisses: number[] = [];
    pages.forEach((p, i) => {
      const footer = normaliseForCompare(legalPdfFooterText(d.title, d.version, i + 1, d.pages, "pl"));
      const lines = p.split("\n");
      const at = lines.map((l) => normaliseForCompare(l)).filter((l) => l === footer).length;
      if (at !== 1) footerMisses.push(i + 1);
      kept.push(...lines.filter((l) => normaliseForCompare(l) !== footer));
    });
    check(`${d.slug}: every page has exactly one footer "… · Wersja ${d.version} · Strona X z ${d.pages}"`, footerMisses.length === 0, footerMisses);
    check(`${d.slug}: page 1 footer reads "Strona 1 z ${d.pages}"`, raw.includes(`Strona 1 z ${d.pages}`));
    const got = normaliseForCompare(kept.join("\n"));
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
  const tag = legalVersionTag(regulamin);

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
  const enTag = legalVersionTag(englishCookies);
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

  // LRU: 8 entries. The Regulamin entry is the oldest after nine more texts.
  const short = (i: number) => `Dokument ${i}\n\nWersja: 1.0\n\n1. Punkt ${i}.`;
  const startRenders = renders;
  for (let i = 0; i < 9; i += 1) {
    await legalPdfResponse(req("/polityka-cookies/pdf"), "polityka-cookies", fixed({ page: PAGE("polityka-cookies"), doc: docWith(short(i)) }));
  }
  check("nine new texts → nine renders", renders === startRenders + 9, renders - startRenders);
  const evicted = await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed(published));
  check("the LRU holds at most 8 PDFs: the oldest is rendered again", evicted.status === 200 && renders === startRenders + 10, renders - startRenders);
  const metaChange = docWith(regulamin);
  metaChange.pl = { ...metaChange.pl, version: "1.0.1" };
  await legalPdfResponse(req("/regulamin/pdf"), "regulamin", fixed({ page: PAGE("regulamin"), doc: metaChange }));
  check("a changed version label (same text) is a new render, not the cached file", renders === startRenders + 11, renders - startRenders);
}

async function main() {
  const t0 = process.hrtime.bigint();
  console.log(`poppler: pdftotext ${HAVE.pdftotext ? "yes" : "NO"}, pdfinfo ${HAVE.pdfinfo ? "yes" : "NO"}, pdffonts ${HAVE.pdffonts ? "yes" : "NO"}`);
  check("the registry lists the four documents this suite renders", JSON.stringify(LEGAL_DOCS.map((d) => d.slug)) === JSON.stringify(SOURCES));
  sectionF();
  sectionW();
  const docs = await sectionR();
  sectionT(docs);
  sectionI(docs);
  sectionE(docs);
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
