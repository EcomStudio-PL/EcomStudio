"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { isUuid } from "@/lib/grovnews";
import { FETCHED_TYPES, cleanText, isAcceptableSourceUrl, normalizeUrl } from "@/lib/grovnews-research";
import {
  IMPORT_LIMITS, isImportableType, mapColumns, markDuplicates, readRow, type ImportReport, type ImportRow,
  type ImportableType, type ProbeOption, type ProbeSummary,
} from "@/lib/grovnews-import";
import { SheetError, readSourceFile } from "@/lib/server/grovnews/sheet";
import { healthFromProbe, probeMany, verifyOption } from "@/lib/server/grovnews/probe";
import * as store from "@/lib/server/grovnews/store";
import { healthFromApiProbe, probeApiSource } from "@/lib/server/grovnews/api";

/**
 * GROVNEWS STAGE 5 — bulk source import and source health (admin only).
 *
 * UPLOAD → PARSE → VALIDATE → DEDUPE (previewSourceImportAction, nothing
 * fetched, nothing saved) → TEST (probeImportRowsAction, nothing saved) →
 * PREVIEW (the admin chooses) → IMPORT (importSourcesAction — the only step
 * that writes, and only rows the server itself tested successfully).
 *
 * Every export re-checks the ADMIN ROLE first; RLS and the admin-only
 * database function check again underneath. The file is read in memory and
 * never stored; the audit log records who imported what file, when, and the
 * counts — not the file.
 */

type Fail<E extends string = never> = { ok: false; error: "forbidden" | "invalid" | "generic" | E };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const forbidden = (e: unknown) => e instanceof Error && e.message === "forbidden";
const failed = (e: unknown): Fail => ({ ok: false, error: forbidden(e) ? "forbidden" : "generic" });

function revalidateSources() {
  revalidatePath("/admin/newsletter/grovnews/zrodla");
  revalidatePath("/admin/newsletter/grovnews", "layout");
}

/** One request's budget: a server action runs in the Źródła page segment
 *  (maxDuration 300); new reads stop well before that. */
const PROBE_BUDGET_MS = 200_000;
const MAX_PROBES_PER_CALL = 60;

type Existing = { id: string; name: string; url: string | null; resolvedUrl: string | null };

async function existingSources(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"]): Promise<Existing[]> {
  const { data } = await supabase.from("grovnews_sources").select("id, name, url, resolved_url").limit(5000);
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, url: s.url, resolvedUrl: s.resolved_url }));
}

/* ── 1. parse, validate, dedupe ────────────────────────────────────────────── */

export type ImportPreview = {
  ok: true; fileName: string; kind: "csv" | "xlsx"; sheet: string | null; rows: ImportRow[];
};

/**
 * Read the uploaded file and return its rows, validated and de-duplicated —
 * nothing is fetched and nothing is saved. A wrong file (not CSV/XLSX, too
 * large, too many rows, the required columns missing) is refused whole.
 */
export async function previewSourceImportAction(form: FormData):
  Promise<ImportPreview | Fail<"file" | "tooLarge" | "empty" | "unsupported" | "tooManyRows" | "columns"> & { missing?: string[] }> {
  try {
    const { supabase } = await requireAdmin();
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "file" };
    if (file.size > IMPORT_LIMITS.maxBytes) return { ok: false, error: "tooLarge" };
    const fileName = cleanText(file.name, 200).replace(/\n/g, " ") || "import";
    let table;
    try {
      table = readSourceFile(fileName, Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      if (!(e instanceof SheetError)) throw e;
      const map = { too_large: "tooLarge", empty: "empty", unsupported: "unsupported", invalid: "unsupported", too_many_rows: "tooManyRows" } as const;
      return { ok: false, error: map[e.code] };
    }
    const { map, missing } = mapColumns(table.headers);
    if (missing.length) return { ok: false, error: "columns", missing };
    const { data: cats } = await supabase.from("grovnews_categories").select("id, slug, name").eq("is_active", true);
    const rows = markDuplicates(
      table.rows.map((cells, i) => readRow(cells, map, i + 2, cats ?? [], table.formulas[i])),
      await existingSources(supabase),
    );
    return { ok: true, fileName, kind: table.kind, sheet: table.sheet, rows };
  } catch (e) {
    return failed(e);
  }
}

/* ── 2. test (read) — nothing is saved ─────────────────────────────────────── */

/**
 * Read up to sixty URLs and say what each really is. At most four at a time,
 * one per host at a time, stopping before the request's deadline: whatever
 * was not reached comes back in `pending` for the next call.
 */
export async function probeImportRowsAction(items: { key: string; url: string }[]):
  Promise<{ ok: true; results: Record<string, ProbeSummary>; pending: string[] } | Fail> {
  try {
    await requireAdmin();
    const list = (Array.isArray(items) ? items : []).slice(0, MAX_PROBES_PER_CALL)
      .filter((it) => it && typeof it.key === "string" && it.key.length <= 40 && typeof it.url === "string" && it.url.length <= 2000);
    const { results, pending } = await probeMany(list, { concurrency: 4, deadline: Date.now() + PROBE_BUDGET_MS });
    return { ok: true, results: Object.fromEntries(results), pending };
  } catch (e) {
    return failed(e);
  }
}

/* ── 3. import ─────────────────────────────────────────────────────────────── */

export type ImportPayloadRow = {
  line: number; name: string; categoryId: string | null; priority: number; language: "pl" | "en" | "de";
  /** null (UPDATE only): keep the existing source's flag. */
  official: boolean | null; enabled: boolean;
  /** The verified way to read it, exactly as the test signed it — or null for
   *  an UPDATE of the existing source at `existingUrl` (nothing to read). */
  option: ProbeOption | null;
  existingUrl?: string;
  /** Where the URL ends up after redirects (dedupe), as the test saw it. */
  resolvedUrl: string | null;
  detectedType: ImportableType | null;
  httpStatus: number | null;
};

/**
 * Save the rows the admin selected — each one re-validated, and each one
 * only if the server's own test read something from exactly the URL and type
 * being saved (the signature proves it; an unsigned, altered or stale test is
 * refused). An existing source is SKIPPED unless the admin asked to UPDATE.
 * One database statement; the audit records the file and the counts.
 */
export async function importSourcesAction(input: { fileName: string; totalRows: number; updateExisting: boolean; rows: ImportPayloadRow[] }):
  Promise<{ ok: true; report: ImportReport; outcomes: { line: number; outcome: string; error?: string }[] } | Fail<"noServerKey" | "tooMany">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!store.serverTokenAvailable()) return { ok: false, error: "noServerKey" };
    const rows = Array.isArray(input?.rows) ? input.rows : [];
    if (rows.length === 0) return { ok: false, error: "invalid" };
    if (rows.length > IMPORT_LIMITS.maxRows) return { ok: false, error: "tooMany" };
    const fileName = cleanText(input.fileName, 200).replace(/\n/g, " ") || "import";
    const { data: cats } = await supabase.from("grovnews_categories").select("id");
    const categoryIds = new Set((cats ?? []).map((c) => c.id));
    const existing = await existingSources(supabase);
    // An existing source by any of its addresses, normalised the way the
    // preview normalises them (www., trailing slash, tracking parameters…).
    const known = new Map<string, Existing>();
    for (const s of existing) {
      for (const u of [s.url, s.resolvedUrl]) {
        const k = u ? normalizeUrl(u) : null;
        if (k && !known.has(k)) known.set(k, s);
      }
    }

    const outcomes: { line: number; outcome: string; error?: string }[] = [];
    const accepted: { line: number; row: Record<string, unknown> }[] = [];
    const seen = new Set<string>();
    const now = Date.now();
    for (const r of rows) {
      const line = Number.isInteger(r?.line) ? r.line : 0;
      const o = r?.option ?? null;
      const name = cleanText(r?.name, 200).replace(/\n/g, " ");
      const reject = (error: string) => outcomes.push({ line, outcome: "failed", error });
      if (!name || name.length > 120 || /^[=+\-@\t\r]/.test(name)) { reject("name"); continue; }
      if (r.categoryId !== null && (!isUuid(r.categoryId) || !categoryIds.has(r.categoryId))) { reject("category"); continue; }
      if (!Number.isInteger(r.priority) || r.priority < 0 || r.priority > 100) { reject("priority"); continue; }
      if (!["pl", "en", "de"].includes(r.language)) { reject("language"); continue; }
      const describe = {
        name, category_id: r.categoryId, priority: r.priority, language: r.language,
        official: r.official === true ? true : r.official === false ? false : null,
      };

      // UPDATE of a source that already exists: only with the admin's explicit
      // consent, only what describes it — never its URL, type or on/off, so it
      // needs no new test.
      const asUpdate = (match: Existing) => {
        if (!input.updateExisting || !match.url) { outcomes.push({ line, outcome: "duplicate" }); return; }
        if (seen.has(`id:${match.id}`)) { outcomes.push({ line, outcome: "duplicate" }); return; }
        seen.add(`id:${match.id}`);
        accepted.push({ line, row: { ...describe, url: match.url, update: true } });
      };
      if (o === null) {
        const k = typeof r.existingUrl === "string" && isAcceptableSourceUrl(r.existingUrl) ? normalizeUrl(r.existingUrl) : null;
        const match = k ? known.get(k) : undefined;
        if (!match) { reject("url"); continue; }
        asUpdate(match);
        continue;
      }

      if (!isImportableType(o.type) || typeof o.url !== "string" || !isAcceptableSourceUrl(o.url)) { reject("url"); continue; }
      if (!verifyOption(o, now)) { reject("untested"); continue; }
      const resolvedRaw = typeof r.resolvedUrl === "string" ? r.resolvedUrl.trim() : "";
      const resolved = resolvedRaw && isAcceptableSourceUrl(resolvedRaw) ? resolvedRaw : null;
      const keys = [normalizeUrl(o.url), resolved ? normalizeUrl(resolved) : null].filter((k): k is string => Boolean(k));
      // A new row whose tested address turns out to be an existing source (a
      // chosen feed, a redirect) is a duplicate — never a silent UPDATE: the
      // preview did not show it as one.
      if (keys.some((k) => known.has(k))) { outcomes.push({ line, outcome: "duplicate" }); continue; }
      if (keys.some((k) => seen.has(k))) { outcomes.push({ line, outcome: "duplicate" }); continue; }
      keys.forEach((k) => seen.add(k));
      accepted.push({
        line,
        row: {
          name, type: o.type, url: o.url, resolved_url: resolved, category_id: r.categoryId, priority: r.priority,
          language: r.language, official: r.official === true, enabled: r.enabled !== false, health_status: "HEALTHY",
          detected_type: r.detectedType && (FETCHED_TYPES as readonly string[]).includes(r.detectedType) ? r.detectedType : null,
          http: Number.isInteger(r.httpStatus) ? r.httpStatus : null, entries: o.entries,
        },
      });
    }

    let db = { imported: 0, updated: 0, duplicate: 0, failed: 0, results: [] as { index: number; outcome: string; error?: string }[] };
    if (accepted.length) {
      const { data, error } = await supabase.rpc("grovnews_import_sources", {
        p_rows: accepted.map((a) => a.row) as never, p_update_existing: input.updateExisting === true,
      });
      if (error) return { ok: false, error: "generic" };
      db = data as typeof db;
      for (const res of db.results ?? []) {
        const line = accepted[res.index]?.line ?? 0;
        outcomes.push({ line, outcome: res.outcome, ...(res.error ? { error: res.error } : {}) });
      }
    }
    const count = (o: string) => outcomes.filter((x) => x.outcome === o).length;
    const report: ImportReport = {
      total: Math.max(rows.length, Number.isInteger(input.totalRows) ? input.totalRows : 0),
      imported: count("imported"), updated: count("updated"), duplicate: count("duplicate"), failed: count("failed"),
      skipped: Math.max(0, (Number.isInteger(input.totalRows) ? input.totalRows : rows.length) - rows.length),
    };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.sources_imported", entityType: "grovnews_source",
      after: { file: fileName, update_existing: input.updateExisting === true, ...report },
    });
    revalidateSources();
    outcomes.sort((a, b) => a.line - b.line);
    return { ok: true, report, outcomes };
  } catch (e) {
    return failed(e);
  }
}

/* ── 4. source health: "Sprawdź wszystkie źródła" ──────────────────────────── */

/**
 * Test the sources not yet checked since `since` (the moment the admin pressed
 * the button) — the least recently checked first, four at a time, one per
 * host — and record each one's health. Returns how many remain; the screen
 * calls again until none do. One slow site never holds the rest, and a single
 * timeout never marks anything FAILED (0125 §2.1).
 */
export async function checkSourcesAction(since: string):
  Promise<{ ok: true; checked: number; remaining: number; statuses: Record<string, number> } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const asked = Date.parse(since);
    if (!Number.isFinite(asked)) return { ok: false, error: "invalid" };
    // Never later than this server's now: a browser clock that runs ahead must
    // not keep just-checked sources "due" and test them again.
    const from = Math.min(asked, Date.now());
    const { data } = await supabase.from("grovnews_sources")
      .select("id, url, source_type, last_checked_at, auth_kind, auth_header").eq("enabled", true).in("source_type", [...FETCHED_TYPES, "API"])
      .not("url", "is", null).order("last_checked_at", { ascending: true, nullsFirst: true }).limit(2000);
    const due = (data ?? []).filter((s) => s.url && (!s.last_checked_at || Date.parse(s.last_checked_at) < from));
    const batch = due.slice(0, MAX_PROBES_PER_CALL);
    // Feeds and pages through the public probe; API sources (0128) through
    // their own reader — a key, if any, to their own origin only.
    const feeds = batch.filter((s) => s.source_type !== "API");
    const apis = batch.filter((s) => s.source_type === "API");
    const { results } = await probeMany(feeds.map((s) => ({ key: s.id, url: s.url as string })), {
      concurrency: 4, deadline: Date.now() + PROBE_BUDGET_MS,
    });
    const statuses: Record<string, number> = {};
    for (const s of feeds) {
      const probe = results.get(s.id);
      if (!probe) continue;
      const status = await store.sourceChecked(supabase, s.id, healthFromProbe(probe, { url: s.url as string, type: s.source_type }));
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    const apiDeadline = Date.now() + PROBE_BUDGET_MS;
    for (const s of apis) {
      if (Date.now() + 20_000 > apiDeadline) break;
      const probe = await probeApiSource(supabase, {
        id: s.id, url: s.url, authKind: s.auth_kind === "bearer" || s.auth_kind === "header" ? s.auth_kind : "none", authHeader: s.auth_header,
      });
      const status = await store.sourceChecked(supabase, s.id, healthFromApiProbe(probe));
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    const checked = Object.values(statuses).reduce((a, b) => a + b, 0);
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.sources_checked", entityType: "grovnews_source", after: { checked, ...statuses },
    });
    revalidateSources();
    return { ok: true, checked, remaining: Math.max(0, due.length - checked), statuses };
  } catch (e) {
    return failed(e);
  }
}
