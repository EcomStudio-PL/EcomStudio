#!/usr/bin/env node
/**
 * GENERATES supabase/migrations/0147_legal_documents_v1_pl.sql — the four
 * Polish legal documents, imported 1:1 into their CMS pages and published.
 *
 * THE TEXT IS THE FILE. content/legal/pl/<slug>.txt is the owner's upload,
 * byte for byte; this script never changes a character of it. It only cuts
 * it at line ends into parts small enough for the PROD connector (which
 * applies a migration in pieces of ~20 KB) and states, for each document, how
 * many parts there are, how many characters (code points) the text has and
 * the sha256 of the file's bytes. legal_document_import() (0146) glues the
 * parts back together and refuses unless all three match — so what reaches
 * the page hashes exactly like the file, final newline included.
 *
 * Version and effective date come from each file's own header ("Wersja:",
 * "Data wejścia w życie:") through legalHeaderFacts — the same reading the
 * editor uses to pre-fill its fields. The slugs and their order are
 * LEGAL_DOCS (lib/legal/docs.ts); both modules are bundled from the source,
 * never copied.
 *
 * Every emitted statement is independent, starts with a line `-- [n/N] …`,
 * then repeats the ORDER WARNING (each piece is applied on its own through
 * the PROD connector, so each one has to carry it) and stays under 20 000
 * bytes, so the file can be applied in one go or in pieces cut at those
 * lines. Applying a piece again writes nothing: a part is rewritten only
 * when it differs, and an import that already ran returns 'unchanged' or
 * 'already_imported' (0146). The script refuses a file that is not already
 * normalised (CR, BOM), a dollar-quote tag that occurs in the text, any
 * output (or 0146) containing the words the PROD connector rejects, and a
 * 0146 too big to go through the connector as one piece.
 *
 *   node scripts/gen-legal-migration.mjs            # writes the migration
 *   node scripts/gen-legal-migration.mjs --check    # exits 1 if it is stale
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "supabase/migrations/0147_legal_documents_v1_pl.sql";
const SCHEMA = "supabase/migrations/0146_legal_documents.sql";
const LOCALE = "pl";
/** One part's body, in UTF-8 bytes: the statement around it stays < 20 KB
 *  and the part itself well under 20 000 characters. */
const PART_MAX_BYTES = 18_000;
const PART_MAX_CHARS = 20_000;
const STATEMENT_MAX_BYTES = 20_000;
/** The PROD connector refuses a migration containing these words, any case. */
const FORBIDDEN = /drop|delete/i;
/** In the header and, as comment lines right after its "-- [n/N]" line, in
 *  every piece: 0147 published on top of the old code blanks the pages. */
const ORDER_WARNING = [
  "APPLY ONLY AFTER the Legal documents V1 code is READY on PROD — the",
  "previous renderer shows a doc-only legal section as an empty page.",
  "Rolling the code back after 0147 requires restoring the pre-import",
  "versions ('Przed importem: …') of the four pages.",
];
const WARNING_LINES = ORDER_WARNING.map((l) => `-- ${l}\n`).join("");
const RULE = `-- ${"═".repeat(74)}\n`;
/** The page title — used only when the page does not exist yet (the two
 *  older pages keep theirs) and in the version labels. */
const TITLES = {
  regulamin: "Regulamin",
  "polityka-prywatnosci": "Polityka prywatności",
  "polityka-cookies": "Polityka cookies",
  "umowa-powierzenia-danych": "Umowa powierzenia danych",
};

function fail(message) {
  console.error(`gen-legal-migration: ${message}`);
  process.exit(1);
}

// LEGAL_DOCS and the text helpers straight from the modules the app uses.
const dir = mkdtempSync(join(tmpdir(), "gen-legal-migration-"));
let legal;
try {
  require("esbuild").buildSync({
    stdin: {
      contents: `export * from "./lib/legal/content"; export { LEGAL_DOCS } from "./lib/legal/docs";`,
      resolveDir: ROOT, loader: "ts",
    },
    bundle: true, platform: "node", format: "cjs", outfile: join(dir, "legal.cjs"), logLevel: "error",
  });
  legal = require(join(dir, "legal.cjs"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const { LEGAL_DOCS, legalHeaderFacts, legalCharCount, normalizeLegalText, MAX_LEGAL_CHARS } = legal;

const bytesOf = (s) => Buffer.byteLength(s, "utf8");
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** The text cut after a "\n", greedily, each part within the budget. */
function partsOf(text, slug) {
  const lines = text.split(/(?<=\n)/);
  const parts = [];
  let cur = "";
  for (const line of lines) {
    if (bytesOf(line) > PART_MAX_BYTES) fail(`${slug}: one line is longer than a part (${bytesOf(line)} bytes)`);
    if (cur && bytesOf(cur) + bytesOf(line) > PART_MAX_BYTES) { parts.push(cur); cur = ""; }
    cur += line;
  }
  if (cur) parts.push(cur);
  if (parts.join("") !== text) fail(`${slug}: the parts do not add up to the text`);
  for (const p of parts) {
    if (bytesOf(p) > PART_MAX_BYTES || legalCharCount(p) > PART_MAX_CHARS) fail(`${slug}: a part is over budget`);
  }
  return parts;
}

const docs = [...LEGAL_DOCS].sort((a, b) => a.navOrder - b.navOrder).map((def) => {
  const slug = def.slug;
  const title = TITLES[slug];
  if (!title) fail(`no page title for ${slug} — add it to TITLES`);
  const file = `content/legal/${LOCALE}/${slug}.txt`;
  const bytes = readFileSync(join(ROOT, file));
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail(`${file} is not valid UTF-8`);
  if (normalizeLegalText(text) !== text) fail(`${file} has CR line endings or a BOM — the editor would change it`);
  if (text.includes("\u0000")) fail(`${file} contains NUL`);
  const { version, effective } = legalHeaderFacts(text);
  if (!version || !/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(version)) fail(`${file}: no usable "Wersja:" in the header`);
  if (!effective) fail(`${file}: no usable "Data wejścia w życie:" in the header`);
  const chars = legalCharCount(text);
  if (chars < 1 || chars > MAX_LEGAL_CHARS) fail(`${file}: ${chars} characters`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { slug, title, file, text, version, effective, chars, bytes: bytes.length, sha256, parts: partsOf(text, slug) };
});

const total = docs.reduce((n, d) => n + d.parts.length + 1, 0);
const statements = [];
let n = 0;
for (const d of docs) {
  d.parts.forEach((body, i) => {
    const tag = `$lg_${d.slug.replace(/-/g, "_")}_${i + 1}$`;
    // Without its closing "$" too: a body ENDING in "$lg_…_1" would close early.
    if (body.includes(tag.slice(0, -1))) fail(`${d.slug}: the dollar-quote tag ${tag} occurs in part ${i + 1}`);
    // A text line that looks like a piece marker would make the file unsafe to cut.
    if (/^-- \[\d+\/\d+\]/m.test(body)) fail(`${d.slug}: part ${i + 1} has a line that looks like a piece marker`);
    n += 1;
    statements.push(
      `-- [${n}/${total}] ${d.slug} · part ${i + 1} of ${d.parts.length} · ${group(legalCharCount(body))} characters\n` +
      WARNING_LINES +
      `insert into public.legal_document_sources as s (doc_key, locale, doc_version, part, body)\n` +
      `values (${lit(d.slug)}, ${lit(LOCALE)}, ${lit(d.version)}, ${i + 1}, ${tag}${body}${tag})\n` +
      `on conflict (doc_key, locale, doc_version, part) do update set body = excluded.body\n` +
      `  where s.body is distinct from excluded.body;\n`,
    );
  });
  n += 1;
  statements.push(
    `-- [${n}/${total}] ${d.slug} · import · ${group(d.chars)} characters · sha256 ${d.sha256}\n` +
    WARNING_LINES +
    `select public.legal_document_import(${lit(d.slug)}, ${lit(LOCALE)}, ${lit(d.version)}, date ${lit(d.effective)}, ` +
    `${lit(d.title)}, ${d.parts.length}, ${d.chars}, ${lit(d.sha256)});\n`,
  );
}
for (const s of statements) {
  if (bytesOf(s) > STATEMENT_MAX_BYTES) fail(`a statement is ${bytesOf(s)} bytes (max ${STATEMENT_MAX_BYTES})`);
}

const table = docs.map((d) =>
  `--   ${d.slug.padEnd(25)} v${d.version}  ${d.effective}  ${group(d.chars).padStart(7)} characters  ` +
  `${d.parts.length} part${d.parts.length === 1 ? " " : "s"}  sha256 ${d.sha256}`).join("\n");

const sql = `-- 0147 — LEGAL DOCUMENTS V1 (PL): the four Polish documents, 1:1, in the CMS.
--
${RULE}${WARNING_LINES}${RULE}--
-- GENERATED by scripts/gen-legal-migration.mjs from content/legal/${LOCALE}/*.txt (the
-- owner's files, byte for byte). Do not edit by hand; re-run the script
-- (--check tells whether this file is current). Needs 0146.
--
${table}
--
-- Per document: its text in parts (cut at line ends; each insert rewrites a
-- part only when it differs), then legal_document_import(), which glues the
-- parts together and refuses — writing nothing — unless the number of parts,
-- the characters and the sha256 of the UTF-8 text are exactly the file's.
-- It then keeps the page's current draft as a version ("Przed importem: …"),
-- puts the document into the page's \`legal\` section (EN/DE "soon"), hides —
-- never removes — the other sections and publishes the draft as it then
-- stands ("Import: … sha256 …"). A missing page (cookies, DPA) is created
-- first.
--
-- ONCE PER DOCUMENT: the import never undoes later work. It writes nothing
-- and returns "unchanged" when the draft and the published page already
-- hold the file's text, and "already_imported" when this exact import (its
-- "Import: …" version) already ran on the page — an admin's correction, a
-- restored "Przed importem" version, an unpublished page or an EN/DE draft
-- made after it stays as it is (to bring the import back, restore its
-- "Import: …" version in Historia). A page whose Polish text is active,
-- differs from the file and was put there by no import is refused with
-- legal_import_conflict, writing nothing. (0147 never passes
-- legal_document_import's p_force.)
--
-- APPLYING IN PIECES: every statement starts with a line "-- [n/N]", repeats
-- the warning above and is under ${group(STATEMENT_MAX_BYTES)} bytes; cut the file at those
-- lines, apply the pieces in order (this header is comments only).
-- Applying a piece again writes nothing (see above; a part is rewritten only
-- when it differs). An import whose parts have not all arrived (or arrived
-- damaged) raises legal_import_mismatch and nothing a visitor or an admin
-- sees changes — apply the missing pieces and repeat it.

${statements.join("\n")}`;

if (FORBIDDEN.test(sql)) fail("the generated SQL contains a forbidden word (drop/delete)");
const schemaSql = readFileSync(join(ROOT, SCHEMA), "utf8");
if (FORBIDDEN.test(schemaSql)) fail(`${SCHEMA} contains a forbidden word (drop/delete)`);
// 0146 has no piece markers: the connector takes it as ONE piece.
if (bytesOf(schemaSql) >= STATEMENT_MAX_BYTES) fail(`${SCHEMA} is ${bytesOf(schemaSql)} bytes (max ${STATEMENT_MAX_BYTES - 1}, it is applied in one piece)`);

const summary = docs.map((d) => `${d.slug} v${d.version} ${d.effective} ${d.chars} chars ${d.parts.length} part(s) ${d.sha256.slice(0, 12)}`).join("; ");
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(join(ROOT, OUT), "utf8"); } catch { /* missing */ }
  if (current !== sql) { console.error(`${OUT} is stale — run node scripts/gen-legal-migration.mjs`); process.exit(1); }
  console.log(`${OUT} is current (${total} statements: ${summary})`);
} else {
  writeFileSync(join(ROOT, OUT), sql);
  console.log(`wrote ${OUT} (${total} statements, ${group(bytesOf(sql))} bytes: ${summary})`);
}
