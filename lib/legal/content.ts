import { LEGAL_LOCALES, type LegalLocale } from "./docs";

/**
 * A LEGAL DOCUMENT AS THE CMS STORES IT — the `doc` field of a `legal` section.
 *
 *   content.doc = {
 *     pl: { status: "active", text: "<the whole document>", version: "1.0", effective: "2026-10-20", sha256, chars },
 *     en: { status: "soon",   text: "", version: "", effective: null },
 *     de: { status: "soon",   text: "", version: "", effective: null },
 *   }
 *
 * THE TEXT IS STORED EXACTLY AS IT WAS GIVEN. The only changes ever made to
 * it are technical: line endings become "\n" and a leading byte-order mark is
 * dropped (normalizeLegalText). No trimming, no whitespace folding, no
 * "smart" quotes, no length cap short of the size guard below — the page, the
 * PDF and the comparison test all read this one string.
 *
 * Each language has its own status, text, version and effective date. A
 * language marked "soon" shows visitors a notice and a link to the binding
 * Polish text — never a machine translation, never the Polish text dressed up
 * as another language.
 *
 * sha256 and chars are written by the server on every save (they describe
 * the text, the client cannot set them) and shown in the admin, so anybody
 * can check a published document against its source file.
 */

export type LegalStatus = "active" | "soon";

export type LegalLocaleDoc = {
  status: LegalStatus;
  text: string;
  /** The document's own version label, e.g. "1.0". */
  version: string;
  /** Effective date, YYYY-MM-DD, or null. */
  effective: string | null;
  /** Server-computed: sha256 of the UTF-8 text, hex. */
  sha256?: string;
  /** Server-computed: number of characters (code points) of the text. */
  chars?: number;
};

export type LegalDocContent = Record<LegalLocale, LegalLocaleDoc>;

/** Per language. A 75 000-character Regulamin is a quarter of it. */
export const MAX_LEGAL_CHARS = 1_000_000;
/** All languages together: the builder sends the whole section on every
 *  save and a server action body is capped at 4.5 MB (next.config.mjs). */
export const MAX_LEGAL_TOTAL_CHARS = 1_400_000;
export const MAX_LEGAL_VERSION = 32;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyLocaleDoc(status: LegalStatus = "soon"): LegalLocaleDoc {
  return { status, text: "", version: "", effective: null };
}

/** The only normalisation a legal text ever gets: line endings and a BOM. */
export function normalizeLegalText(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

/** Characters as a reader counts them (code points, so "§" and "ą" are one). */
export function legalCharCount(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

function readLocale(raw: unknown): LegalLocaleDoc {
  if (!raw || typeof raw !== "object") return emptyLocaleDoc();
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text : "";
  return {
    status: r.status === "active" ? "active" : "soon",
    text,
    version: typeof r.version === "string" ? r.version : "",
    effective: validDate(r.effective),
    ...(typeof r.sha256 === "string" && /^[0-9a-f]{64}$/.test(r.sha256) ? { sha256: r.sha256 } : {}),
    ...(typeof r.chars === "number" && Number.isInteger(r.chars) && r.chars >= 0 ? { chars: r.chars } : {}),
  };
}

/**
 * The `doc` field of a section's content, read leniently, or null when the
 * section is not a document (an old `legal` section with html/description).
 */
export function readLegalDoc(content: unknown): LegalDocContent | null {
  if (!content || typeof content !== "object") return null;
  const doc = (content as { doc?: unknown }).doc;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  const out = {} as LegalDocContent;
  for (const l of LEGAL_LOCALES) out[l] = readLocale(d[l]);
  return out;
}

export type LegalDocProblem =
  | "doc_missing"
  | "doc_status"
  | "doc_version"
  | "doc_date"
  | "doc_empty_active"
  | "doc_too_long"
  | "doc_nul";

/**
 * What the server accepts from the editor. Returns the cleaned document
 * (normalised line endings, statuses/versions/dates validated) WITHOUT the
 * server-computed fields — the caller adds sha256/chars.
 */
export function cleanLegalDocInput(raw: unknown):
  | { ok: true; doc: LegalDocContent }
  | { ok: false; error: LegalDocProblem; locale?: LegalLocale } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "doc_missing" };
  const r = raw as Record<string, unknown>;
  const out = {} as LegalDocContent;
  let total = 0;
  for (const l of LEGAL_LOCALES) {
    const item = (r[l] && typeof r[l] === "object" ? r[l] : {}) as Record<string, unknown>;
    const status = item.status === undefined ? "soon" : item.status;
    if (status !== "active" && status !== "soon") return { ok: false, error: "doc_status", locale: l };
    const text = normalizeLegalText(typeof item.text === "string" ? item.text : "");
    if (text.includes("\u0000")) return { ok: false, error: "doc_nul", locale: l };
    const chars = legalCharCount(text);
    if (chars > MAX_LEGAL_CHARS) return { ok: false, error: "doc_too_long", locale: l };
    total += chars;
    const version = typeof item.version === "string" ? item.version.trim() : "";
    if (version.length > MAX_LEGAL_VERSION) return { ok: false, error: "doc_version", locale: l };
    const effectiveRaw = item.effective;
    const effective = effectiveRaw === null || effectiveRaw === undefined || effectiveRaw === ""
      ? null : validDate(effectiveRaw);
    if (effectiveRaw && !effective) return { ok: false, error: "doc_date", locale: l };
    if (status === "active" && text.trim() === "") return { ok: false, error: "doc_empty_active", locale: l };
    out[l] = { status, text, version, effective };
  }
  if (total > MAX_LEGAL_TOTAL_CHARS) return { ok: false, error: "doc_too_long" };
  return { ok: true, doc: out };
}

/**
 * Which text a visitor in `locale` reads. A language that is active shows
 * its own text; one that is "soon" (or active with no text — impossible
 * after cleanLegalDocInput, tolerated here) shows a notice that points at the
 * Polish text. `forcePolish` is the "read the Polish version" link.
 */
export function legalViewFor(doc: LegalDocContent, locale: string, forcePolish = false):
  | { mode: "doc"; locale: LegalLocale; entry: LegalLocaleDoc; fallbackFrom: LegalLocale | null }
  | { mode: "soon"; locale: LegalLocale; polish: LegalLocaleDoc | null } {
  const want: LegalLocale = (LEGAL_LOCALES as readonly string[]).includes(locale) ? (locale as LegalLocale) : "pl";
  const polish = doc.pl.status === "active" && doc.pl.text.trim() ? doc.pl : null;
  if (forcePolish && polish) return { mode: "doc", locale: "pl", entry: polish, fallbackFrom: want === "pl" ? null : want };
  const own = doc[want];
  if (own.status === "active" && own.text.trim()) return { mode: "doc", locale: want, entry: own, fallbackFrom: null };
  if (want === "pl") return polish ? { mode: "doc", locale: "pl", entry: polish, fallbackFrom: null } : { mode: "soon", locale: "pl", polish: null };
  return { mode: "soon", locale: want, polish };
}

const PL_MONTHS = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/**
 * The version and effective date a document states about itself in its own
 * header ("Wersja: 1.0", "Data wejścia w życie: 20 października 2026 r.").
 * Used to pre-fill the editor's fields; the fields remain the admin's.
 */
export function legalHeaderFacts(text: string): { version: string | null; effective: string | null } {
  const head = text.split("\n").slice(0, 40);
  let version: string | null = null;
  let effective: string | null = null;
  for (const line of head) {
    const v = /^\s*Wersja:\s*(\S.{0,30}?)\s*$/.exec(line);
    if (v && !version) version = v[1];
    const d = /^\s*Data wejścia w życie:\s*(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i.exec(line);
    if (d && !effective) {
      const month = PL_MONTHS.indexOf(d[2].toLowerCase());
      if (month >= 0) {
        effective = `${d[3]}-${String(month + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`;
      }
    }
  }
  return { version, effective: validDate(effective) };
}
