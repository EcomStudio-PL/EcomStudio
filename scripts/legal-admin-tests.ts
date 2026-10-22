/**
 * LEGAL DOCUMENTS IN THE ADMIN — npm run test:legaladmin
 *
 *   A  cleanLegalDocInput: what the server accepts from the editor — line
 *      endings and a BOM normalised and NOTHING else, every refusal with the
 *      language it is in, 250 000 characters through unchanged, 1 000 001 not
 *   B  the digests: the server writes sha256/chars per language (the four
 *      source files hash to the owner's uploads), a browser's own values are
 *      replaced, a section without a doc is stored as it came
 *   C  the schema: a `legal` section is ONE `legaldoc` field the generic
 *      read/write path never touches
 *   D  the download route's pure helpers: locale/source parsing, the file
 *      name, the headers
 *   E  the download route itself over a fake database: 401 / 403 / step-up,
 *      400 / 404, and the bytes — identical to the source file
 *   F  saveBlockAction (app/actions/cms.ts) over a fake database: the stored
 *      document carries the server's digests; a refusal writes nothing
 *   G  the /admin/www overview and the history facts
 *   H  static: the editor has no length cap of its own, reads files as UTF-8,
 *      and is what the builder draws for a `legaldoc` field
 *   I  the editor rendered (react-dom/server): the whole Regulamin in the
 *      box, the counter, the languages, the links, an old section
 *   J  the /admin/www overview panel rendered: digests, links, the
 *      "zmiany nieopublikowane" marker, a draft page, a missing page
 *
 * Mocks only — no network, no database (scripts/stubs/ice-*.ts).
 * Optional: I18N_FRAGMENT=<path to i18n-admin.json> also checks the Polish
 * counter wording with this track's keys merged in.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import plDict from "@/lib/i18n/dictionaries/pl.json";
import { I18nProvider } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { LegalDocField } from "@/components/admin/cms/legal-doc-field";
import { LegalDocsPanel } from "@/components/admin/cms/legal-docs-panel";
import {
  MAX_LEGAL_CHARS, cleanLegalDocInput, legalCharCount, normalizeLegalText, readLegalDoc, type LegalDocContent,
} from "@/lib/legal/content";
import { LEGAL_DOCS, LEGAL_LOCALES } from "@/lib/legal/docs";
import { legalSha256 } from "@/lib/server/legal/published";
import {
  isDownloadSlug, legalDocOf, legalDocsDiffer, legalOverview, legalSectionForSave, legalTextFilename, legalTextHeaders,
  legalVersionFacts, localeFacts, parseLegalLocaleParam, parseLegalSourceParam, withLegalDigests,
} from "@/lib/server/legal/admin";
import { SECTION_FIELDS, fieldsFor, readField, splitFields, writeField } from "@/lib/cms-schema";
import { ICE_UNSUPPORTED } from "@/lib/ice/registry";
import { saveBlockAction } from "@/app/actions/cms";
import { GET as downloadRoute } from "@/app/admin/www/[slug]/dokument/route";
import type { CmsBlockContent } from "@/lib/cms";
import { FakeDb, type Row } from "./stubs/ice-fake-db";
import { iceState, resetIceState } from "./stubs/ice-state";

let failures = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const SOURCES: Record<string, string> = Object.fromEntries(
  LEGAL_DOCS.map((d) => [d.slug, readFileSync(`content/legal/pl/${d.slug}.txt`, "utf8")]),
);
const REGULAMIN = SOURCES.regulamin;
/** U+FEFF, spelled out: an invisible character has no place in a source file. */
const BOM = String.fromCharCode(0xfeff);
const fileSha = (slug: string) => createHash("sha256").update(readFileSync(`content/legal/pl/${slug}.txt`)).digest("hex");

const doc = (pl: Partial<LegalDocContent["pl"]>, en: Partial<LegalDocContent["en"]> = {}, de: Partial<LegalDocContent["de"]> = {}) => ({
  pl: { status: "active", text: "Regulamin\n", version: "1.0", effective: "2026-10-20", ...pl },
  en: { status: "soon", text: "", version: "", effective: null, ...en },
  de: { status: "soon", text: "", version: "", effective: null, ...de },
});

/* ══ A. cleanLegalDocInput ═══════════════════════════════════════════════ */

function sectionA() {
  console.log("\nA. cleanLegalDocInput — normalise line endings and a BOM, refuse what is not a document");
  const crlf = cleanLegalDocInput(doc({ text: "A\r\nB\rC\n\r\nD" }));
  check("A1 CRLF and lone CR become LF, nothing else changes", crlf.ok && crlf.doc.pl.text === "A\nB\nC\n\nD");
  const bom = cleanLegalDocInput(doc({ text: `${BOM}Regulamin\n` }));
  check("A2 a leading BOM is dropped", bom.ok && bom.doc.pl.text === "Regulamin\n");
  const inner = cleanLegalDocInput(doc({ text: `A${BOM}B` }));
  check("A2b … only a LEADING one (a BOM inside the text is the text)", inner.ok && inner.doc.pl.text === `A${BOM}B`);
  const ws = "  wcięcie\t\n\n\n   trzy spacje  \n“cudzysłów” „pl” … § ⁵ → — –";
  const keep = cleanLegalDocInput(doc({ text: ws }));
  check("A3 whitespace, blank-line runs, quotes, §, ⁵, → are kept verbatim (no trimming, no folding)", keep.ok && keep.doc.pl.text === ws);
  const nul = cleanLegalDocInput(doc({}, { status: "soon", text: "a\u0000b" }));
  check("A4 a NUL character is refused, naming the language", !nul.ok && nul.error === "doc_nul" && nul.locale === "en");
  const empty = cleanLegalDocInput(doc({ text: "" }));
  const blank = cleanLegalDocInput(doc({ text: " \n\t\n" }));
  check("A5 an ACTIVE language with no text (or only whitespace) is refused", !empty.ok && empty.error === "doc_empty_active" && empty.locale === "pl"
    && !blank.ok && blank.error === "doc_empty_active");
  const soonEmpty = cleanLegalDocInput(doc({}, { status: "soon", text: "" }));
  check("A5b … while a 'soon' language may be empty", soonEmpty.ok && soonEmpty.doc.en.text === "" && soonEmpty.doc.en.status === "soon");
  const badStatus = cleanLegalDocInput(doc({}, {}, { status: "live" as "soon" }));
  check("A6 an unknown status is refused", !badStatus.ok && badStatus.error === "doc_status" && badStatus.locale === "de");
  const missingStatus = cleanLegalDocInput({ pl: { text: "x" } });
  check("A6b a missing status reads as 'soon'", missingStatus.ok && missingStatus.doc.pl.status === "soon" && missingStatus.doc.en.status === "soon");
  const badDates = ["2026-02-30", "20.10.2026", "2026-1-5", "2026-10-20T00:00:00Z", 20261020].map((effective) =>
    cleanLegalDocInput(doc({ effective: effective as string })));
  check("A7 an effective date that is not a real YYYY-MM-DD is refused",
    badDates.every((r) => !r.ok && r.error === "doc_date" && r.locale === "pl"), JSON.stringify(badDates.map((r) => (r.ok ? "ok" : r.error))));
  const noDates = [null, undefined, ""].map((effective) => cleanLegalDocInput(doc({ effective: effective as null })));
  check("A7b no date (null, missing, \"\") is accepted as null", noDates.every((r) => r.ok && r.doc.pl.effective === null));
  const longVersion = cleanLegalDocInput(doc({ version: "x".repeat(33) }));
  const okVersion = cleanLegalDocInput(doc({ version: `  ${"x".repeat(32)}  ` }));
  check("A8 a version over 32 characters is refused; one of 32 (trimmed) is kept",
    !longVersion.ok && longVersion.error === "doc_version" && okVersion.ok && okVersion.doc.pl.version === "x".repeat(32));
  const tooLong = cleanLegalDocInput(doc({ text: "a".repeat(MAX_LEGAL_CHARS + 1) }));
  check("A9 1 000 001 characters in one language are refused", MAX_LEGAL_CHARS === 1_000_000 && !tooLong.ok && tooLong.error === "doc_too_long" && tooLong.locale === "pl");
  const max = cleanLegalDocInput(doc({ text: "ą".repeat(MAX_LEGAL_CHARS) }));
  check("A9b … exactly 1 000 000 (two-byte letters) is accepted", max.ok && legalCharCount(max.doc.pl.text) === MAX_LEGAL_CHARS);
  const line = "§ 1. Zażółć gęślą jaźń — „cytat” … ⁵ → wiersz próbny z polskimi znakami.\n";
  const big = line.repeat(Math.ceil(250_000 / line.length)).slice(0, 250_000);
  const bigR = cleanLegalDocInput(doc({ text: big }));
  check("A10 250 000 characters are accepted UNCHANGED (same string, same length, same digest)",
    bigR.ok && bigR.doc.pl.text === big && legalCharCount(bigR.doc.pl.text) === legalCharCount(big)
    && legalSha256(bigR.doc.pl.text) === legalSha256(big));
  const total = cleanLegalDocInput(doc({ text: "a".repeat(500_000) }, { status: "active", text: "b".repeat(500_000) }, { status: "active", text: "c".repeat(500_000) }));
  check("A11 all languages together over 1 400 000 are refused (the request body cap)", !total.ok && total.error === "doc_too_long" && total.locale === undefined);
  const forged = cleanLegalDocInput({ ...doc({}), pl: { ...doc({}).pl, sha256: "0".repeat(64), chars: 1 } });
  check("A12 sha256/chars sent by a browser are not part of what is accepted",
    forged.ok && !("sha256" in forged.doc.pl) && !("chars" in forged.doc.pl));
  check("A13 not an object → doc_missing", [null, undefined, "x", [], 5].every((raw) => {
    const r = cleanLegalDocInput(raw);
    return !r.ok && r.error === "doc_missing";
  }));
  const src = cleanLegalDocInput(doc({ text: REGULAMIN }));
  check("A14 the Regulamin source goes through byte for byte", src.ok && src.doc.pl.text === REGULAMIN
    && Buffer.from(src.doc.pl.text, "utf8").equals(readFileSync("content/legal/pl/regulamin.txt")));
  check("A15 the Regulamin source has its special characters (⁵ U+2075, → U+2192, „ ” … §) — the fixture is the real file",
    ["⁵", "→", "„", "”", "…", "§"].every((c) => REGULAMIN.includes(c)));
  check("A16 normalizeLegalText is idempotent and only touches \\r and a BOM",
    normalizeLegalText(normalizeLegalText(`${BOM}a\r\nb\r`)) === "a\nb\n" && normalizeLegalText(REGULAMIN) === REGULAMIN);
}

/* ══ B. digests ═══════════════════════════════════════════════════════════ */

function sectionB() {
  console.log("\nB. DIGESTS — written by the server, from the text");
  const want: Record<string, string> = {
    regulamin: "151b56da", "polityka-prywatnosci": "7d0c1b6f", "polityka-cookies": "0cd23f4b", "umowa-powierzenia-danych": "a572bc92",
  };
  for (const d of LEGAL_DOCS) {
    const dig = withLegalDigests(doc({ text: SOURCES[d.slug] }) as LegalDocContent);
    check(`B1 ${d.slug}: sha256 of the stored text = the file's (${want[d.slug]}…)`,
      dig.pl.sha256 === fileSha(d.slug) && dig.pl.sha256?.startsWith(want[d.slug]) === true, dig.pl.sha256);
  }
  const reg = withLegalDigests(doc({ text: REGULAMIN }) as LegalDocContent);
  check("B2 the Regulamin counts 75 255 characters (code points)", reg.pl.chars === 75_255 && legalCharCount(REGULAMIN) === 75_255, String(reg.pl.chars));
  check("B2b … every language gets a digest, an empty one the digest of \"\"",
    reg.en.sha256 === createHash("sha256").update("").digest("hex") && reg.en.chars === 0 && reg.de.chars === 0);

  const content = { title: { pl: "Stary tytuł" }, doc: { ...doc({ text: REGULAMIN }), pl: { ...doc({ text: REGULAMIN }).pl, sha256: "f".repeat(64), chars: 3 } } };
  const saved = legalSectionForSave(content);
  const stored = saved.ok ? readLegalDoc(saved.content) : null;
  check("B3 legalSectionForSave replaces a browser's sha256/chars with the server's",
    saved.ok && stored?.pl.sha256 === fileSha("regulamin") && stored?.pl.chars === 75_255 && stored?.pl.text === REGULAMIN);
  check("B3b … and keeps the section's other keys", saved.ok && JSON.stringify((saved.content as { title: unknown }).title) === JSON.stringify({ pl: "Stary tytuł" }));
  const plain = { description: { pl: "Stary tekst" } };
  const passed1 = legalSectionForSave(plain);
  check("B4 a section with no doc (an old one, or a new empty one) is stored as it came — the same object",
    passed1.ok && passed1.content === plain);
  const undef = { doc: undefined, title: { pl: "x" } };
  check("B4b … `doc: undefined` counts as no doc", legalSectionForSave(undef).ok);
  const bad = legalSectionForSave({ doc: doc({}, {}, { status: "active", text: "" }) });
  check("B5 a refused document comes back as the problem and the language", !bad.ok && bad.error === "doc_empty_active" && bad.locale === "de");
  const nullDoc = legalSectionForSave({ doc: null });
  check("B5b `doc: null` is refused (doc_missing), not stored", !nullDoc.ok && nullDoc.error === "doc_missing");
}

/* ══ C. schema ════════════════════════════════════════════════════════════ */

function sectionC() {
  console.log("\nC. SCHEMA — a legal section is one document");
  const fields = fieldsFor("legal");
  check("C1 fieldsFor('legal') is exactly one legaldoc field on `doc`",
    fields.length === 1 && fields[0].key === "doc" && fields[0].kind === "legaldoc" && fields[0].label === "legalDoc" && fields[0].hint === "legalDocHint"
    && SECTION_FIELDS.legal === fields, JSON.stringify(fields));
  const split = splitFields("legal", fields);
  check("C2 it is a QUICK field (on screen when the section opens)", split.quick.length === 1 && split.advanced.length === 0);
  const content = { doc: doc({ text: REGULAMIN }) } as unknown as CmsBlockContent;
  check("C3 the generic readField gives \"\" for it (never the document object as a 'string')",
    LEGAL_LOCALES.every((l) => readField(content, fields[0], l) === ""));
  check("C4 the generic writeField leaves the content untouched (the same object)",
    writeField(content, fields[0], "pl", "nadpisane") === content);
  check("C5 no other section type uses legaldoc", Object.entries(SECTION_FIELDS).every(([type, fs]) => type === "legal" || fs.every((f) => f.kind !== "legaldoc")));
}

/* ══ D. route helpers ═════════════════════════════════════════════════════ */

function sectionD() {
  console.log("\nD. DOWNLOAD — the route's pure helpers");
  check("D1 ?locale: absent/empty → pl, pl/en/de → itself, anything else → null (400)",
    parseLegalLocaleParam(null) === "pl" && parseLegalLocaleParam("") === "pl" && parseLegalLocaleParam("en") === "en" && parseLegalLocaleParam("de") === "de"
    && ["PL", "fr", "pl ", "../pl"].every((v) => parseLegalLocaleParam(v) === null));
  check("D2 ?source: absent/draft → draft, published → published, else null",
    parseLegalSourceParam(null) === "draft" && parseLegalSourceParam("draft") === "draft" && parseLegalSourceParam("published") === "published"
    && parseLegalSourceParam("live") === null);
  check("D3 the file name: <slug>_<locale>_v<version>_szkic.txt", legalTextFilename("regulamin", "pl", "1.0", "draft") === "regulamin_pl_v1.0_szkic.txt");
  check("D3b … _opublikowany for the published text", legalTextFilename("polityka-cookies", "en", "2.1", "published") === "polityka-cookies_en_v2.1_opublikowany.txt");
  check("D3c … a version with spaces/slashes/quotes is reduced to safe characters; an empty one is left out",
    legalTextFilename("regulamin", "pl", " 1.0 beta/2\"; ", "draft") === "regulamin_pl_v1.0-beta-2_szkic.txt"
    && legalTextFilename("regulamin", "de", "", "draft") === "regulamin_de_szkic.txt"
    && legalTextFilename("regulamin", "pl", "../..", "draft") === "regulamin_pl_szkic.txt");
  const h = legalTextHeaders("regulamin_pl_v1.0_szkic.txt", 79213);
  check("D4 headers: UTF-8 text, an attachment with that name, nosniff, never cached",
    h["Content-Type"] === "text/plain; charset=utf-8" && h["Content-Length"] === "79213"
    && h["Content-Disposition"] === "attachment; filename=\"regulamin_pl_v1.0_szkic.txt\"; filename*=UTF-8''regulamin_pl_v1.0_szkic.txt"
    && h["X-Content-Type-Options"] === "nosniff" && h["Cache-Control"] === "private, no-store");
  check("D5 isDownloadSlug: CMS slugs only", ["regulamin", "umowa-powierzenia-danych", "a1"].every(isDownloadSlug)
    && ["", "Regulamin", "a/b", "../x", "-a", "a--b", "a".repeat(81)].every((s) => !isDownloadSlug(s)));
  const blocks = [
    { type: "text", visible: true, content: { doc: doc({ text: "nie ten" }) } },
    { type: "legal", visible: false, content: { doc: doc({ text: "ukryty" }) } },
    { type: "legal", visible: true, content: { description: { pl: "stary" } } },
    { type: "legal", visible: true, content: { doc: doc({ text: "widoczny" }) } },
  ];
  check("D6 legalDocOf: the first VISIBLE legal section with a doc (the public reader's rule)",
    legalDocOf(blocks, false)?.pl.text === "widoczny" && legalDocOf(blocks, true)?.pl.text === "widoczny");
  check("D6b … the draft falls back to a hidden one when there is no visible one; the published text never does",
    legalDocOf(blocks.slice(0, 3), true)?.pl.text === "ukryty" && legalDocOf(blocks.slice(0, 3), false) === null);
}

/* ══ E. the route over a fake database ════════════════════════════════════ */

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const CUSTOMER = "aaaaaaaa-0000-4000-8000-000000000002";
const P_REG = "bbbbbbbb-0000-4000-8000-000000000001";
const P_COOK = "bbbbbbbb-0000-4000-8000-000000000002";
const P_PRIV = "bbbbbbbb-0000-4000-8000-000000000003";
const P_OTHER = "bbbbbbbb-0000-4000-8000-000000000004";
const B_REG = "cccccccc-0000-4000-8000-000000000001";
const B_COOK = "cccccccc-0000-4000-8000-000000000002";
const B_PRIV = "cccccccc-0000-4000-8000-000000000003";
const B_HERO = "cccccccc-0000-4000-8000-000000000004";
const T0 = "2026-10-20T10:00:00.000Z";

const regDoc = () => withLegalDigests(doc({ text: REGULAMIN }) as LegalDocContent);
const snap = (id: string, d: unknown, visible = true) => [{ id, type: "legal", sort_order: 0, visible, content: { doc: d } }];

function freshDb(user: string | null = ADMIN): FakeDb {
  resetIceState();
  const db = new FakeDb();
  db.user = user ? { id: user } : null;
  db.tables.profiles = [{ id: ADMIN, role: "admin" }, { id: CUSTOMER, role: "user" }];
  db.tables.cms_pages = [
    { id: P_REG, slug: "regulamin", title: "Regulamin", kind: "standard", status: "published", is_homepage: false, seo: {}, published_at: T0,
      published_snapshot: snap(B_REG, regDoc()) },
    // The cookie policy: published, and its draft has moved on since.
    { id: P_COOK, slug: "polityka-cookies", title: "Cookies", kind: "standard", status: "published", is_homepage: false, seo: {}, published_at: T0,
      published_snapshot: snap(B_COOK, withLegalDigests(doc({ text: "Polityka cookies\nstara\n" }) as LegalDocContent)) },
    // The privacy policy: a draft page, never published.
    { id: P_PRIV, slug: "polityka-prywatnosci", title: "Prywatność", kind: "standard", status: "draft", is_homepage: false, seo: {}, published_at: null,
      published_snapshot: null },
    { id: P_OTHER, slug: "oferta", title: "Oferta", kind: "standard", status: "published", is_homepage: false, seo: {}, published_at: T0,
      published_snapshot: [{ id: B_HERO, type: "hero", sort_order: 0, visible: true, content: {} }] },
  ];
  db.tables.cms_blocks = [
    { id: B_REG, page_id: P_REG, type: "legal", sort_order: 0, visible: true, content: { doc: regDoc() }, style: {}, code: {}, updated_at: T0 },
    { id: B_COOK, page_id: P_COOK, type: "legal", sort_order: 0, visible: true,
      content: { doc: withLegalDigests(doc({ text: "Polityka cookies\nnowa\n" }) as LegalDocContent) }, style: {}, code: {}, updated_at: T0 },
    { id: B_PRIV, page_id: P_PRIV, type: "legal", sort_order: 0, visible: false,
      content: { doc: doc({ status: "soon", text: "Polityka prywatności — szkic\n", version: "0.9" }) }, style: {}, code: {}, updated_at: T0 },
    { id: B_HERO, page_id: P_OTHER, type: "hero", sort_order: 0, visible: true, content: {}, style: {}, code: {}, updated_at: T0 },
  ];
  db.tables.cms_page_versions = [
    { id: "v-reg-1", page_id: P_REG, version: 1, snapshot: snap(B_REG, doc({ text: "Regulamin v0\n", version: "0.9" })) },
    { id: "v-reg-2", page_id: P_REG, version: 2, snapshot: snap(B_REG, regDoc()) },
    { id: "v-reg-3", page_id: P_REG, version: 3, snapshot: [{ id: B_REG, type: "text", sort_order: 0, visible: true, content: {} }] },
    { id: "v-cook-1", page_id: P_COOK, version: 4, snapshot: snap(B_COOK, doc({ text: "Polityka cookies\nstara\n" })) },
    { id: "v-oferta-1", page_id: P_OTHER, version: 1, snapshot: [{ id: B_HERO, type: "hero", content: {} }] },
  ];
  iceState.client = db.client();
  return db;
}

const call = (slug: string, query = "") =>
  downloadRoute(new Request(`https://grovbase.test/admin/www/${slug}/dokument${query}`), { params: Promise.resolve({ slug }) });

async function sectionE() {
  console.log("\nE. DOWNLOAD — the route, over a fake database");
  {
    const db = freshDb(null);
    const r = await call("regulamin", "?locale=pl");
    check("E1 no session → 401, nothing read", r.status === 401 && !db.tablesTouched().includes("cms_pages"));
  }
  {
    const db = freshDb(CUSTOMER);
    const r = await call("regulamin", "?locale=pl");
    check("E2 a customer → 403, no page read", r.status === 403 && (await r.json()).error === "forbidden" && !db.tablesTouched().includes("cms_pages"));
  }
  {
    const db = freshDb();
    iceState.stepUp = "/auth/security-check";
    const r = await call("regulamin", "?locale=pl");
    check("E3 an admin on a device the step-up has not verified → 403 step_up_required",
      r.status === 403 && (await r.json()).error === "step_up_required" && !db.tablesTouched().includes("cms_pages") && iceState.stepUpCalls === 1);
  }
  {
    freshDb();
    const r = await call("regulamin", "?locale=pl");
    const body = Buffer.from(await r.arrayBuffer());
    check("E4 an admin gets the draft text: 200, the bytes IDENTICAL to content/legal/pl/regulamin.txt",
      r.status === 200 && body.equals(readFileSync("content/legal/pl/regulamin.txt")), `${r.status} ${body.length}`);
    check("E4b … as text/plain; charset=utf-8, attachment regulamin_pl_v1.0_szkic.txt, Content-Length in bytes, no-store",
      r.headers.get("content-type") === "text/plain; charset=utf-8"
      && (r.headers.get("content-disposition") ?? "").startsWith("attachment; filename=\"regulamin_pl_v1.0_szkic.txt\"")
      && r.headers.get("content-length") === String(body.length) && r.headers.get("cache-control") === "private, no-store");
    check("E4c … and its sha256 is the owner's upload (151b56da…)", createHash("sha256").update(body).digest("hex") === fileSha("regulamin"));
  }
  {
    freshDb();
    const r = await call("regulamin");
    check("E5 no ?locale → Polish", r.status === 200 && (r.headers.get("content-disposition") ?? "").includes("regulamin_pl_"));
  }
  {
    freshDb();
    const r = await call("regulamin", "?locale=fr");
    const s = await call("regulamin", "?locale=pl&source=live");
    check("E6 an unknown locale or source → 400", r.status === 400 && s.status === 400);
  }
  {
    freshDb();
    const en = await call("regulamin", "?locale=en");
    const none = await call("nie-ma-takiej", "?locale=pl");
    const hero = await call("oferta", "?locale=pl");
    const bad = await call("..%2Fadmin", "?locale=pl");
    check("E7 404 for a language with no text, an unknown page, a page with no legal section, a malformed slug",
      en.status === 404 && none.status === 404 && hero.status === 404 && bad.status === 404);
  }
  {
    freshDb();
    const draft = await (await call("polityka-cookies", "?locale=pl")).text();
    const pub = await call("polityka-cookies", "?locale=pl&source=published");
    check("E8 ?source=published gives the published snapshot's text, the draft by default",
      draft === "Polityka cookies\nnowa\n" && (await pub.text()) === "Polityka cookies\nstara\n"
      && (pub.headers.get("content-disposition") ?? "").includes("polityka-cookies_pl_v1.0_opublikowany.txt"));
  }
  {
    freshDb();
    const hidden = await call("polityka-prywatnosci", "?locale=pl");
    const pub = await call("polityka-prywatnosci", "?locale=pl&source=published");
    check("E9 a hidden draft section is still downloadable (the admin is working on it); a never-published page has no published text",
      hidden.status === 200 && (await hidden.text()) === "Polityka prywatności — szkic\n" && pub.status === 404);
  }
}

/* ══ F. saveBlockAction ═══════════════════════════════════════════════════ */

async function sectionF() {
  console.log("\nF. SAVE — saveBlockAction stores the document with the server's digests");
  const block = (db: FakeDb, id: string) => db.tables.cms_blocks.find((b) => b.id === id) as Row;
  const writes = (db: FakeDb) => db.calls.filter((c) => c.kind === "from" && c.table === "cms_blocks" && c.op !== "select").length;
  {
    const db = freshDb();
    const sent = { doc: { ...doc({ text: REGULAMIN.replace(/\n/g, "\r\n") }), pl: { ...doc({ text: REGULAMIN.replace(/\n/g, "\r\n") }).pl, sha256: "0".repeat(64), chars: 1 } } };
    const r = await saveBlockAction({ id: B_REG, pageId: P_REG, type: "legal", content: sent as unknown as CmsBlockContent, visible: true });
    const stored = readLegalDoc(block(db, B_REG).content);
    check("F1 a Windows (CRLF) Regulamin is stored as the LF source, byte for byte",
      r.ok && stored?.pl.text === REGULAMIN, r.ok ? "" : r.error);
    check("F1b … with the SERVER's sha256 (151b56da…) and 75 255 characters, not the browser's 0000…/1",
      stored?.pl.sha256 === fileSha("regulamin") && stored?.pl.chars === 75_255);
    check("F1c … and every language has its digest", LEGAL_LOCALES.every((l) => typeof stored?.[l].sha256 === "string" && typeof stored?.[l].chars === "number"));
  }
  {
    const db = freshDb();
    const before = JSON.stringify(block(db, B_REG).content);
    const r = await saveBlockAction({ id: B_REG, pageId: P_REG, type: "legal", content: { doc: doc({ text: "" }) } as unknown as CmsBlockContent, visible: true });
    check("F2 an active empty document is refused (cms.err.doc_empty_active, detail PL) and NOTHING is written",
      !r.ok && r.error === "doc_empty_active" && r.detail === "PL" && writes(db) === 0 && JSON.stringify(block(db, B_REG).content) === before);
  }
  {
    const db = freshDb();
    const r = await saveBlockAction({ id: B_REG, pageId: P_REG, type: "legal", content: { doc: doc({}, { status: "active", text: "x".repeat(MAX_LEGAL_CHARS + 1) }) } as unknown as CmsBlockContent, visible: true });
    check("F3 an over-long language is refused with its name (doc_too_long, EN), nothing written", !r.ok && r.error === "doc_too_long" && r.detail === "EN" && writes(db) === 0);
  }
  {
    const db = freshDb();
    const old = { title: { pl: "Regulamin" }, description: { pl: "Stara treść" } };
    const r = await saveBlockAction({ id: B_REG, pageId: P_REG, type: "legal", content: old as unknown as CmsBlockContent, visible: true });
    check("F4 a legal section with no doc is stored as before (an old section is not broken by this)",
      r.ok && JSON.stringify(block(db, B_REG).content) === JSON.stringify(old));
  }
  {
    const db = freshDb();
    const hero = { title: { pl: "Nagłówek" }, doc: { pl: { status: "active", text: "" } } };
    const r = await saveBlockAction({ id: B_HERO, pageId: P_OTHER, type: "hero", content: hero as unknown as CmsBlockContent, visible: true });
    check("F5 another section type is untouched by the legal rules (stored as sent)", r.ok && JSON.stringify(block(db, B_HERO).content) === JSON.stringify(hero));
  }
  {
    const db = freshDb();
    const big = ("Linia dokumentu § ⁵ → „x” …\n").repeat(9_000);
    const r = await saveBlockAction({ pageId: P_REG, type: "legal", content: { doc: doc({ text: big }) } as unknown as CmsBlockContent, visible: true });
    const created = db.tables.cms_blocks.find((b) => b.page_id === P_REG && b.id !== B_REG);
    const stored = readLegalDoc(created?.content);
    check("F6 a NEW legal section of ~250 000 characters is created with the text unchanged and its digest",
      r.ok && legalCharCount(big) > 240_000 && stored?.pl.text === big && stored?.pl.sha256 === legalSha256(big));
  }
  {
    const db = freshDb(CUSTOMER);
    const r = await saveBlockAction({ id: B_REG, pageId: P_REG, type: "legal", content: { doc: doc({ text: "x" }) } as unknown as CmsBlockContent, visible: true });
    check("F7 a customer cannot save at all (not_admin), nothing written", !r.ok && r.error === "not_admin" && writes(db) === 0);
  }
}

/* ══ G. overview and history ══════════════════════════════════════════════ */

async function sectionG() {
  console.log("\nG. OVERVIEW (/admin/www) and HISTORY facts");
  const db = freshDb();
  const rows = await legalOverview(db.client() as never);
  const by = Object.fromEntries(rows.map((r) => [r.def.slug, r]));
  check("G1 one row per LEGAL_DOCS entry, in the registry's order", rows.map((r) => r.def.slug).join() === LEGAL_DOCS.map((d) => d.slug).join());
  const reg = by.regulamin;
  check("G2 Regulamin: published, the published PL facts (v1.0, 2026-10-20, 75 255, 151b56da…), CMS version 3",
    reg.page?.status === "published" && reg.published?.pl.version === "1.0" && reg.published.pl.effective === "2026-10-20"
    && reg.published.pl.chars === 75_255 && reg.published.pl.sha256 === fileSha("regulamin") && reg.cmsVersion === 3
    && reg.published.en.status === "soon" && reg.published.en.sha256 === null, JSON.stringify(reg));
  check("G3 Regulamin: draft = published → no 'zmiany nieopublikowane'", reg.draftHasDoc && !reg.unpublished);
  check("G4 the cookie policy: draft text differs from the published one → unpublished", by["polityka-cookies"].unpublished === true);
  const priv = by["polityka-prywatnosci"];
  check("G5 the privacy policy: a draft page — no published document, a draft one, so unpublished",
    priv.page?.status === "draft" && priv.published === null && priv.draftHasDoc && priv.unpublished && priv.cmsVersion === null);
  const dpa = by["umowa-powierzenia-danych"];
  check("G6 the DPA: no page at all ('brak strony')", dpa.page === null && dpa.published === null && !dpa.unpublished);

  const a = regDoc();
  const meta = { ...a, pl: { ...a.pl, version: "1.1" } };
  check("G7 legalDocsDiffer: a version (or status/date) change counts, identical documents do not",
    legalDocsDiffer(a, meta) && !legalDocsDiffer(a, regDoc()) && legalDocsDiffer(a, null) && !legalDocsDiffer(null, null));
  const noDigest = { ...doc({ text: REGULAMIN }).pl } as LegalDocContent["pl"];
  check("G7b localeFacts computes the digest of a document stored before digests", localeFacts(noDigest).sha256 === fileSha("regulamin")
    && localeFacts(noDigest).chars === 75_255);

  const facts = await legalVersionFacts(db.client() as never, { id: P_REG, slug: "regulamin" }, ["v-reg-1", "v-reg-2", "v-reg-3", "v-cook-1"]);
  check("G8 history: each version that holds a document says which (v0.9 / v1.0 with its digest); one without has none; another page's id is not read",
    facts["v-reg-1"]?.pl?.version === "0.9" && facts["v-reg-2"]?.pl?.sha256 === fileSha("regulamin") && facts["v-reg-2"]?.pl?.chars === 75_255
    && !facts["v-reg-2"]?.en && !("v-reg-3" in facts) && !("v-cook-1" in facts), JSON.stringify(Object.keys(facts)));
  const db2 = freshDb();
  const none = await legalVersionFacts(db2.client() as never, { id: P_OTHER, slug: "oferta" }, ["v-oferta-1"]);
  check("G9 an ordinary page with no legal section: no snapshot is read a second time",
    Object.keys(none).length === 0 && !db2.tablesTouched().includes("cms_page_versions"));
  const db3 = freshDb();
  db3.tableErrors.cms_pages = "permission denied";
  const failed = await legalOverview(db3.client() as never).then(() => "resolved", () => "rejected");
  check("G10 a failed page read is an error (the list page leaves the panel out), never four 'brak strony' rows", failed === "rejected");
}

/* ══ H. static ════════════════════════════════════════════════════════════ */

function sectionH() {
  console.log("\nH. STATIC — the editor itself");
  const field = readFileSync("components/admin/cms/legal-doc-field.tsx", "utf8");
  const code = field.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  check("H1 legal-doc-field.tsx has NO maxLength anywhere (the only cap is the server's)", !/maxLength/i.test(field));
  check("H2 the text box: a textarea bound to the language's text, spellCheck off, at least 24 rows, resizable",
    /<Textarea[\s\S]*?value=\{entry\.text\}[\s\S]*?\/>/.test(code) && /rows=\{24\}/.test(code) && /spellCheck=\{false\}/.test(code) && /resize-y/.test(code));
  check("H3 upload: .txt / text/plain, read as UTF-8, normalised with normalizeLegalText, U+FFFD detected",
    /accept="\.txt,text\/plain"/.test(code) && /readAsText\(file, "utf-8"\)/.test(code) && /normalizeLegalText\(/.test(code)
    && /REPLACEMENT_CHAR = String\.fromCharCode\(0xfffd\)/.test(code) && /text\.includes\(REPLACEMENT_CHAR\)/.test(code));
  check("H3b no invisible or replacement character typed literally into the editor's source (U+FEFF, U+FFFD, NUL)",
    ![0xfeff, 0xfffd, 0].some((c) => field.includes(String.fromCharCode(c))));
  check("H4 the download link is the admin route for the tab's language",
    code.includes("`/admin/www/${slug}/dokument?locale=${locale}`"));
  check("H5 the preview is the public page's own <LegalText>, parsed only while open",
    /<LegalText outline=\{outline\}/.test(code) && /preview \? parseLegalText\(deferred\) : null/.test(code));
  check("H6 the counter, digest and preview read a deferred copy of the text", /useDeferredValue\(entry\.text\)/.test(code)
    && /legalCharCount\(deferred\)/.test(code) && /useSha256\(deferred\)/.test(code));
  const fields = readFileSync("components/admin/cms/fields.tsx", "utf8");
  check("H7 fields.tsx draws LegalDocField for a legaldoc field", /def\.kind === "legaldoc"[\s\S]{0,200}<LegalDocField /.test(fields));
  const tokens = ICE_UNSUPPORTED.filter((u) => u.reason === "legal").flatMap((u) => u.path.split(/,\s*/));
  check("H8 the visual editor's 'not here' list names all four legal paths",
    tokens.sort().join() === LEGAL_DOCS.map((d) => `/${d.slug}`).sort().join(), tokens.join());
  const route = readFileSync("app/admin/www/[slug]/dokument/route.ts", "utf8");
  check("H9 the route checks the session, the admin role and the step-up before reading anything",
    route.indexOf("auth.getUser") < route.indexOf("readLegalTextFile(") && route.includes("profile?.role !== \"admin\"")
    && route.indexOf("enforceLoginSecurity") < route.indexOf("readLegalTextFile("));
}

/* ══ I. the editor, rendered ══════════════════════════════════════════════ */

/** The Polish dictionary — with an i18n fragment merged in when
 *  I18N_FRAGMENT names one (this track's keys before they land). */
function polishDict(): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(plDict)) as Record<string, unknown>;
  const path = process.env.I18N_FRAGMENT;
  if (!path) return out;
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (!into[k] || typeof into[k] !== "object") into[k] = {};
        merge(into[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else into[k] = v;
    }
  };
  merge(out, (JSON.parse(readFileSync(path, "utf8")) as { pl: Record<string, unknown> }).pl);
  return out;
}

const unescapeHtml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

function render(content: unknown, locale: "pl" | "en" | "de"): string {
  return renderToStaticMarkup(createElement(I18nProvider, {
    locale: "pl", dict: polishDict(),
    children: createElement(LegalDocField, { label: "Dokument prawny", locale, content: content as CmsBlockContent, onChange: () => undefined }),
  }));
}

function sectionI() {
  console.log("\nI. THE EDITOR, RENDERED — the whole text in the box, the counter, the languages");
  const html = render({ doc: regDoc() }, "pl");
  const box = /<textarea[^>]*data-legal-doc-text[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  check("I1 the textarea holds the WHOLE Regulamin, character for character", box !== null && unescapeHtml(box[1]) === REGULAMIN,
    box ? `${unescapeHtml(box[1]).length} vs ${REGULAMIN.length}` : "no textarea");
  const tag = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
  check("I2 … with no maxlength, spellcheck off, 24 rows", !/maxlength/i.test(tag) && /spellcheck="false"/i.test(tag) && /rows="24"/.test(tag), tag);
  check("I3 the counter reads 75 255 characters and 480 lines", /data-chars="75255"/.test(html) && /data-lines="480"/.test(html));
  if (process.env.I18N_FRAGMENT) {
    const counter = `75${String.fromCharCode(0xa0)}255 znaków · 480 wierszy`;
    check("I3b … as \"75 255 znaków · 480 wierszy\" (Polish grouping with a no-break space, Polish plural forms)", html.includes(counter));
  }
  check("I4 the saved digest line shows the server's sha256 (151b56da…)", html.includes(`data-legal-saved-sha="${fileSha("regulamin")}"`));
  check("I5 the three language chips: PL active, EN and DE soon",
    /data-legal-chip="pl" data-legal-chip-status="active"/.test(html) && /data-legal-chip="en" data-legal-chip-status="soon"/.test(html)
    && /data-legal-chip="de" data-legal-chip-status="soon"/.test(html));
  check("I6 the download link is /admin/www/regulamin/dokument?locale=pl, the page preview /podglad/regulamin",
    html.includes("href=\"/admin/www/regulamin/dokument?locale=pl\"") && html.includes("href=\"/podglad/regulamin\""));
  check("I7 the version and the date fields hold the PL entry's",
    /<input[^>]*id="cms-legal-pl-version"[^>]*value="1\.0"/.test(html) && /<input[^>]*id="cms-legal-pl-effective"[^>]*value="2026-10-20"/.test(html));
  const en = render({ doc: regDoc() }, "en");
  check("I8 the EN tab edits the EN entry: an empty box, 0 characters, its download link", /<textarea[^>]*data-legal-doc-text[^>]*><\/textarea>/.test(en)
    && /data-chars="0"/.test(en) && en.includes("dokument?locale=en"));
  const old = render({ title: { pl: "Regulamin" }, description: { pl: "Stary tekst" } }, "pl");
  check("I9 an old section (no doc) opens as an empty document, PL 'soon' — its old text is not shown as the document",
    /data-legal-chip="pl" data-legal-chip-status="soon"/.test(old) && /<textarea[^>]*data-legal-doc-text[^>]*><\/textarea>/.test(old) && !old.includes("Stary tekst"));
  const empty = render({ doc: doc({ text: "" }) }, "pl");
  check("I10 an active language with no text shows the warning before the save is refused", empty.includes("data-legal-active-empty"));
}

async function sectionJ() {
  console.log("\nJ. THE OVERVIEW PANEL, RENDERED (/admin/www → Dokumenty prawne)");
  const db = freshDb();
  const rows = await legalOverview(db.client() as never);
  const t = makeT(polishDict());
  const html = renderToStaticMarkup(LegalDocsPanel({ rows, t, locale: "pl" }) ?? createElement("div"));
  // A row runs from its marker to the next row's (its language list nests <li>s).
  const row = (slug: string) => html.split("data-legal-doc-row=\"").find((part) => part.startsWith(`${slug}"`)) ?? "";
  const reg = row("regulamin");
  check("J1 one row per document", LEGAL_DOCS.every((d) => html.includes(`data-legal-doc-row="${d.slug}"`)));
  check("J2 Regulamin: its published sha (151b56da0c3e) and links Edytuj / Historia / Otwórz /regulamin / PDF /regulamin/pdf",
    reg.includes(`data-legal-sha="${fileSha("regulamin")}"`) && reg.includes("href=\"/admin/www/regulamin\"")
    && reg.includes("href=\"/admin/www/regulamin/historia\"") && reg.includes("href=\"/regulamin\"") && reg.includes("href=\"/regulamin/pdf\"")
    && !reg.includes("data-legal-unpublished"));
  check("J3 the cookie policy carries the 'zmiany nieopublikowane' marker", row("polityka-cookies").includes("data-legal-unpublished=\"1\""));
  const priv = row("polityka-prywatnosci");
  check("J4 a draft page: no PDF link, its preview instead of the public address", !priv.includes("/polityka-prywatnosci/pdf")
    && priv.includes("href=\"/podglad/polityka-prywatnosci\"") && !priv.includes("href=\"/polityka-prywatnosci\""));
  const dpa = row("umowa-powierzenia-danych");
  check("J5 no page yet: no edit/PDF links at all", !dpa.includes("href="));
  check("J6 nothing renders when the overview could not be read", LegalDocsPanel({ rows: [], t, locale: "pl" }) === null);
}

async function main() {
  sectionA();
  sectionB();
  sectionC();
  sectionD();
  await sectionE();
  await sectionF();
  await sectionG();
  sectionH();
  sectionI();
  await sectionJ();
  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
