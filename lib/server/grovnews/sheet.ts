import "server-only";
import { unzipSafe } from "@/lib/server/unzip";
import { parseCsv } from "@/lib/services/csv";
import { IMPORT_LIMITS, mapColumns, type ImportFileKind } from "@/lib/grovnews-import";

/**
 * READING AN UPLOADED SOURCE LIST — CSV or XLSX, without trusting either.
 *
 * No spreadsheet library: an .xlsx is a zip of XML parts, and a source list
 * needs four of them (the workbook, its relationships, the shared strings and
 * one sheet). What this does NOT do is the point:
 *
 *   · it never evaluates anything. A cell stored as a FORMULA is reported as
 *     such and its value is not used — not even the value the spreadsheet
 *     cached — so nothing a formula computed can reach the import;
 *   · the archive goes through the defensive zip reader (lib/server/unzip.ts)
 *     with budgets sized for a list of a few hundred rows, XML parts only;
 *   · no DTD, no entities beyond the five XML ones and numeric references; a
 *     DOCTYPE in a part is a refusal (spreadsheet software never writes one);
 *   · every scan is linear (indexOf), so a hostile part cannot hold the
 *     request; every list and every cell is capped.
 *
 * Tag prefixes are ignored (`<x:c>` is `<c>`): some writers emit prefixed
 * SpreadsheetML.
 */

export type SheetTable = {
  kind: ImportFileKind;
  /** The sheet read, for an .xlsx. */
  sheet: string | null;
  headers: string[];
  rows: string[][];
  /** Per data row: the column indexes that held a formula. */
  formulas: Set<number>[];
};

export const SHEET_ERRORS = ["too_large", "empty", "unsupported", "invalid", "too_many_rows"] as const;
export type SheetErrorCode = (typeof SHEET_ERRORS)[number];

export class SheetError extends Error {
  constructor(public readonly code: SheetErrorCode) {
    super(code);
    this.name = "SheetError";
  }
}

const XLSX_BUDGET = { maxEntries: 200, maxFileBytes: 4_000_000, maxTotalBytes: 8_000_000 } as const;
const MAX_SHEETS = 50;
/** Sheets actually parsed while looking for the one to import. */
const MAX_PARSED_SHEETS = 10;
const MAX_SHARED = 200_000;

/** The file, by its content (never only by its name). */
export function readSourceFile(fileName: string, bytes: Buffer): SheetTable {
  if (bytes.length === 0) throw new SheetError("empty");
  if (bytes.length > IMPORT_LIMITS.maxBytes) throw new SheetError("too_large");
  const zip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  // The old binary .xls (an OLE compound file) is not read.
  const ole = bytes.length >= 8 && bytes.readUInt32LE(0) === 0xe011cfd0;
  if (ole) throw new SheetError("unsupported");
  if (zip) return readXlsx(bytes);
  if (/\.xlsx?$/i.test(fileName)) throw new SheetError("unsupported");
  return readCsv(bytes);
}

/* ── CSV ───────────────────────────────────────────────────────────────────── */

function readCsv(bytes: Buffer): SheetTable {
  // A text file has no NUL bytes; anything with them is binary, not a list.
  if (bytes.includes(0)) throw new SheetError("unsupported");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const parsed = parseCsv(text);
  if (parsed.headers.length === 0 || parsed.headers.every((h) => !h)) throw new SheetError("empty");
  if (parsed.rows.length > IMPORT_LIMITS.maxRows) throw new SheetError("too_many_rows");
  const rows = parsed.rows.map((r) => r.slice(0, IMPORT_LIMITS.maxColumns));
  return {
    kind: "csv", sheet: null, headers: parsed.headers.slice(0, IMPORT_LIMITS.maxColumns), rows,
    formulas: rows.map(() => new Set<number>()),
  };
}

/* ── XLSX ──────────────────────────────────────────────────────────────────── */

/** `<x:row>` → `<row>`, `</x:c>` → `</c>`. Attributes keep their prefixes. */
function dropPrefixes(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]{0,40}:/g, "<$1");
}

function part(files: Map<string, Buffer>, path: string): string | null {
  const buf = files.get(path);
  if (!buf) return null;
  const text = buf.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text.slice(0, 4000))) throw new SheetError("invalid");
  return dropPrefixes(text);
}

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** The five XML entities and numeric references, in one pass. */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (m, e: string) => {
    if (e[0] !== "#") return ENTITY[e] ?? m;
    const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

type El = { attrs: string; inner: string; end: number };

/** The elements named `name` inside `src[from, to)`, in order — linear. A
 *  self-closing element has empty inner text. */
function elements(src: string, name: string, limit: number, from = 0, to = src.length): El[] {
  const out: El[] = [];
  const open = `<${name}`;
  const close = `</${name}>`;
  let at = from;
  while (out.length < limit) {
    const start = src.indexOf(open, at);
    if (start < 0 || start >= to) break;
    const next = src[start + open.length] ?? "";
    if (!(next === ">" || next === "/" || next === " " || next === "\t" || next === "\n" || next === "\r")) {
      at = start + open.length;
      continue;
    }
    const gt = src.indexOf(">", start);
    if (gt < 0 || gt >= to) break;
    const attrs = src.slice(start + open.length, gt).slice(0, 2000);
    if (src[gt - 1] === "/") {
      out.push({ attrs, inner: "", end: gt + 1 });
      at = gt + 1;
      continue;
    }
    const closeAt = src.indexOf(close, gt + 1);
    if (closeAt < 0 || closeAt >= to) break;
    out.push({ attrs, inner: src.slice(gt + 1, closeAt), end: closeAt + close.length });
    at = closeAt + close.length;
  }
  return out;
}

/** An attribute's value; `name` may be given without its prefix (`id` finds
 *  `r:id`). */
function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]{0,40}:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = re.exec(attrs);
  return m ? decode(m[2] ?? m[3] ?? "") : null;
}

/** An entity expands to at most two UTF-16 units and is at most 10 chars
 *  long, so this much raw text always covers `maxField + 1` decoded chars. */
const RAW_FIELD = (IMPORT_LIMITS.maxField + 1) * 10;

/** Decoded text, capped before the (costly) decode as well as after it. */
function field(raw: string): string {
  return decode(raw.slice(0, RAW_FIELD)).slice(0, IMPORT_LIMITS.maxField + 1);
}

/** All `<t>` text of a shared string or inline string (rich text runs
 *  concatenated; phonetic runs skipped), capped at `maxField + 1`. */
function textOf(inner: string): string {
  let out = "";
  for (const t of elements(withoutPhonetics(inner), "t", 1000)) {
    out += field(t.inner);
    if (out.length > IMPORT_LIMITS.maxField) break;
  }
  return out.slice(0, IMPORT_LIMITS.maxField + 1);
}

/** The text without its `<rPh>…</rPh>` runs — one linear pass. */
function withoutPhonetics(inner: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const start = inner.indexOf("<rPh", at);
    if (start < 0) return out + inner.slice(at);
    out += inner.slice(at, start);
    const end = inner.indexOf("</rPh>", start);
    if (end < 0) return out;
    at = end + "</rPh>".length;
  }
}

function columnIndex(ref: string | null, fallback: number): number {
  const m = ref ? /^([A-Z]{1,3})\d+$/.exec(ref.toUpperCase()) : null;
  if (!m) return fallback;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

type SheetRef = { name: string; path: string };

function sheetsOf(files: Map<string, Buffer>): SheetRef[] {
  const workbook = part(files, "xl/workbook.xml");
  const rels = part(files, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new SheetError("invalid");
  const targets = new Map<string, string>();
  for (const r of elements(rels, "Relationship", 500)) {
    const id = attr(r.attrs, "Id");
    const target = attr(r.attrs, "Target");
    if (!id || !target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    targets.set(id, path.replace(/\/\.\//g, "/"));
  }
  const out: SheetRef[] = [];
  // Each part is read once, however many sheet entries point at it.
  const listed = new Set<string>();
  for (const s of elements(workbook, "sheet", MAX_SHEETS)) {
    const name = attr(s.attrs, "name");
    const id = attr(s.attrs, "id");
    const path = id ? targets.get(id) : undefined;
    if (name !== null && path && files.has(path) && !listed.has(path)) {
      listed.add(path);
      out.push({ name, path });
    }
  }
  return out;
}

type Shared = { text: string[]; blank: boolean[] };

function sharedStrings(files: Map<string, Buffer>): Shared {
  const xml = part(files, "xl/sharedStrings.xml");
  if (!xml) return { text: [], blank: [] };
  const text = elements(xml, "si", MAX_SHARED).map((si) => textOf(si.inner));
  // Blankness is worked out once per string, not once per cell using it.
  return { text, blank: text.map((v) => v.trim() === "") };
}

type Grid = { rows: string[][]; formulas: Set<number>[] };

function readGrid(xml: string, shared: Shared, maxRows: number): Grid {
  const dataStart = xml.indexOf("<sheetData");
  if (dataStart < 0) return { rows: [], formulas: [] };
  const dataEnd = xml.indexOf("</sheetData>", dataStart);
  const end = dataEnd < 0 ? xml.length : dataEnd;
  const rows: string[][] = [];
  const formulas: Set<number>[] = [];
  // Only rows with content count towards the limit (blank formatted rows are
  // skipped); one extra row is kept so "more than the limit" can be told
  // apart from "exactly the limit".
  for (const row of elements(xml, "row", Number.MAX_SAFE_INTEGER, dataStart, end)) {
    if (rows.length > maxRows + 1) break;
    const cells: string[] = [];
    const f = new Set<number>();
    let filled = false;
    let next = 0;
    for (const c of elements(row.inner, "c", IMPORT_LIMITS.maxColumns * 4)) {
      const col = columnIndex(attr(c.attrs, "r"), next);
      next = col + 1;
      if (col < 0 || col >= IMPORT_LIMITS.maxColumns) continue;
      const type = attr(c.attrs, "t") ?? "n";
      const hasFormula = elements(c.inner, "f", 1).length > 0;
      let value = "";
      if (hasFormula) {
        f.add(col);
      } else if (type === "s") {
        const v = elements(c.inner, "v", 1)[0]?.inner ?? "";
        const i = Number.parseInt(v, 10);
        if (Number.isInteger(i) && i >= 0 && i < shared.text.length) {
          value = shared.text[i];
          filled ||= !shared.blank[i];
        }
      } else if (type === "inlineStr") {
        value = textOf(elements(c.inner, "is", 1)[0]?.inner ?? "");
        filled ||= value.trim() !== "";
      } else if (type === "e") {
        value = "";
      } else {
        // n, b, str, d: the stored text as it is — booleans stay "1"/"0",
        // numbers stay digits; nothing is computed.
        value = field(elements(c.inner, "v", 1)[0]?.inner ?? "");
        filled ||= value.trim() !== "";
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    if (filled || f.size > 0) {
      rows.push(cells);
      formulas.push(f);
    }
  }
  return { rows, formulas };
}

function readXlsx(bytes: Buffer): SheetTable {
  let files: Map<string, Buffer>;
  try {
    const { entries } = unzipSafe(bytes, { allowedExt: new Set(["xml", "rels"]), ...XLSX_BUDGET });
    files = new Map(entries.map((e) => [e.path, e.data]));
  } catch {
    throw new SheetError("invalid");
  }
  const sheets = sheetsOf(files);
  if (sheets.length === 0) throw new SheetError("empty");
  const shared = sharedStrings(files);

  // The sheet meant for import: one named IMPORT_READY, else the first whose
  // header row has the required columns, else the first sheet.
  const byName = sheets.find((s) => s.name.trim().toUpperCase() === "IMPORT_READY");
  const ordered = byName ? [byName, ...sheets.filter((s) => s !== byName)] : sheets;
  let chosen: { ref: SheetRef; grid: Grid } | null = null;
  for (const ref of ordered.slice(0, MAX_PARSED_SHEETS)) {
    const xml = part(files, ref.path);
    if (!xml) continue;
    const grid = readGrid(xml, shared, IMPORT_LIMITS.maxRows);
    if (grid.rows.length === 0) continue;
    if (!chosen) chosen = { ref, grid };
    if (mapColumns(grid.rows[0]).missing.length === 0) { chosen = { ref, grid }; break; }
  }
  if (!chosen) throw new SheetError("empty");
  const [header, ...body] = chosen.grid.rows;
  const [, ...bodyFormulas] = chosen.grid.formulas;
  if (body.length > IMPORT_LIMITS.maxRows) throw new SheetError("too_many_rows");
  return { kind: "xlsx", sheet: chosen.ref.name, headers: header.map((h) => h.trim()), rows: body, formulas: bodyFormulas };
}
