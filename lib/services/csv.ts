/**
 * CSV parsing and column mapping for the product importer.
 *
 * Deliberately dependency-free and transport-agnostic: the same functions run
 * in the browser (parse, map, preview, validate) and on the server (validate
 * again before writing). Catalogues of a few thousand rows are normal, so the
 * parser is a single pass over the string rather than a regex per row.
 */

/** Columns a seller can map onto. `name` is the only required one. */
export const IMPORT_FIELDS = [
  "name", "category", "sku", "description", "extra_info", "marketplace", "brand", "price", "tags",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header aliases used by "match columns automatically". Lower-cased, spaces
 *  and punctuation stripped before comparison. */
const ALIASES: Record<ImportField, string[]> = {
  name: ["name", "productname", "producttitle", "title", "nazwa", "nazwaproduktu", "produkt"],
  category: ["category", "productcategory", "kategoria", "kategorie", "type"],
  sku: ["sku", "skunumber", "code", "productcode", "kod", "symbol", "ean", "index"],
  description: ["description", "productdescription", "opis", "shortdescription"],
  extra_info: ["marketplacedescription", "longdescription", "opismarketplace", "details", "extrainfo", "notes", "uwagi"],
  marketplace: ["marketplace", "channel", "platform", "sklep"],
  brand: ["brand", "manufacturer", "marka", "producent"],
  price: ["price", "cena", "netprice", "grossprice", "amount"],
  tags: ["tags", "keywords", "tagi", "slowakluczowe"],
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort header → field mapping. Exact alias first, then a contains
 *  match, so "Product title (PL)" still finds `name`. */
export function autoMap(headers: string[]): Record<number, ImportField | ""> {
  const used = new Set<ImportField>();
  const map: Record<number, ImportField | ""> = {};
  const score = (h: string, field: ImportField) => {
    const n = normalise(h);
    const aliases = ALIASES[field];
    if (aliases.includes(n)) return 2;
    if (aliases.some((a) => n.includes(a) || a.includes(n))) return 1;
    return 0;
  };
  headers.forEach((h, i) => {
    let best: ImportField | "" = "";
    let bestScore = 0;
    for (const field of IMPORT_FIELDS) {
      if (used.has(field)) continue;
      const s = score(h, field);
      if (s > bestScore) { bestScore = s; best = field; }
    }
    map[i] = best;
    if (best) used.add(best);
  });
  return map;
}

/**
 * RFC4180-ish parser: quoted fields, escaped quotes, CRLF or LF, and a
 * delimiter sniffed from the header line (comma, semicolon or tab — Excel in
 * a Polish locale writes semicolons).
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const delimiter = sniffDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  // Blank lines are skipped rather than imported as empty products.
  const body = rows.filter((r) => r.some((v) => v.trim().length > 0));
  return { headers, rows: body };
}

function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ",";
}

export type ImportRow = Partial<Record<ImportField, string>>;

/** Apply the column mapping to the raw rows. */
export function mapRows(rows: string[][], mapping: Record<number, ImportField | "">): ImportRow[] {
  return rows.map((cells) => {
    const out: ImportRow = {};
    for (const [index, field] of Object.entries(mapping)) {
      if (!field) continue;
      const value = (cells[Number(index)] ?? "").trim();
      if (value) out[field] = value;
    }
    return out;
  });
}

export type RowIssue = { line: number; level: "error" | "warning"; reason: "missing_name" | "duplicate_sku" };

/**
 * Validation: a row without a name cannot become a product, and a SKU that
 * repeats — inside the file or against the catalogue — is worth a warning but
 * not a refusal, because sellers legitimately re-import to update.
 */
export function validateRows(rows: ImportRow[], existingSkus: Set<string> = new Set()): RowIssue[] {
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2; // 1-based, plus the header row
    if (!r.name?.trim()) {
      issues.push({ line, level: "error", reason: "missing_name" });
      return;
    }
    const sku = r.sku?.trim().toLowerCase();
    if (sku && (seen.has(sku) || existingSkus.has(sku))) {
      issues.push({ line, level: "warning", reason: "duplicate_sku" });
    }
    if (sku) seen.add(sku);
  });
  return issues;
}

/** The starter file offered next to the upload control. */
export const SAMPLE_CSV = [
  "name,category,sku,description,brand",
  '"Czajnik elektryczny 1,7 l","AGD / Kuchnia",KE-1700,"Stal szczotkowana, podświetlenie",Acme',
  '"Poziomica laserowa 4D",Narzędzia,POZ-4D,"Zielony laser, 16 linii",Acme',
].join("\n");

/** Serialise rejected rows so the seller can fix and re-upload just those. */
export function issuesToCsv(rows: ImportRow[], issues: RowIssue[]): string {
  const byLine = new Map(issues.map((i) => [i.line, i]));
  const header = ["line", "issue", ...IMPORT_FIELDS].join(",");
  const escape = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = rows
    .map((r, i) => ({ r, issue: byLine.get(i + 2) }))
    .filter((x) => x.issue)
    .map(({ r, issue }) => [
      String(issue!.line), issue!.reason, ...IMPORT_FIELDS.map((f) => escape(r[f] ?? "")),
    ].join(","));
  return [header, ...body].join("\n");
}
