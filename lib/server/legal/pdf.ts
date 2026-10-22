import "server-only";
import path from "path";
import PDFDocument from "pdfkit";
import { parseLegalText, splitLinks, nodeText, type LegalNode } from "@/lib/legal/document";
import type { LegalLocale } from "@/lib/legal/docs";
import { LEGAL_PDF_ROLE_CHARS, legalPdfCharRole, legalPdfRoleClass } from "@/lib/legal/pdf-coverage";

/**
 * A PUBLISHED LEGAL DOCUMENT AS AN A4 PDF — every character of it, drawn as is.
 *
 * The layout comes from parseLegalText (lib/legal/document.ts), the same
 * reading the public page uses: one source line, one node; the number of a
 * point, its dash and the "§" are text, never re-generated. What this module
 * adds is typography only — a bigger title, headings that stand out, points
 * with a hanging indent, a footer with the version and "Strona X z Y".
 *
 * LINES ARE BROKEN HERE, AND ONLY AT SPACES. pdfkit's own wrapper follows the
 * Unicode line-breaking rules, which also break after a hyphen or a slash —
 * "9:00-17:00" would print as "9:00-" / "17:00", and a copy of the PDF's text
 * would no longer be the document's text. So every line is measured and cut
 * at a space; nothing is hyphenated, nothing is justified, no character is
 * added or dropped (the space a line breaks at is the only thing not drawn,
 * the invisible characters below aside).
 * A single word wider than the column — none of the four documents has one —
 * is cut between characters rather than overflowing the page.
 *
 * ONE GLYPH PER CHARACTER, AT ITS OWN WIDTH, FOR THE SAME REASON. Every
 * OpenType feature is switched off (TEXT_FEATURES). Kerning would break the
 * text: Inter pulls "7." and "7," together by a quarter of an em, and text
 * extraction (poppler's pdftotext, and the copy and search paths built on the
 * same rule) reads a glyph pulled back by more than 0.2 em as the start of a
 * new word — "7. Workspace" would come out of the PDF as "7 . Workspace". The
 * substitutions (contextual alternates and the like) are dropped too, so
 * every character is drawn with the font's own glyph for it, and a line's
 * width is exactly the sum of its characters' widths: measuring is adding,
 * not shaping, which is what keeps a 75 000-character Regulamin under a
 * second instead of five.
 *
 * A CHARACTER WITH NO GLYPH IS NEVER DRAWN AS AN EMPTY BOX WHERE THE TEXT
 * MEANS SOMETHING ELSE. Inter has no glyph for a tab, a soft hyphen or a
 * line separator, and a Word export carries all of them. Where the text is
 * drawn (never in the stored text) a tab, VT or FF is a breakable space — a
 * tab TAB_SPACES spaces wide, its first one a real space so a copy of the
 * text keeps the gap —, U+2028/U+2029 break the line inside the paragraph,
 * and the soft hyphen and the zero-width characters are not drawn at all
 * (lib/legal/pdf-coverage.ts lists them). Anything else the fonts lack (☐,
 * ✔, Word's Symbol bullet) is drawn as what the font has for it, the box:
 * no substitute glyph is made up, and the admin panel names those
 * characters (legalPdfUncovered) before anybody downloads the file. (The box
 * carries no text either — pdfkit maps .notdef to U+0000, which text
 * extraction drops — so those characters are also missing from a copy.)
 *
 * THE FONT IS INTER, EMBEDDED. The 14 standard PDF fonts cannot encode "ł",
 * "ę" or "⁵", and pdfkit falls back to its built-in Helvetica unless it is
 * given a font up front — so the Regular TTF is passed to the constructor and
 * both weights are embedded as CID TrueType subsets. The site's variable WOFF2
 * files are not used: pdfkit cannot read them. The two static TTFs and their
 * licence (SIL OFL 1.1) sit next to this module, outside public/, and are read
 * from disk at a path built at runtime, which is why next.config.mjs traces
 * them into the four PDF routes (outputFileTracingIncludes).
 *
 * The labels the PDF prints itself (footer, metadata) are in the DOCUMENT's
 * language, not the visitor's interface language, so they live in a small map
 * below rather than in the UI dictionaries.
 */

const FONT_DIR = "lib/server/legal/fonts";
export const LEGAL_PDF_FONT_FILES = {
  regular: `${FONT_DIR}/Inter-Regular.ttf`,
  semibold: `${FONT_DIR}/Inter-SemiBold.ttf`,
} as const;

const fontPath = (rel: string) => path.join(process.cwd(), rel);

export type LegalPdfInput = {
  text: string;
  /** The document's own version label ("1.0"); "" when it has none. */
  version: string;
  /** Effective date, YYYY-MM-DD, or null. */
  effective: string | null;
  /** The document's language (its text, its footer labels, /Lang). */
  locale: LegalLocale;
  /** The public page of the document; linked from the footer, named in the metadata. */
  sourceUrl: string;
};

type Labels = { version: string; page: string; of: string; effective: string };

const LABELS: Record<LegalLocale, Labels> = {
  pl: { version: "Wersja", page: "Strona", of: "z", effective: "obowiązuje od" },
  en: { version: "Version", page: "Page", of: "of", effective: "effective from" },
  de: { version: "Version", page: "Seite", of: "von", effective: "gültig ab" },
};

/** "2026-10-20" → "20.10.2026" (pl, de) or kept as ISO (en). */
function formatDate(iso: string, locale: LegalLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || locale === "en") return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** The footer line of page `page` of `pages` — exported so the test can find
 *  (and remove) exactly this line in the PDF's extracted text. */
export function legalPdfFooterText(title: string, version: string, page: number, pages: number, locale: LegalLocale): string {
  const l = LABELS[locale];
  const parts = title.trim() ? [title] : [];
  if (version.trim()) parts.push(`${l.version} ${version.trim()}`);
  parts.push(`${l.page} ${page} ${l.of} ${pages}`);
  return parts.join(" · ");
}

// ── Page geometry (points; A4 is 595.28 × 841.89) ──────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = { top: 56, bottom: 72, left: 56, right: 56 };
const CONTENT_W = PAGE_W - MARGIN.left - MARGIN.right;
const BOTTOM = PAGE_H - MARGIN.bottom;
/** Top of the footer's text line, inside the bottom margin. */
const FOOTER_Y = PAGE_H - 44;
/** Indentation of one nesting level of points. */
const DEPTH_STEP = 16;
/** Narrowest marker column of a numbered point ("1." and "10." line up). */
const MIN_MARKER_COL = 22;
/** Where a continuation line of a point starts (matches a depth-0 point's text). */
const CONTINUATION = 22;

// ── Colours: the site's ink / muted / line / accent tokens, for paper ─────
const INK = "#20162d";
const MUTED = "#645878";
const LINE = "#e7e0f3";
const LINK = "#b000ac";

type FontKey = "regular" | "semibold";
type Style = { font: FontKey; size: number; leading: number; color: string; before: number };

const STYLES = {
  title: { font: "semibold", size: 18, leading: 1.3, color: INK, before: 0 },
  meta: { font: "regular", size: 9.5, leading: 1.5, color: MUTED, before: 1 },
  h2: { font: "semibold", size: 13, leading: 1.35, color: INK, before: 10 },
  h3: { font: "semibold", size: 11, leading: 1.4, color: INK, before: 9 },
  body: { font: "regular", size: 10, leading: 1.5, color: INK, before: 3 },
  footer: { font: "regular", size: 8, leading: 1.3, color: MUTED, before: 0 },
} as const satisfies Record<string, Style>;

/** The space a blank source line leaves. */
const GAP = 5;
/** Extra room and the hairline above a chapter-level (h2) heading. */
const H2_RULE_ABOVE = 10;
const H2_RULE_BELOW = 8;
/** Space under a heading before its first line. */
const AFTER_HEADING = 3;

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Every feature fontkit applies to a left-to-right run by default, switched
 * off (see the header). Exported for the test that checks "measured width =
 * drawn width" line by line.
 */
export const LEGAL_PDF_FEATURES_OFF: Readonly<Partial<Record<PDFKit.Mixins.OpenTypeFeatures, false>>> = {
  rvrn: false, ltra: false, ltrm: false, frac: false, numr: false, dnom: false,
  ccmp: false, locl: false, rlig: false, mark: false, mkmk: false,
  calt: false, clig: false, liga: false, rclt: false, curs: false, kern: false,
};

/**
 * The switches as pdfkit's `features` option. pdfkit hands `features` to
 * fontkit's layout(), which takes either a list of features to add or an
 * object of on/off switches; only the object can switch one off, and
 * @types/pdfkit describes only the list.
 */
const TEXT_FEATURES = LEGAL_PDF_FEATURES_OFF as unknown as PDFKit.Mixins.OpenTypeFeatures[];

/** A cut of a node's text: [start, end) offsets into it. */
type Span = { start: number; end: number };

/** Where a line may break: a space, a tab, VT or FF (see legalPdfCharRole). */
const BREAKABLE = new RegExp(`[ ${legalPdfRoleClass(["space", "tab"])}]+`, "gu");
/** Where a line must break: the line and paragraph separators. */
const LINE_BREAK = new RegExp(`[${legalPdfRoleClass(["break"])}]`, "gu");

/**
 * Cut `text` into lines no wider than `width`, at spaces only — and at a
 * U+2028/U+2029, which always ends a line. The space (or separator) a line
 * breaks at is left out of both lines; every other character lands in
 * exactly one line, in order.
 */
export function wrapAtSpaces(text: string, width: number, measure: (s: string) => number): Span[] {
  const out: Span[] = [];
  let from = 0;
  const piece = (end: number) => {
    for (const l of wrapRun(text.slice(from, end), width, measure)) out.push({ start: from + l.start, end: from + l.end });
  };
  for (const m of text.matchAll(LINE_BREAK)) {
    const at = m.index ?? 0;
    piece(at);
    from = at + m[0].length;
  }
  piece(text.length);
  return out;
}

/** wrapAtSpaces for a text with no forced break in it. */
function wrapRun(text: string, width: number, measure: (s: string) => number): Span[] {
  if (text === "") return [{ start: 0, end: 0 }];
  const words: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(BREAKABLE)) {
    const at = m.index ?? 0;
    if (at > last) words.push({ start: last, end: at });
    last = at + m[0].length;
  }
  if (last < text.length) words.push({ start: last, end: text.length });
  if (words.length === 0) return [{ start: 0, end: text.length }];

  const lines: Span[] = [];
  let line: Span | null = null;
  for (const w of words) {
    if (line && measure(text.slice(line.start, w.end)) <= width) {
      line.end = w.end;
      continue;
    }
    if (line) lines.push(line);
    if (measure(text.slice(w.start, w.end)) <= width) {
      line = { start: w.start, end: w.end };
      continue;
    }
    // A word wider than the column: cut it between characters (code points,
    // so a surrogate pair is never split). No hyphen is added.
    let start = w.start;
    let end = start;
    for (const ch of text.slice(w.start, w.end)) {
      const next = end + ch.length;
      if (end > start && measure(text.slice(start, next)) > width) {
        lines.push({ start, end });
        start = end;
      }
      end = next;
    }
    line = { start, end };
  }
  if (line) lines.push(line);
  // Text before the first word and after the last one (leading/trailing
  // spaces) stays on the first/last line, invisible but not dropped.
  lines[0].start = 0;
  lines[lines.length - 1].end = text.length;
  return lines;
}

/** A link's place in a node's text. */
type LinkSpan = Span & { href: string };

function linkSpans(text: string): LinkSpan[] {
  const out: LinkSpan[] = [];
  let at = 0;
  for (const seg of splitLinks(text)) {
    if (seg.href) out.push({ start: at, end: at + seg.text.length, href: seg.href });
    at += seg.text.length;
  }
  return out;
}

/** The pieces of one line, each with the link it belongs to (if any). */
function lineSegments(text: string, line: Span, links: LinkSpan[]): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let at = line.start;
  for (const l of links) {
    if (l.end <= line.start || l.start >= line.end) continue;
    const s = Math.max(l.start, line.start);
    const e = Math.min(l.end, line.end);
    if (s > at) out.push({ text: text.slice(at, s) });
    out.push({ text: text.slice(s, e), href: l.href });
    at = e;
  }
  if (at < line.end) out.push({ text: text.slice(at, line.end) });
  return out;
}

/** A node, measured: its lines, where they start, and the space it needs. */
type Block = {
  node: LegalNode;
  style: Style;
  /** The text the lines cut (a point's text WITHOUT its marker). */
  text: string;
  lines: Span[];
  /** x of the lines' text, relative to the left margin. */
  x: number;
  /** A point's marker, drawn in its own column on the first line. */
  marker?: { text: string; x: number; color: string };
  links: LinkSpan[];
};

function advance(style: Style): number {
  return style.size * style.leading;
}

function useStyle(doc: Doc, style: Style): void {
  doc.font(fontPath(LEGAL_PDF_FONT_FILES[style.font])).fontSize(style.size);
}

/** Width of `s` in the current font and size, laid out as it is drawn — for
 *  a string handed to doc.text as it is (drawnWidth for a piece of the text). */
function widthOf(doc: Doc, s: string): number {
  return doc.widthOfString(s, { features: TEXT_FEATURES });
}

/** How wide a tab is drawn, in spaces. */
const TAB_SPACES = 4;

/** The width one character of the text takes on paper (see drawText). */
function charWidth(doc: Doc, ch: string): number {
  switch (legalPdfCharRole(ch)) {
    case "tab": return TAB_SPACES * widthOf(doc, " ");
    case "space":
    case "break": return widthOf(doc, " ");
    case "hidden": return 0;
    default: return widthOf(doc, ch);
  }
}

/** The width a piece of the text takes on paper, drawn with drawText. */
function drawnWidth(doc: Doc, s: string): number {
  if (!LEGAL_PDF_ROLE_CHARS.test(s)) return widthOf(doc, s);
  let total = 0;
  for (const ch of s) total += charWidth(doc, ch);
  return total;
}

type DrawExtra = { link?: string; underline?: boolean };

/**
 * Draw a piece of the text from (x, top) in the current font, size and
 * colour: every character as itself, except those legalPdfCharRole names —
 * a hidden one is left out, a VT or FF (or a separator that reaches the
 * footer) is a space, and a tab is a space followed by the rest of its
 * width as empty room. So a glyph the font does not have is never laid out
 * for any of them, and the PDF's text keeps the gap a tab makes.
 */
function drawText(doc: Doc, s: string, x: number, top: number, extra: DrawExtra): void {
  const options = { lineBreak: false, features: TEXT_FEATURES, ...extra };
  if (!LEGAL_PDF_ROLE_CHARS.test(s)) {
    doc.text(s, x, top, options);
    return;
  }
  let at = x;
  let run = "";
  for (const ch of s) {
    const role = legalPdfCharRole(ch);
    if (role === "hidden") continue;
    if (role !== "tab") {
      run += role === null ? ch : " ";
      continue;
    }
    run += " ";
    doc.text(run, at, top, options);
    at += widthOf(doc, run) + charWidth(doc, ch) - widthOf(doc, " ");
    run = "";
  }
  if (run !== "") doc.text(run, at, top, options);
}

/**
 * Measuring for one render. With no feature applied a string's width is the
 * sum of its characters' widths, so each character is measured once per style
 * and a line is a sum — line-breaking measures every candidate line, and
 * laying each one out would be the bulk of the render. A character is
 * measured as it is drawn (charWidth: a tab as its gap, a hidden one as 0).
 */
type Measurer = (style: Style) => (s: string) => number;

function measurer(doc: Doc): Measurer {
  const widths = new Map<string, number>();
  return (style) => (s) => {
    let total = 0;
    for (const ch of s) {
      const key = `${style.font}|${style.size}|${ch}`;
      let w = widths.get(key);
      if (w === undefined) {
        useStyle(doc, style);
        w = charWidth(doc, ch);
        widths.set(key, w);
      }
      total += w;
    }
    return total;
  };
}

function styleOf(node: LegalNode): Style {
  switch (node.kind) {
    case "title": return STYLES.title;
    case "meta": return STYLES.meta;
    case "heading": return node.level === 2 ? STYLES.h2 : STYLES.h3;
    default: return STYLES.body;
  }
}

function measureBlock(measureIn: Measurer, node: LegalNode): Block | null {
  if (node.kind === "gap") return null;
  const style = styleOf(node);
  const measure = measureIn(style);
  let x = 0;
  let marker: Block["marker"];
  if (node.kind === "item") {
    const indent = node.depth * DEPTH_STEP;
    const markerW = measure(node.marker);
    const col = node.bullet ? markerW + 7 : Math.max(MIN_MARKER_COL, markerW + 6);
    marker = { text: node.marker, x: indent, color: node.bullet ? LINK : MUTED };
    x = indent + col;
  } else if (node.kind === "para" && node.indent > 0) {
    x = Math.floor(node.indent / 4) * DEPTH_STEP + CONTINUATION;
  }
  const text = node.kind === "item" ? node.text : nodeText(node);
  const width = Math.max(CONTENT_W - x, 40);
  return { node, style, text, lines: wrapAtSpaces(text, width, measure), x, marker, links: linkSpans(text) };
}

/** Space a block takes above its first line (its gap to the previous node). */
function spaceAbove(block: Block): number {
  const extra = block.node.kind === "heading" && block.node.level === 2 ? H2_RULE_ABOVE + H2_RULE_BELOW : 0;
  return block.style.before + extra;
}

class Writer {
  y = MARGIN.top;
  private h2Outline: ReturnType<Doc["outline"]["addItem"]> | null = null;

  constructor(private readonly doc: Doc) {}

  private atTop(): boolean {
    return this.y <= MARGIN.top + 0.01;
  }

  newPage(): void {
    this.doc.addPage();
    this.y = MARGIN.top;
  }

  gap(): void {
    if (!this.atTop()) this.y += GAP;
  }

  /** Before a heading: is there room for it AND the first two lines of what
   *  follows? If not, the heading starts the next page (no orphan heading). */
  keepWithNext(heading: Block, next: Block | null): void {
    if (this.atTop()) return;
    let need = spaceAbove(heading) + heading.lines.length * advance(heading.style) + AFTER_HEADING;
    if (next) need += spaceAbove(next) + Math.min(2, next.lines.length) * advance(next.style);
    if (this.y + need > BOTTOM) this.newPage();
  }

  block(b: Block): void {
    const doc = this.doc;
    const lineH = advance(b.style);
    if (!this.atTop()) {
      if (b.node.kind === "heading" && b.node.level === 2) {
        this.y += b.style.before + H2_RULE_ABOVE;
        if (this.y + H2_RULE_BELOW + lineH <= BOTTOM) {
          doc.save().moveTo(MARGIN.left, this.y).lineTo(PAGE_W - MARGIN.right, this.y)
            .lineWidth(0.6).strokeColor(LINE).stroke().restore();
        }
        this.y += H2_RULE_BELOW;
      } else {
        this.y += b.style.before;
      }
    }
    useStyle(doc, b.style);
    // The glyph box (ascender to descender) sits in the middle of the line.
    const halfLeading = (lineH - doc.currentLineHeight()) / 2;
    b.lines.forEach((line, i) => {
      if (this.y + lineH > BOTTOM) this.newPage();
      const top = this.y + halfLeading;
      if (i === 0) this.anchor(b, top);
      if (i === 0 && b.marker) {
        useStyle(doc, b.style);
        doc.fillColor(b.marker.color).text(b.marker.text, MARGIN.left + b.marker.x, top, { lineBreak: false, features: TEXT_FEATURES });
      }
      this.line(b, line, MARGIN.left + b.x, top);
      this.y += lineH;
    });
    if (b.node.kind === "heading") this.y += AFTER_HEADING;
  }

  /** A heading becomes a bookmark (h3 under its h2) and a named destination. */
  private anchor(b: Block, top: number): void {
    if (b.node.kind !== "heading") return;
    const doc = this.doc;
    doc.addNamedDestination(b.node.id, "XYZ", MARGIN.left, PAGE_H - top, null);
    if (b.node.level === 2 || !this.h2Outline) {
      const item = doc.outline.addItem(b.node.text);
      if (b.node.level === 2) this.h2Outline = item;
    } else {
      this.h2Outline.addItem(b.node.text);
    }
  }

  /** One line, in pieces only where a link starts or ends. */
  private line(b: Block, line: Span, x0: number, top: number): void {
    const doc = this.doc;
    const segs = lineSegments(b.text, line, b.links).filter((s) => s.text !== "");
    let x = x0;
    segs.forEach((seg, k) => {
      useStyle(doc, b.style);
      doc.fillColor(seg.href ? LINK : b.style.color);
      drawText(doc, seg.text, x, top, seg.href ? { link: seg.href, underline: true } : {});
      if (k < segs.length - 1) x += drawnWidth(doc, seg.text);
    });
  }
}

function footer(doc: Doc, text: string, sourceUrl: string): void {
  const style = STYLES.footer;
  useStyle(doc, style);
  const width = drawnWidth(doc, text);
  doc.save().moveTo(MARGIN.left, FOOTER_Y - 8).lineTo(PAGE_W - MARGIN.right, FOOTER_Y - 8)
    .lineWidth(0.5).strokeColor(LINE).stroke().restore();
  doc.fillColor(style.color);
  drawText(doc, text, MARGIN.left + Math.max(0, (CONTENT_W - width) / 2), FOOTER_Y, sourceUrl ? { link: sourceUrl } : {});
}

/** The footer's title, shortened with "…" only if the line would not fit. */
function fittedFooter(doc: Doc, title: string, version: string, page: number, pages: number, locale: LegalLocale): string {
  useStyle(doc, STYLES.footer);
  let text = legalPdfFooterText(title, version, page, pages, locale);
  if (drawnWidth(doc, text) <= CONTENT_W) return text;
  const chars = Array.from(title);
  while (chars.length > 1) {
    chars.pop();
    text = legalPdfFooterText(`${chars.join("").trimEnd()}…`, version, page, pages, locale);
    if (drawnWidth(doc, text) <= CONTENT_W) break;
  }
  return text;
}

/**
 * Render the document. With an effective date the output is deterministic —
 * the same input gives the same bytes — so a cached copy and a fresh one are
 * interchangeable.
 */
export function renderLegalPdf(input: LegalPdfInput): Promise<Buffer> {
  const outline = parseLegalText(input.text);
  const title = outline.title ?? "";
  const labels = LABELS[input.locale];
  const version = input.version.trim();
  // The file's dates (and the file ID pdfkit derives from them) are the
  // version's effective date; without one, pdfkit's "now" stands.
  const stamp = input.effective && /^\d{4}-\d{2}-\d{2}$/.test(input.effective)
    ? new Date(`${input.effective}T00:00:00Z`)
    : null;
  const subject = [
    version ? `${labels.version} ${version}` : "",
    input.effective ? `${labels.effective} ${formatDate(input.effective, input.locale)}` : "",
    input.sourceUrl,
  ].filter(Boolean).join(" · ");

  return new Promise<Buffer>((resolve, reject) => {
    let doc: Doc;
    try {
      doc = new PDFDocument({
        size: "A4",
        margins: MARGIN,
        // Without a font here pdfkit loads its built-in Helvetica, which
        // cannot encode Polish and is not part of the traced function.
        font: fontPath(LEGAL_PDF_FONT_FILES.regular),
        bufferPages: true,
        autoFirstPage: true,
        lang: input.locale,
        displayTitle: true,
        pdfVersion: "1.7",
        info: {
          Title: title,
          Author: "GrovBase",
          Subject: subject,
          Creator: "GrovBase",
          ...(stamp ? { CreationDate: stamp, ModDate: stamp } : {}),
        },
      });
    } catch (e) {
      reject(e);
      return;
    }
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const measureIn = measurer(doc);
      const blocks = outline.nodes.map((n) => measureBlock(measureIn, n));
      const w = new Writer(doc);
      blocks.forEach((b, i) => {
        if (!b) { w.gap(); return; }
        if (b.node.kind === "heading") {
          const next = blocks.slice(i + 1).find((x): x is Block => x !== null) ?? null;
          w.keepWithNext(b, next);
        }
        w.block(b);
      });

      const range = doc.bufferedPageRange();
      for (let p = 0; p < range.count; p += 1) {
        doc.switchToPage(range.start + p);
        footer(doc, fittedFooter(doc, title, version, p + 1, range.count, input.locale), input.sourceUrl);
      }
      doc.flushPages();
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
