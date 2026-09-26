import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * PDF → KNOWLEDGE CANDIDATES. Parse only; nothing here saves or trusts.
 *
 * Uses the pdf.js build that already ships inside `pdf-parse` (no new
 * dependency): page text through getTextContent, decoded page images through
 * the operator list (JPEG and Flate images alike), re-encoded with sharp.
 *
 * EVERYTHING EXTRACTED IS UNTRUSTED DATA. A line in a PDF that says "ignore
 * all previous instructions" is stored as the text of a candidate example and
 * shown to an admin; it is never executed, never becomes a system prompt and
 * never reaches retrieval before an admin approves it. Every candidate this
 * module produces is saved as `pending`.
 *
 * Pairing is a heuristic and says so: each candidate carries a confidence,
 * and anything the heuristic is unsure about is still only a candidate.
 */

export const PDF_MAX_IMAGE_PIXELS = 4096 * 4096;
export const PDF_LIMITS = { maxPages: 60, maxImages: 80, minSide: 64, maxSide: 2048 };

export type PdfImage = { jpeg: Buffer; width: number; height: number };
export type PdfPageData = { page: number; text: string; images: PdfImage[] };

export type PdfCandidate = {
  page: number;
  before: PdfImage | null;
  after: PdfImage | null;
  prompt: string | null;
  scene: string | null;
  category: string | null;
  tags: string[];
  /** 0–1: how sure the pairing and field extraction are. */
  confidence: number;
};

async function toJpeg(img: { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray }): Promise<PdfImage | null> {
  // kind 2 = RGB 24bpp, 3 = RGBA 32bpp. 1bpp masks carry no photograph.
  const channels = img.kind === 2 ? 3 : img.kind === 3 ? 4 : 0;
  if (!channels || img.width < PDF_LIMITS.minSide || img.height < PDF_LIMITS.minSide) return null;
  if (img.data.length < img.width * img.height * channels) return null;
  try {
    const out = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.width * img.height * channels), {
      raw: { width: img.width, height: img.height, channels },
    })
      .resize({ width: PDF_LIMITS.maxSide, height: PDF_LIMITS.maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: out.data, width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

/** Group text items into lines by their baseline, top to bottom. */
function pageText(items: { str: string; transform: number[] }[]): string {
  const lines = new Map<number, string[]>();
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const y = Math.round((it.transform?.[5] ?? 0) / 3);
    const list = lines.get(y) ?? [];
    list.push(it.str);
    lines.set(y, list);
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.join(" ").trim()).join("\n");
}

export async function readPdf(data: Buffer): Promise<{ pages: PdfPageData[]; numPages: number }> {
  const { default: PDFJS } = await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
  // pdf.js 1.10 reads its settings from its GLOBAL settings object
  // (`PDFJS.PDFJS`, the same object as globalThis.PDFJS) — not from the module
  // export and not from getDocument's options. No eval/new Function, no font
  // compilation, and no image larger than 4096×4096 decoded at all (a tiny PDF
  // can declare a gigapixel image).
  const settings = PDFJS.PDFJS;
  settings.disableWorker = true;
  settings.isEvalSupported = false;
  settings.disableFontFace = true;
  settings.maxImageSize = PDF_MAX_IMAGE_PIXELS;
  const doc = await PDFJS.getDocument({
    data: new Uint8Array(data), nativeImageDecoderSupport: "none", disableFontFace: true, isEvalSupported: false,
  });
  const imageOps = new Set([PDFJS.OPS.paintImageXObject, PDFJS.OPS.paintJpegXObject, PDFJS.OPS.paintInlineImageXObject]);
  const pages: PdfPageData[] = [];
  let imageCount = 0;
  try {
    for (let n = 1; n <= Math.min(doc.numPages, PDF_LIMITS.maxPages); n++) {
      const page = await doc.getPage(n);
      const text = pageText((await page.getTextContent()).items).slice(0, 8000);
      const images: PdfImage[] = [];
      // One XObject painted twice is one photo, not two.
      const seenRefs = new Set<string>();
      if (imageCount < PDF_LIMITS.maxImages) {
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length && imageCount < PDF_LIMITS.maxImages; i++) {
          if (!imageOps.has(ops.fnArray[i])) continue;
          const ref = ops.argsArray[i]?.[0];
          if (typeof ref === "string") {
            if (seenRefs.has(ref)) continue;
            seenRefs.add(ref);
          }
          const decoded = typeof ref === "string"
            ? await new Promise<{ width: number; height: number; kind: number; data: Uint8Array } | null>((resolve) => {
                const timer = setTimeout(() => resolve(null), 5000);
                page.objs.get(ref, (img) => { clearTimeout(timer); resolve(img as never); });
              })
            : (ref as { width: number; height: number; kind: number; data: Uint8Array } | undefined) ?? null;
          if (!decoded?.data) continue;
          const jpeg = await toJpeg(decoded);
          if (jpeg) { images.push(jpeg); imageCount++; }
        }
      }
      pages.push({ page: n, text, images });
      page.cleanup();
    }
    return { pages: dropDecorations(pages), numPages: doc.numPages };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/** An identical image on at least three pages and on most of them is a logo
 *  or a banner, not an example: it would otherwise pair with the real photo. */
function dropDecorations(pages: PdfPageData[]): PdfPageData[] {
  const key = (img: PdfImage) => createHash("sha1").update(img.jpeg).digest("hex");
  const onPages = new Map<string, number>();
  for (const p of pages) for (const k of new Set(p.images.map(key))) onPages.set(k, (onPages.get(k) ?? 0) + 1);
  const deco = new Set([...onPages].filter(([, n]) => n >= 3 && n > pages.length / 2).map(([k]) => k));
  if (deco.size === 0) return pages;
  return pages.map((p) => ({ ...p, images: p.images.filter((img) => !deco.has(key(img))) }));
}

const LABELS = "prompt|scena|scene|kategoria|category|tagi|tags|przed|before|po|after|notatki|notes";

/** The text after `Label:` up to the next known label, or null. */
export function labelled(text: string, names: string[]): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*(?:${names.join("|")})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${LABELS})\\s*[:：]|$)`, "i");
  const m = text.match(re);
  const v = m?.[1]?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, 4000) : null;
}

// A label, not a word in a sentence: upper-case (PRZED / PO) or followed by
// a colon ("Po:"). "po lewej" in a scene description is not a label.
function mentionsBefore(text: string) { return /\b(PRZED|BEFORE)\b/.test(text) || /\b(przed|before)\s*[:：]/i.test(text); }
function mentionsAfter(text: string) { return /\b(PO|AFTER)\b/.test(text) || /\b(po|after)\s*[:：]/i.test(text); }

const round = (n: number) => Math.round(Math.min(Math.max(n, 0), 1) * 1000) / 1000;

/**
 * Turn pages into candidates. The rules, most confident first:
 *   a page with two images            → before = first, after = second
 *   two consecutive one-image pages,
 *   labelled PRZED then PO            → one pair across the pages
 *   a page with one image             → an unpaired candidate (low confidence)
 *   a page with only a Prompt:/Scena: → a text-only candidate
 */
export function extractCandidates(pages: PdfPageData[]): PdfCandidate[] {
  const out: PdfCandidate[] = [];
  const fields = (text: string) => {
    const tags = labelled(text, ["tagi", "tags"]);
    return {
      prompt: labelled(text, ["prompt"]),
      scene: labelled(text, ["scena", "scene"]),
      category: labelled(text, ["kategoria", "category"])?.slice(0, 120) ?? null,
      tags: tags ? tags.split(/[,;#]/).map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 10) : [],
    };
  };
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const f = fields(p.text);
    const fieldBonus = (f.prompt ? 0.1 : 0) + (f.scene ? 0.05 : 0);
    const labelled2 = mentionsBefore(p.text) && mentionsAfter(p.text);
    if (p.images.length >= 2) {
      for (let k = 0; k + 1 < p.images.length && k < 6; k += 2) {
        const base = p.images.length === 2 ? 0.5 : 0.35;
        out.push({ page: p.page, before: p.images[k], after: p.images[k + 1], ...f,
          confidence: round(base + (labelled2 ? 0.3 : 0) + fieldBonus) });
      }
      continue;
    }
    if (p.images.length === 1) {
      const next = pages[i + 1];
      if (next && next.images.length === 1 && mentionsBefore(p.text) && mentionsAfter(next.text)) {
        const nf = fields(next.text);
        out.push({
          page: p.page, before: p.images[0], after: next.images[0],
          prompt: f.prompt ?? nf.prompt, scene: f.scene ?? nf.scene,
          category: f.category ?? nf.category, tags: [...new Set([...f.tags, ...nf.tags])].slice(0, 10),
          confidence: round(0.6 + fieldBonus),
        });
        i++;
        continue;
      }
      const isAfter = mentionsAfter(p.text) && !mentionsBefore(p.text);
      out.push({ page: p.page, before: isAfter ? null : p.images[0], after: isAfter ? p.images[0] : null, ...f,
        confidence: round(0.2 + fieldBonus) });
      continue;
    }
    if (f.prompt || f.scene) out.push({ page: p.page, before: null, after: null, ...f, confidence: round(0.3 + fieldBonus) });
  }
  return out;
}
