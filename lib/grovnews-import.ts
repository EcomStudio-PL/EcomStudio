/**
 * GROVNEWS STAGE 5 — THE RULES OF A BULK SOURCE IMPORT, pure and client-safe.
 *
 * A file is a list of SUGGESTIONS. Nothing in it is trusted: every cell is
 * cleaned, capped and validated here, the server re-checks every row before
 * anything is written, and the database (0125 §3) checks it a third time.
 *
 * The flow is UPLOAD → PARSE → VALIDATE → DEDUPE → TEST → PREVIEW → IMPORT,
 * and only the last step writes. The type a file names is a suggestion too:
 * the test reads the URL and says what it really is, and the preview offers a
 * better type — but only the admin changes it.
 *
 * The same functions run in the browser (the preview's statuses) and on the
 * server (the import's refusals), so the two can never disagree about which
 * row is ready.
 */
import { slugify } from "@/lib/grovnews";
import {
  SOURCE_TYPES, cleanText, isAcceptableSourceUrl, normalizeUrl, type SourceType,
} from "@/lib/grovnews-research";

/* ── limits ────────────────────────────────────────────────────────────────── */

export const IMPORT_LIMITS = {
  /** Bytes of the uploaded file (CSV or XLSX). */
  maxBytes: 1_000_000,
  /** Data rows (the header does not count). */
  maxRows: 500,
  /** Characters in any single cell. */
  maxField: 2000,
  /** Columns read from a row; anything wider is cut. */
  maxColumns: 40,
} as const;

export const IMPORT_FILE_KINDS = ["csv", "xlsx"] as const;
export type ImportFileKind = (typeof IMPORT_FILE_KINDS)[number];

/* ── columns ───────────────────────────────────────────────────────────────── */

/** The columns the import reads. Others (an `id`, a note) are ignored. */
export const IMPORT_COLUMNS = [
  "name", "source_type", "url", "category", "priority", "language", "official_source", "enabled",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Without these a row cannot become a source; a file missing any of them is
 *  refused as a whole (it is the wrong file, not a file with a bad row). */
export const REQUIRED_COLUMNS: readonly ImportColumn[] = ["name", "source_type", "url", "category"];

/** "Source Type", "source-type" and "SOURCE_TYPE" are the same column. */
export function normalizeHeader(h: string): string {
  return String(h ?? "").replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type ColumnMap = Partial<Record<ImportColumn, number>>;

export function mapColumns(headers: readonly string[]): { map: ColumnMap; missing: ImportColumn[] } {
  const map: ColumnMap = {};
  headers.forEach((h, i) => {
    const key = normalizeHeader(h) as ImportColumn;
    if ((IMPORT_COLUMNS as readonly string[]).includes(key) && map[key] === undefined) map[key] = i;
  });
  return { map, missing: REQUIRED_COLUMNS.filter((c) => map[c] === undefined) };
}

/* ── cells ─────────────────────────────────────────────────────────────────── */

/**
 * A cell that a spreadsheet would EVALUATE if it were pasted or exported
 * again (CSV / formula injection): it starts with =, +, -, @, a tab or a
 * carriage return. Such a value is never imported and never re-exported; the
 * preview shows it as inert text.
 */
export function looksLikeFormula(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}

const TRUE = new Set(["true", "1", "yes", "y", "tak", "ja", "wahr", "x"]);
const FALSE = new Set(["false", "0", "no", "n", "nie", "nein", "falsch", ""]);

export function parseBool(value: string, fallback: boolean): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return null;
}

/** 0–100, whole numbers (a spreadsheet's "80.0" is 80). Anything else is an
 *  error — never silently clamped. */
export function parsePriority(value: string): number | null {
  const v = value.trim();
  if (v === "") return 50;
  if (!/^\d{1,3}(\.0+)?$/.test(v)) return null;
  const n = Number.parseInt(v, 10);
  return n >= 0 && n <= 100 ? n : null;
}

export function parseLanguage(value: string): "pl" | "en" | "de" | null {
  const v = value.trim().toLowerCase();
  if (v === "") return "pl";
  return v === "pl" || v === "en" || v === "de" ? v : null;
}

/** Types a bulk import may create: the ones the job reads. API needs an
 *  adapter that does not exist yet; MANUAL has nothing to read. */
export const IMPORTABLE_TYPES = ["RSS", "ATOM", "PUBLIC_FEED", "WEB_PAGE"] as const;
export type ImportableType = (typeof IMPORTABLE_TYPES)[number];
export const isImportableType = (t: unknown): t is ImportableType => (IMPORTABLE_TYPES as readonly unknown[]).includes(t);

/** Preference when the test finds more than one way to read a source:
 *  a feed over a page, RSS over Atom over JSON (0125 brief: API when an
 *  adapter exists — none does — then RSS, Atom, public feed, web page). */
export const TYPE_PREFERENCE: readonly ImportableType[] = ["RSS", "ATOM", "PUBLIC_FEED", "WEB_PAGE"];

/* ── categories ────────────────────────────────────────────────────────────── */

export type CategoryChoice = { id: string; slug: string; name: string };

const fold = (s: string) => slugify(s, 120);

/** An EXISTING category for a label, by slug or by name (case and accents
 *  ignored). A label that matches none is reported, never created. */
export function matchCategory(label: string, categories: readonly CategoryChoice[]): CategoryChoice | null {
  const key = fold(label);
  if (!key) return null;
  return categories.find((c) => c.slug === key || fold(c.name) === key) ?? null;
}

/* ── a row ─────────────────────────────────────────────────────────────────── */

export const ROW_ERRORS = [
  "name", "formula", "url", "url_scheme", "url_host", "type", "type_unsupported", "priority", "language",
  "official", "enabled", "field_too_long",
] as const;
export type RowError = (typeof ROW_ERRORS)[number];

export type ImportRow = {
  /** Position in the file (1-based, the header is line 1). */
  line: number;
  name: string;
  url: string;
  /** Exactly what the file said, for the preview. */
  fileType: string;
  /** The file's type when it is one the import accepts. */
  type: ImportableType | null;
  categoryLabel: string;
  /** The matched existing category; null when none was named or none matched. */
  categoryId: string | null;
  /** A label was given and no category has it (CATEGORY_NOT_FOUND). */
  categoryMissing: boolean;
  priority: number;
  language: "pl" | "en" | "de";
  official: boolean;
  /** The file said something about `official` (an empty cell says nothing:
   *  an UPDATE then keeps the existing source's flag). */
  officialGiven: boolean;
  enabled: boolean;
  errors: RowError[];
  /** Normalised URL — the dedupe key. */
  key: string | null;
  /** Another row of the same file with the same key (its line). */
  duplicateOfLine: number | null;
  /** An existing source with the same key (its name). */
  duplicateOfSource: string | null;
};

/**
 * One file row → one validated row. Never throws; every problem becomes an
 * error code the preview explains. `formulaCells` marks cells an XLSX file
 * stored as formulas — their cached values are not trusted either.
 */
export function readRow(
  cells: readonly string[], map: ColumnMap, line: number, categories: readonly CategoryChoice[],
  formulaCells: ReadonlySet<number> = new Set(),
): ImportRow {
  const errors = new Set<RowError>();
  const raw = (c: ImportColumn): string => {
    const i = map[c];
    if (i === undefined) return "";
    const v = String(cells[i] ?? "");
    if (v.length > IMPORT_LIMITS.maxField) errors.add("field_too_long");
    if (formulaCells.has(i)) errors.add("formula");
    return v.slice(0, IMPORT_LIMITS.maxField);
  };

  const nameRaw = raw("name");
  const name = cleanText(nameRaw, 200).replace(/\n/g, " ");
  if (looksLikeFormula(nameRaw.trimStart()) || looksLikeFormula(nameRaw)) errors.add("formula");
  if (!name || name.length > 120) errors.add("name");

  const url = raw("url").trim();
  if (looksLikeFormula(url)) errors.add("formula");
  let scheme = "";
  try { scheme = new URL(url).protocol; } catch { scheme = ""; }
  if (!url) errors.add("url");
  else if (scheme !== "https:") errors.add(scheme ? "url_scheme" : "url");
  else if (!isAcceptableSourceUrl(url)) errors.add("url_host");

  const fileType = cleanText(raw("source_type"), 40).toUpperCase().replace(/[\s-]+/g, "_");
  let type: ImportableType | null = null;
  if (isImportableType(fileType)) type = fileType;
  else if ((SOURCE_TYPES as readonly string[]).includes(fileType)) errors.add("type_unsupported");
  else errors.add("type");

  const categoryLabel = cleanText(raw("category"), 120).replace(/\n/g, " ");
  const category = categoryLabel ? matchCategory(categoryLabel, categories) : null;

  const priority = parsePriority(raw("priority"));
  if (priority === null) errors.add("priority");
  const language = parseLanguage(raw("language"));
  if (language === null) errors.add("language");
  const officialRaw = raw("official_source");
  const official = parseBool(officialRaw, false);
  if (official === null) errors.add("official");
  const enabled = parseBool(raw("enabled"), true);
  if (enabled === null) errors.add("enabled");

  return {
    line, name, url, fileType: fileType || "—", type,
    categoryLabel, categoryId: category?.id ?? null, categoryMissing: Boolean(categoryLabel) && !category,
    priority: priority ?? 50, language: language ?? "pl", official: official ?? false, officialGiven: officialRaw.trim() !== "", enabled: enabled ?? true,
    errors: ROW_ERRORS.filter((e) => errors.has(e)),
    key: errors.has("url") || errors.has("url_scheme") || errors.has("url_host") ? null : normalizeUrl(url),
    duplicateOfLine: null, duplicateOfSource: null,
  };
}

/**
 * Mark duplicates: the same normalised URL earlier in the file, or an
 * existing source with the same URL or the same final address after
 * redirects. The default for a duplicate is SKIP.
 */
export function markDuplicates(
  rows: ImportRow[], existing: readonly { name: string; url: string | null; resolvedUrl: string | null }[],
): ImportRow[] {
  const known = new Map<string, string>();
  for (const s of existing) {
    for (const u of [s.url, s.resolvedUrl]) {
      const k = u ? normalizeUrl(u) : null;
      if (k && !known.has(k)) known.set(k, s.name);
    }
  }
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (!r.key) return r;
    const out = { ...r };
    const first = seen.get(r.key);
    if (first !== undefined) out.duplicateOfLine = first;
    else seen.set(r.key, r.line);
    out.duplicateOfSource = known.get(r.key) ?? null;
    return out;
  });
}

/* ── the test's result, as the preview and the import see it ───────────────── */

/** What reading the URL established. */
export const PROBE_VERDICTS = ["OK", "EMPTY", "UNSUPPORTED", "FAILED", "RETRY"] as const;
export type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

/** One verified way to read a source: this URL, as this type, listed this
 *  many entries at `checkedAt`. `sig` is the server's signature over exactly
 *  that — the import accepts nothing the server did not itself read. */
export type ProbeOption = { type: ImportableType; url: string; entries: number; checkedAt: string; sig: string };

export type ProbeSummary = {
  verdict: ProbeVerdict;
  /** Why it is not OK: a fetch error code, `robots`, `requires_access`,
   *  `bot_protection`, `empty`. */
  code: string | null;
  httpStatus: number | null;
  /** Where the URL ended up after redirects. */
  resolvedUrl: string | null;
  /** What the URL itself serves. */
  detectedType: ImportableType | null;
  /** A feed the page announces (`<link rel="alternate">`) or a standard
   *  feed address that answered with a real feed. */
  feedUrl: string | null;
  /** Every verified (url, type) that works, best first. */
  options: ProbeOption[];
  /** The best option, when it differs from what the file asked for. */
  recommended: { type: ImportableType; url: string } | null;
  sample: string[];
  checkedAt: string;
};

export const ROW_STATUSES = ["READY", "ATTENTION", "ERROR", "DUPLICATE"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export type RowProblem =
  | RowError | "duplicate_in_file" | "duplicate_existing" | "untested" | "retry" | "empty" | "unsupported" | "failed"
  | "category_not_found" | "type_mismatch";

/** What the admin chose for a row (the file's values until they change them). */
export type RowChoice = { type: ImportableType | null; url: string; categoryId: string | null; categoryResolved: boolean };

export function defaultChoice(row: ImportRow): RowChoice {
  return { type: row.type, url: row.url, categoryId: row.categoryId, categoryResolved: !row.categoryMissing };
}

/** The option the test verified for exactly this (url, type), if any. */
export function optionFor(probe: ProbeSummary | null, choice: Pick<RowChoice, "type" | "url">): ProbeOption | null {
  if (!probe || !choice.type) return null;
  return probe.options.find((o) => o.type === choice.type && o.url === choice.url) ?? null;
}

/**
 * THE status of a row — the same function decides it in the preview and on
 * the server. READY means: valid, not a duplicate, a category settled, and
 * the test read something from exactly the (url, type) that will be saved.
 */
export function rowStatus(row: ImportRow, probe: ProbeSummary | null, choice: RowChoice): { status: RowStatus; problems: RowProblem[] } {
  if (row.errors.length) return { status: "ERROR", problems: [...row.errors] };
  if (row.duplicateOfSource) return { status: "DUPLICATE", problems: ["duplicate_existing"] };
  if (row.duplicateOfLine !== null) return { status: "DUPLICATE", problems: ["duplicate_in_file"] };
  if (!probe) return { status: "ATTENTION", problems: ["untested"] };
  if (probe.verdict === "UNSUPPORTED") return { status: "ERROR", problems: ["unsupported"] };
  if (probe.verdict === "FAILED") return { status: "ERROR", problems: ["failed"] };
  const problems: RowProblem[] = [];
  if (probe.verdict === "RETRY") problems.push("retry");
  if (probe.verdict === "EMPTY") problems.push("empty");
  if (!choice.categoryResolved) problems.push("category_not_found");
  if (probe.verdict === "OK" && !optionFor(probe, choice)) problems.push("type_mismatch");
  return problems.length ? { status: "ATTENTION", problems } : { status: "READY", problems: [] };
}

/* ── counts ────────────────────────────────────────────────────────────────── */

export type ImportCounts = Record<RowStatus, number>;

export function countStatuses(statuses: readonly RowStatus[]): ImportCounts {
  const out: ImportCounts = { READY: 0, ATTENTION: 0, ERROR: 0, DUPLICATE: 0 };
  for (const s of statuses) out[s]++;
  return out;
}

/** The outcome of an import, as the database reports it (0125 §3). */
export type ImportReport = {
  total: number; imported: number; updated: number; duplicate: number; failed: number; skipped: number;
};
