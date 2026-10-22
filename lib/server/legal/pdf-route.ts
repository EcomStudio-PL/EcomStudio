import "server-only";
import { isLegalLocale, LEGAL_DOCS, LEGAL_LOCALES, legalDoc, type LegalLocale } from "@/lib/legal/docs";
import { SITE_URL } from "@/lib/site";
import { getPublishedLegal, legalPdfTag, legalSha256, type PublishedLegal } from "./published";
import { renderLegalPdf, type LegalPdfInput } from "./pdf";

/**
 * GET /<slug>/pdf — THE PUBLISHED DOCUMENT AS A DOWNLOAD.
 *
 *   /regulamin/pdf                    the Polish text, as published now
 *   /regulamin/pdf?v=<12-hex tag>     the same, cacheable for a year when the
 *                                     tag is the current one (legalPdfTag: the
 *                                     text, version, date and language — any
 *                                     change is a new tag, so a new URL)
 *   /regulamin/pdf?lang=en            a language whose status is "active";
 *                                     a "soon" language has no PDF (404)
 *
 * The text comes from getPublishedLegal — the reader the public page uses —
 * so the page and the PDF cannot disagree. Nothing here is behind a login: the
 * documents are public, which is also why the routes live outside app/api.
 *
 * A warm instance keeps the last few PDFs (a Regulamin takes a moment to lay
 * out); the key is the text's digest plus everything else printed in the
 * file, so a corrected version label is never served from an old copy.
 * Failures answer a plain 404/503 — never a stack trace.
 */

/** The `?lang=` value: absent → Polish; anything not a document language → null. */
export function legalPdfLang(raw: string | null): LegalLocale | null {
  if (raw === null || raw === "") return "pl";
  const v = raw.trim().toLowerCase();
  return isLegalLocale(v) ? v : null;
}

const TAG = /^[0-9a-f]{12}$/;

/** Year-long and immutable only for the URL that names the current text. */
export function legalPdfCacheControl(requestedTag: string | null, currentTag: string): string {
  return requestedTag !== null && TAG.test(requestedTag) && requestedTag === currentTag
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, s-maxage=60, must-revalidate";
}

export function legalPdfEtag(tag: string, lang: LegalLocale): string {
  return `"${tag}-${lang}"`;
}

/** If-None-Match against our (strong) ETag: a list, "*", or a weak form. */
export function legalPdfEtagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((raw) => {
    const v = raw.trim();
    return v === "*" || v === etag || v === `W/${etag}`;
  });
}

const FOLD: Record<string, string> = { ł: "l", Ł: "L" };

/** The version label as a file-name piece: "1.0" stays "1.0", a leading "v"
 *  is not doubled, anything that is not a letter, digit, "." or "-" becomes
 *  "_". `ascii` also folds diacritics (for the plain filename parameter). */
function versionPart(version: string, ascii: boolean): string {
  let v = version.trim().replace(/^v(?=\d)/i, "");
  if (ascii) v = v.replace(/[łŁ]/g, (c) => FOLD[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  v = v.replace(ascii ? /[^0-9A-Za-z.-]+/g : /[^\p{L}\p{N}.-]+/gu, "_").replace(/^[._]+|[._]+$/g, "");
  return v.slice(0, 32);
}

/** "Regulamin_GrovBase_v1.0.pdf"; another language gets its code ("…_v1.0_EN.pdf"). */
export function legalPdfFileName(pdfName: string, version: string, lang: LegalLocale): { ascii: string; utf8: string } {
  const suffix = lang === "pl" ? "" : `_${lang.toUpperCase()}`;
  const make = (ascii: boolean) => {
    const v = versionPart(version, ascii);
    return `${pdfName}${v ? `_v${v}` : ""}${suffix}.pdf`;
  };
  return { ascii: make(true), utf8: make(false) };
}

/** RFC 6266 / 5987: a quoted ASCII name for old clients, filename* for the rest. */
export function legalPdfDisposition(pdfName: string, version: string, lang: LegalLocale): string {
  const { ascii, utf8 } = legalPdfFileName(pdfName, version, lang);
  const encoded = encodeURIComponent(utf8).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ── A small per-instance LRU of rendered PDFs ──────────────────────────────
// Room for every document in every language twice over (the published text
// and the one just replaced), so a crawler walking all of them evicts nothing.
const CACHE_MAX = LEGAL_DOCS.length * LEGAL_LOCALES.length * 2;
const rendered = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

function cachedPdf(key: string, render: () => Promise<Buffer>): Promise<Uint8Array<ArrayBuffer>> {
  const hit = rendered.get(key);
  if (hit) {
    rendered.delete(key);
    rendered.set(key, hit);
    return hit;
  }
  const job = render().then((b) => new Uint8Array(b));
  rendered.set(key, job);
  // A failed render is not remembered: the next request tries again.
  job.catch(() => { if (rendered.get(key) === job) rendered.delete(key); });
  while (rendered.size > CACHE_MAX) {
    const oldest = rendered.keys().next();
    if (oldest.done) break;
    rendered.delete(oldest.value);
  }
  return job;
}

export type LegalPdfDeps = {
  load: (slug: string) => Promise<PublishedLegal>;
  render: (input: LegalPdfInput) => Promise<Buffer>;
};

const DEFAULT_DEPS: LegalPdfDeps = { load: getPublishedLegal, render: renderLegalPdf };

function plain(status: 404 | 503): Response {
  return new Response(status === 404 ? "Not Found" : "Service Unavailable", {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * The whole route. `deps` exists for the test suite (a fixture document and a
 * counting renderer); the route files pass only the request and the slug.
 */
export async function legalPdfResponse(request: Request, slug: string, deps: Partial<LegalPdfDeps> = {}): Promise<Response> {
  const { load, render } = { ...DEFAULT_DEPS, ...deps };
  try {
    const def = legalDoc(slug);
    if (!def) return plain(404);
    const url = new URL(request.url);
    const lang = legalPdfLang(url.searchParams.get("lang"));
    if (!lang) return plain(404);

    const { page, doc } = await load(slug);
    const entry = page && doc ? doc[lang] : null;
    if (!entry || entry.status !== "active" || entry.text.trim() === "") return plain(404);

    const tag = legalPdfTag(entry, lang);
    const etag = legalPdfEtag(tag, lang);
    const headers: Record<string, string> = {
      ETag: etag,
      "Cache-Control": legalPdfCacheControl(url.searchParams.get("v"), tag),
      "X-Robots-Tag": "noindex",
    };
    if (legalPdfEtagMatches(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    const input: LegalPdfInput = {
      text: entry.text,
      version: entry.version,
      effective: entry.effective,
      locale: lang,
      sourceUrl: `${SITE_URL}/${slug}`,
    };
    const key = [legalSha256(entry.text), lang, entry.version, entry.effective ?? "", input.sourceUrl].join("|");
    const bytes = await cachedPdf(key, () => render(input));
    return new Response(bytes, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": legalPdfDisposition(def.pdfName, entry.version, lang),
      },
    });
  } catch (e) {
    console.error("legal pdf: render failed", slug, e instanceof Error ? e.message : e);
    return plain(503);
  }
}
