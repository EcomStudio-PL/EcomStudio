"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, FileSpreadsheet, FlaskConical, Square, Upload, Wand2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { ConfirmModal } from "@/components/ui/modal";
import {
  importSourcesAction, previewSourceImportAction, probeImportRowsAction, type ImportPayloadRow,
} from "@/app/actions/grovnews-sources";
import {
  IMPORT_COLUMNS, IMPORT_LIMITS, IMPORTABLE_TYPES, REQUIRED_COLUMNS, countStatuses, defaultChoice, looksLikeFormula,
  optionFor, rowStatus, type ImportReport, type ImportRow, type ProbeSummary, type RowChoice, type RowProblem,
  type RowStatus,
} from "@/lib/grovnews-import";
import type { CategoryRow } from "@/lib/services/grovnews";

/**
 * GROVNEWS STAGE 5 — BULK SOURCE IMPORT, the admin's side.
 *
 * UPLOAD → PARSE/VALIDATE/DEDUPE → TEST → PREVIEW → IMPORT. Choosing a file
 * does nothing; reading it only validates; the test only reads the URLs; the
 * one step that writes is "Importuj zaznaczone", behind a confirmation, and it
 * sends only the rows that are READY and that the admin selected. Everything
 * before that lives in this component's state and is gone on "Anuluj".
 *
 * A better type or address found by the test is OFFERED, never applied: the
 * admin switches a row to one of the options the server verified (and
 * signed), row by row or with the explicit "apply all" button.
 */

const STATUS_TONE: Record<RowStatus, "success" | "warning" | "danger" | "neutral"> = {
  READY: "success", ATTENTION: "warning", ERROR: "danger", DUPLICATE: "neutral",
};
const STATUS_ORDER: readonly RowStatus[] = ["READY", "ATTENTION", "ERROR", "DUPLICATE"];

const FILE_ERRORS = ["forbidden", "invalid", "generic", "file", "tooLarge", "empty", "unsupported", "tooManyRows", "columns"] as const;
const IMPORT_ERRORS = ["noServerKey", "tooMany", "invalid", "forbidden", "generic"] as const;
const PROBE_ERRORS = ["forbidden", "invalid", "generic"] as const;
/** Why the server refused a row at import time (the action's checks + 0125 §3). */
const REASONS = ["url", "untested", "name", "category", "priority", "language", "not_healthy", "type", "invalid"] as const;
const REPORT_KEYS = ["total", "imported", "updated", "duplicate", "failed", "skipped"] as const;

const oneOf = <V extends string>(list: readonly V[], value: string | undefined, fallback: V): V =>
  (list as readonly string[]).includes(value ?? "") ? (value as V) : fallback;

const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** The action reads at most sixty URLs per call (MAX_PROBES_PER_CALL). */
const PROBE_BATCH = 60;
/** Bulk buttons may wrap to two lines on a phone instead of overflowing. */
const BULK = "h-auto min-h-9 py-1.5 text-left";
const OPTIONAL_COLUMNS = IMPORT_COLUMNS.filter((c) => !REQUIRED_COLUMNS.includes(c));
/** The limits as the help and the refusals quote them. */
const LIMIT_VARS = { mb: Math.round(IMPORT_LIMITS.maxBytes / 100_000) / 10, rows: IMPORT_LIMITS.maxRows };

/** "blog.example.com/feed" — enough to tell two addresses apart in a cell. */
function shortUrl(url: string, max = 60): string {
  let s = url;
  try {
    const u = new URL(url);
    s = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    s = url;
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const validPriority = (v: string) => /^\d{1,3}$/.test(v.trim()) && Number(v) >= 0 && Number(v) <= 100;

/** A row the test may read: valid, and not already a source or a repeat. */
const isTestable = (r: ImportRow) => r.errors.length === 0 && !r.duplicateOfSource && r.duplicateOfLine === null;

type Preview = { fileName: string; kind: "csv" | "xlsx"; sheet: string | null; rows: ImportRow[] };
/** A probe and the exact URL it read (the row's choice may change later). */
type Tested = { url: string; probe: ProbeSummary };
/** What this screen lets the admin change per row. `official` is shown and
 *  editable because it relaxes the daily review gate (one official source is
 *  enough to publish) — a file never sets it unseen. */
type Edit = { name: string; priority: string; official: boolean; officialSet: boolean };
type Outcome = { report: ImportReport; failed: { line: number; name: string | null; reason: string }[] };

/**
 * The status the preview shows: the shared rule (rowStatus — the same one the
 * server applies), plus the two fields only this screen can change. A name or
 * priority the admin broke keeps a row from READY until it is fixed.
 */
function statusOf(row: ImportRow, probe: ProbeSummary | null, choice: RowChoice, edit: Edit): { status: RowStatus; problems: RowProblem[] } {
  const base = rowStatus(row, probe, choice);
  if (base.status === "ERROR" || base.status === "DUPLICATE") return base;
  const extra: RowProblem[] = [];
  const name = edit.name.trim();
  if (!name || name.length > 120) extra.push("name");
  else if (looksLikeFormula(name)) extra.push("formula");
  if (!validPriority(edit.priority)) extra.push("priority");
  return extra.length ? { status: "ATTENTION", problems: [...base.problems, ...extra] } : base;
}

export function SourceImport({ categories, describeError, onClose }: {
  categories: CategoryRow[];
  /** The fetcher's error code as a sentence (the same labels as the sources table). */
  describeError: (code: string) => string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [inputKey, setInputKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [tested, setTested] = useState<Record<number, Tested>>({});
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // "Anuluj", "Nowy import" and closing the panel bump the generation: an
  // answer that arrives afterwards belongs to a panel that no longer exists.
  const generation = useRef(0);
  const stopRef = useRef(false);
  useEffect(() => () => { stopRef.current = true; generation.current += 1; }, []);

  const activeCategories = useMemo(() => categories.filter((c) => c.is_active), [categories]);

  const views = useMemo(() => (preview?.rows ?? []).map((row) => {
    const choice = choices[row.line] ?? defaultChoice(row);
    const entry = tested[row.line] ?? null;
    const edit = edits[row.line] ?? { name: row.name, priority: String(row.priority), official: row.official, officialSet: row.officialGiven };
    return { row, choice, entry, edit, testable: isTestable(row), ...statusOf(row, entry?.probe ?? null, choice, edit) };
  }), [preview, choices, tested, edits]);
  type View = (typeof views)[number];

  const counts = countStatuses(views.map((v) => v.status));
  const testableCount = views.filter((v) => v.testable).length;
  const testedCount = views.filter((v) => v.testable && v.entry).length;
  const ready = views.filter((v) => v.status === "READY");
  /** With the admin's consent, a row naming a source that already exists may
   *  update what describes it (nothing is read, so nothing needs a test). */
  const updatable = (v: View) => updateExisting && v.row.errors.length === 0 && v.row.duplicateOfSource !== null
    && v.row.duplicateOfLine === null && !v.row.categoryMissing && validPriority(v.edit.priority);
  const selectable = (v: View) => v.status === "READY" || updatable(v);
  const chosen = views.filter((v) => selectable(v) && selected.has(v.row.line));
  const retestable = views.filter((v) => v.testable && (!v.entry || v.entry.probe.verdict === "RETRY"));
  const recommendations = views.filter((v) => {
    const rec = v.entry?.probe.verdict === "OK" ? v.entry.probe.recommended : null;
    return v.testable && rec !== null && (rec.type !== v.choice.type || rec.url !== v.choice.url);
  });
  const anyUnsupported = views.some((v) => v.problems.includes("unsupported"));
  const testing = progress !== null;

  const reset = () => {
    generation.current += 1;
    stopRef.current = true;
    setInputKey((k) => k + 1);
    setFile(null); setFileError(null); setParsing(false); setPreview(null);
    setChoices({}); setEdits({}); setTested({}); setSelected(new Set());
    setProgress(null); setStopping(false); setUpdateExisting(false);
    setConfirming(false); setImporting(false); setOutcome(null);
  };

  /* ── TEST: read the URLs, sixty per call, until none is pending ─────────── */
  const runProbes = async (items: { line: number; url: string }[]) => {
    if (items.length === 0) return;
    const gen = generation.current;
    stopRef.current = false;
    setStopping(false);
    const total = items.length;
    let queue = [...items];
    let done = 0;
    let idle = 0;
    let broken = false;
    setProgress({ done, total });
    while (queue.length > 0 && !stopRef.current) {
      const chunk = queue.slice(0, PROBE_BATCH);
      const res = await probeImportRowsAction(chunk.map((it) => ({ key: String(it.line), url: it.url }))).catch(() => null);
      if (gen !== generation.current) return;
      if (!res || !res.ok) {
        toast.error(t(`grovnewsAdm.sourceImport.probeErr.${oneOf(PROBE_ERRORS, res?.error, "generic")}`));
        broken = true;
        break;
      }
      const got: Record<number, Tested> = {};
      for (const it of chunk) {
        const probe = res.results[String(it.line)];
        if (probe) got[it.line] = { url: it.url, probe };
      }
      const reached = Object.keys(got).length;
      setTested((prev) => ({ ...prev, ...got }));
      done += reached;
      const pending = new Set(res.pending);
      queue = [...chunk.filter((it) => !got[it.line] && pending.has(String(it.line))), ...queue.slice(PROBE_BATCH)];
      setProgress({ done, total });
      // Two calls in a row that read nothing: stop rather than loop forever.
      idle = reached === 0 ? idle + 1 : 0;
      if (idle >= 2) { toast.warning(t("grovnewsAdm.sourceImport.testStalled")); broken = true; break; }
    }
    if (gen !== generation.current) return;
    const stopped = stopRef.current;
    setProgress(null);
    setStopping(false);
    if (broken) return;
    if (stopped) toast.info(t("grovnewsAdm.sourceImport.testStopped", { done, total }));
    else toast.success(t("grovnewsAdm.sourceImport.testDone", { done, total }));
  };

  const stopProbes = () => { stopRef.current = true; setStopping(true); };

  /* ── UPLOAD → PARSE/VALIDATE/DEDUPE (nothing fetched, nothing saved) ──── */
  const analyze = async () => {
    if (!file) return;
    if (file.size > IMPORT_LIMITS.maxBytes) { setFileError(t("grovnewsAdm.sourceImport.fileErr.tooLarge", LIMIT_VARS)); return; }
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setFileError(t("grovnewsAdm.sourceImport.fileErr.unsupported")); return; }
    const gen = generation.current;
    setParsing(true);
    setFileError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await previewSourceImportAction(form).catch(() => null);
    if (gen !== generation.current) return;
    setParsing(false);
    if (!res) { setFileError(t("grovnewsAdm.sourceImport.fileErr.generic")); return; }
    if (!res.ok) {
      const code = oneOf(FILE_ERRORS, res.error, "generic");
      setFileError(code === "columns"
        ? t("grovnewsAdm.sourceImport.fileErr.columns", { columns: (res.missing ?? []).join(", ") || REQUIRED_COLUMNS.join(", ") })
        : t(`grovnewsAdm.sourceImport.fileErr.${code}`, LIMIT_VARS));
      return;
    }
    setPreview({ fileName: res.fileName, kind: res.kind, sheet: res.sheet, rows: res.rows });
    setChoices(Object.fromEntries(res.rows.map((r) => [r.line, defaultChoice(r)])));
    setEdits({}); setTested({}); setSelected(new Set()); setOutcome(null);
    await runProbes(res.rows.filter(isTestable).map((r) => ({ line: r.line, url: r.url })));
  };

  /* ── PREVIEW: the admin's choices ───────────────────────────────────────── */
  const setChoice = (line: number, patch: Partial<RowChoice>) =>
    setChoices((prev) => {
      const current = prev[line];
      return current ? { ...prev, [line]: { ...current, ...patch } } : prev;
    });
  const setEdit = (v: View, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [v.row.line]: { ...(prev[v.row.line] ?? v.edit), ...patch } }));
  const toggle = (line: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(line); else next.delete(line);
      return next;
    });

  const applyRecommendation = (v: View) => {
    const rec = v.entry?.probe.recommended;
    if (rec) setChoice(v.row.line, { type: rec.type, url: rec.url });
  };
  const applyAll = () => {
    if (recommendations.length === 0) { toast.info(t("grovnewsAdm.sourceImport.noRecommendations")); return; }
    setChoices((prev) => {
      const next = { ...prev };
      for (const v of recommendations) {
        const rec = v.entry?.probe.recommended;
        const current = next[v.row.line];
        if (rec && current) next[v.row.line] = { ...current, type: rec.type, url: rec.url };
      }
      return next;
    });
    toast.success(t("grovnewsAdm.sourceImport.applied", { count: recommendations.length }));
  };

  /* ── IMPORT: the only step that writes ──────────────────────────────────── */
  const payload = (): ImportPayloadRow[] => chosen.flatMap((v): ImportPayloadRow[] => {
    if (v.status !== "READY") {
      return [{
        line: v.row.line, name: v.edit.name.trim(), categoryId: v.choice.categoryId, priority: Number(v.edit.priority),
        language: v.row.language, official: v.edit.officialSet ? v.edit.official : null, enabled: v.row.enabled, option: null, existingUrl: v.row.url,
        resolvedUrl: null, detectedType: null, httpStatus: null,
      }];
    }
    const probe = v.entry?.probe ?? null;
    const option = optionFor(probe, v.choice);
    if (!probe || !option || !v.entry) return [];
    // What the probe established is about the URL it READ. When the admin
    // chose a feed the page announced, the page's detected type would mislabel
    // the new source; the verified option's own type is used instead.
    const own = option.url === v.entry.url || (probe.resolvedUrl !== null && option.url === probe.resolvedUrl);
    return [{
      line: v.row.line, name: v.edit.name.trim(), categoryId: v.choice.categoryId, priority: Number(v.edit.priority),
      language: v.row.language, official: v.edit.official, enabled: v.row.enabled, option,
      resolvedUrl: probe.resolvedUrl,
      detectedType: own ? probe.detectedType : (probe.options.find((o) => o.url === option.url)?.type ?? null),
      httpStatus: probe.httpStatus,
    }];
  });

  const runImport = async () => {
    if (!preview) return;
    const rows = payload();
    if (rows.length === 0) { setConfirming(false); return; }
    const gen = generation.current;
    setImporting(true);
    const res = await importSourcesAction({
      fileName: preview.fileName, totalRows: preview.rows.length, updateExisting, rows,
    }).catch(() => null);
    if (gen !== generation.current) return;
    setImporting(false);
    setConfirming(false);
    if (!res || !res.ok) {
      toast.error(t(`grovnewsAdm.sourceImport.importErr.${oneOf(IMPORT_ERRORS, res?.error, "generic")}`, LIMIT_VARS));
      return;
    }
    const names = new Map(views.map((v) => [v.row.line, v.edit.name.trim() || v.row.name]));
    setOutcome({
      report: res.report,
      failed: res.outcomes.filter((o) => o.outcome === "failed")
        .map((o) => ({ line: o.line, name: names.get(o.line) ?? null, reason: o.error ?? "invalid" })),
    });
    setSelected(new Set());
    const summary = t("grovnewsAdm.sourceImport.report.summary", {
      imported: res.report.imported, updated: res.report.updated, duplicate: res.report.duplicate, failed: res.report.failed,
    });
    if (res.report.failed > 0) toast.warning(summary); else toast.success(summary);
    router.refresh();
  };

  /* ── render ─────────────────────────────────────────────────────────────── */
  const problemText = (v: View, p: RowProblem) => t(`grovnewsAdm.sourceImport.problem.${p}`, {
    line: v.row.duplicateOfLine ?? "", name: v.row.duplicateOfSource ?? "", label: v.row.categoryLabel,
  });
  const optionLabel = (type: string, url: string) =>
    t("grovnewsAdm.sourceImport.option", { type: t(`grovnewsAdm.sourceType.${oneOf(IMPORTABLE_TYPES, type, "WEB_PAGE")}`), url: shortUrl(url, 48) });

  return (
    <section className="panel min-w-0 space-y-4 rounded-2xl p-4 sm:p-5" data-grovnews-import
      data-stage={outcome ? "report" : preview ? "preview" : "upload"}>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <FileSpreadsheet size={16} aria-hidden className="shrink-0 text-accent" />
            <span className="min-w-0 break-words">{t("grovnewsAdm.sourceImport.title")}</span>
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("grovnewsAdm.sourceImport.sub")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      </header>

      {outcome ? (
        /* ── REPORT ─────────────────────────────────────────────────────────── */
        <div className="min-w-0 space-y-4" data-grovnews-import-report>
          <h3 className="text-[14px] font-semibold">{t("grovnewsAdm.sourceImport.report.title")}</h3>
          <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {REPORT_KEYS.map((k) => (
              <div key={k} className="min-w-0 rounded-xl border border-line bg-raised px-3 py-2.5" data-grovnews-import-report-count={k}>
                <dt className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                  {t(`grovnewsAdm.sourceImport.report.${k}`)}
                </dt>
                <dd className={cn("mt-1 text-lg font-semibold tabular-nums",
                  k === "imported" && outcome.report[k] > 0 && "text-success",
                  k === "failed" && outcome.report[k] > 0 && "text-danger")}>
                  {outcome.report[k]}
                </dd>
              </div>
            ))}
          </dl>
          {outcome.failed.length > 0 && (
            <div className="min-w-0 rounded-xl border border-line px-3.5 py-3" data-grovnews-import-failed>
              <p className="text-[13px] font-semibold text-danger">{t("grovnewsAdm.sourceImport.report.failedList")}</p>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug">
                {outcome.failed.map((f) => (
                  <li key={f.line} className="min-w-0 break-words" data-grovnews-import-failed-line={f.line}>
                    <span className="font-medium">{t("grovnewsAdm.sourceImport.lineLabel", { line: f.line })}</span>
                    {f.name && <span className="text-muted"> · {f.name}</span>}
                    <span className="block text-muted">{t(`grovnewsAdm.sourceImport.reason.${oneOf(REASONS, f.reason, "invalid")}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset} data-grovnews-import-again>
              <Upload size={15} aria-hidden />{t("grovnewsAdm.sourceImport.again")}
            </Button>
            <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      ) : !preview ? (
        /* ── UPLOAD ─────────────────────────────────────────────────────────── */
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <label htmlFor="gns-import-file" className="block text-[13px] font-semibold tracking-tight text-ink">
              {t("grovnewsAdm.sourceImport.file")}
            </label>
            <input key={inputKey} id="gns-import-file" type="file" accept={ACCEPT} disabled={parsing}
              data-grovnews-import-file
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                // Too large is refused here, before a byte is sent.
                const tooLarge = picked !== null && picked.size > IMPORT_LIMITS.maxBytes;
                setFile(tooLarge ? null : picked);
                setFileError(tooLarge ? t("grovnewsAdm.sourceImport.fileErr.tooLarge", LIMIT_VARS) : null);
              }}
              className={cn(
                "block w-full min-w-0 text-[13px] text-muted",
                "file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-raised file:px-3.5",
                "file:text-[13px] file:font-medium file:text-ink hover:file:bg-sunken",
              )} />
            {fileError && (
              <p role="alert" className="break-words text-[12.5px] leading-snug text-danger" data-grovnews-import-error>{fileError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void analyze()} disabled={!file || parsing} data-grovnews-import-analyze>
                <Upload size={15} aria-hidden />
                {parsing ? t("grovnewsAdm.sourceImport.analyzing") : t("grovnewsAdm.sourceImport.analyze")}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={!file && !fileError}>{t("common.cancel")}</Button>
            </div>
            <p className="text-[12px] leading-snug text-faint">{t("grovnewsAdm.sourceImport.nothingSaved")}</p>
          </div>
          <div className="min-w-0 space-y-2 rounded-xl border border-line bg-raised px-3.5 py-3 text-[12.5px] leading-relaxed text-muted"
            data-grovnews-import-help>
            <p className="font-semibold text-ink">{t("grovnewsAdm.sourceImport.help.title")}</p>
            <p>{t("grovnewsAdm.sourceImport.help.header")}</p>
            <ColumnList label={t("grovnewsAdm.sourceImport.help.required")} columns={REQUIRED_COLUMNS} />
            <ColumnList label={t("grovnewsAdm.sourceImport.help.optional")} columns={OPTIONAL_COLUMNS} />
            <p>{t("grovnewsAdm.sourceImport.help.limits", { ...LIMIT_VARS, types: IMPORTABLE_TYPES.join(", ") })}</p>
            <p>{t("grovnewsAdm.sourceImport.help.values")}</p>
          </div>
        </div>
      ) : (
        /* ── TEST + PREVIEW ─────────────────────────────────────────────────── */
        <div className="min-w-0 space-y-4">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted" data-grovnews-import-file-info>
            <FileSpreadsheet size={14} aria-hidden className="shrink-0" />
            <span className="min-w-0 break-all font-medium text-ink">{preview.fileName}</span>
            <span>· {preview.kind.toUpperCase()}</span>
            {preview.sheet && <span className="min-w-0 break-words">· {t("grovnewsAdm.sourceImport.sheet", { sheet: preview.sheet })}</span>}
            <span>· {t("grovnewsAdm.sourceImport.rows", { count: preview.rows.length })}</span>
          </p>

          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5" data-grovnews-import-summary>
            {STATUS_ORDER.map((s) => (
              <div key={s} className="min-w-0 rounded-xl border border-line bg-raised px-3 py-2.5" data-grovnews-import-count={s}>
                <p className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                  <span aria-hidden className={cn("dot bg-current", toneText(STATUS_TONE[s]))} />
                  <span className="truncate">{t(`grovnewsAdm.sourceImport.status.${s}`)}</span>
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{counts[s]}</p>
              </div>
            ))}
            <div className="col-span-2 min-w-0 rounded-xl border border-line bg-raised px-3 py-2.5 sm:col-span-1" data-grovnews-import-tested>
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                {t("grovnewsAdm.sourceImport.testedLabel")}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {t("grovnewsAdm.sourceImport.tested", { done: testedCount, total: testableCount })}
              </p>
            </div>
          </div>

          {progress && (
            <div className="min-w-0 space-y-2 rounded-xl border border-line px-3.5 py-3" data-grovnews-import-progress
              aria-live="polite">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-[13px] font-semibold">
                  {t("grovnewsAdm.sourceImport.testing", { done: progress.done, total: progress.total })}
                </p>
                <Button size="sm" variant="secondary" onClick={stopProbes} disabled={stopping} data-grovnews-import-stop>
                  <Square size={13} aria-hidden />
                  {stopping ? t("grovnewsAdm.sourceImport.stopping") : t("grovnewsAdm.sourceImport.stop")}
                </Button>
              </div>
              <ProgressBar done={progress.done} total={progress.total} />
              <p className="text-[12px] leading-snug text-faint">{t("grovnewsAdm.sourceImport.testingNote")}</p>
            </div>
          )}

          {anyUnsupported && (
            <p className="rounded-xl border border-line bg-raised px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted" data-grovnews-import-unsupported>
              {t("grovnewsAdm.sources.unsupportedNote")}
            </p>
          )}

          <div className="flex flex-wrap gap-2" data-grovnews-import-bulk>
            <Button size="sm" variant="secondary" className={BULK} onClick={applyAll} disabled={recommendations.length === 0} data-grovnews-import-apply-all>
              <Wand2 size={14} aria-hidden />{t("grovnewsAdm.sourceImport.bulk.applyAll", { count: recommendations.length })}
            </Button>
            <Button size="sm" variant="secondary" className={BULK} onClick={() => setSelected(new Set(ready.map((v) => v.row.line)))}
              disabled={ready.length === 0} data-grovnews-import-select-ready>
              <CheckCheck size={14} aria-hidden />{t("grovnewsAdm.sourceImport.bulk.selectReady", { count: ready.length })}
            </Button>
            <Button size="sm" variant="secondary" className={BULK} onClick={() => setSelected(new Set())} disabled={selected.size === 0}
              data-grovnews-import-deselect>
              <Square size={14} aria-hidden />{t("grovnewsAdm.sourceImport.bulk.deselect")}
            </Button>
            <Button size="sm" variant="secondary" className={BULK} disabled={testing || retestable.length === 0} data-grovnews-import-retest
              onClick={() => void runProbes(retestable.map((v) => ({ line: v.row.line, url: v.choice.url })))}>
              <FlaskConical size={14} aria-hidden />{t("grovnewsAdm.sourceImport.bulk.retest", { count: retestable.length })}
            </Button>
          </div>

          <div className="panel relative min-w-0 overflow-hidden rounded-xl">
            <div className="thin-scroll max-h-[70dvh] overflow-auto">
              <table className="w-full min-w-[1400px] text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface/95 text-left text-[11px] uppercase tracking-[0.08em] text-faint backdrop-blur">
                    {(["select", "name", "url", "fileType", "detected", "category", "priority", "official", "status", "problem", "action"] as const).map((c) => (
                      <th key={c} scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold">
                        {t(`grovnewsAdm.sourceImport.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {views.map((v) => {
                    const line = v.row.line;
                    const probe = v.entry?.probe ?? null;
                    const isReady = selectable(v);
                    const rec = probe?.verdict === "OK" ? probe.recommended : null;
                    const recDiffers = rec !== null && (rec.type !== v.choice.type || rec.url !== v.choice.url);
                    const optionIndex = probe ? probe.options.findIndex((o) => o.type === v.choice.type && o.url === v.choice.url) : -1;
                    const pickCategory = v.row.categoryMissing && !v.choice.categoryResolved;
                    const resolved = probe?.resolvedUrl && v.entry && probe.resolvedUrl !== v.entry.url ? probe.resolvedUrl : null;
                    return (
                      <tr key={line} className="border-t border-line align-top" data-grovnews-import-row={line} data-status={v.status}>
                        <td className="px-3 py-2.5">
                          <label className="flex min-h-9 cursor-pointer flex-col items-start gap-1">
                            <input type="checkbox" checked={isReady && selected.has(line)} disabled={!isReady}
                              aria-label={t("grovnewsAdm.sourceImport.selectRow", { line })}
                              onChange={(e) => toggle(line, e.target.checked)}
                              className="mt-1 size-4 accent-[rgb(var(--accent))] disabled:cursor-not-allowed" />
                            <span className="whitespace-nowrap text-[11px] tabular-nums text-faint">
                              {t("grovnewsAdm.sourceImport.lineShort", { line })}
                            </span>
                          </label>
                        </td>
                        <td className="min-w-[12rem] px-3 py-2.5">
                          {v.testable ? (
                            <Input value={v.edit.name} maxLength={120} autoComplete="off" spellCheck={false}
                              aria-label={t("grovnewsAdm.sourceImport.nameFor", { line })}
                              aria-invalid={v.problems.includes("name") || v.problems.includes("formula") || undefined}
                              onChange={(e) => setEdit(v, { name: e.target.value })} className="py-2" />
                          ) : (
                            <span className="block max-w-[14rem] break-words">{v.row.name || "—"}</span>
                          )}
                        </td>
                        <td className="max-w-[16rem] px-3 py-2.5">
                          <span className="block truncate" title={v.row.url}>{v.row.url ? shortUrl(v.row.url) : "—"}</span>
                          {resolved && (
                            <span className="block truncate text-[11.5px] text-faint" title={resolved}>
                              {t("grovnewsAdm.sourceImport.resolved", { url: shortUrl(resolved) })}
                            </span>
                          )}
                          {v.choice.url !== v.row.url && (
                            <span className="block truncate text-[11.5px] text-accent" title={v.choice.url}>
                              {t("grovnewsAdm.sourceImport.chosen", { url: shortUrl(v.choice.url) })}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {v.row.type ? t(`grovnewsAdm.sourceType.${v.row.type}`) : <span className="text-danger">{v.row.fileType}</span>}
                        </td>
                        <td className="min-w-[9rem] px-3 py-2.5">
                          <span className="block whitespace-nowrap">
                            {probe?.detectedType ? t(`grovnewsAdm.sourceType.${probe.detectedType}`) : <span className="text-faint">—</span>}
                          </span>
                          {rec && recDiffers && (
                            <Badge tone="info" className="mt-1">
                              {t("grovnewsAdm.sourceImport.recommendedBadge", { type: t(`grovnewsAdm.sourceType.${rec.type}`) })}
                            </Badge>
                          )}
                        </td>
                        <td className="min-w-[12rem] px-3 py-2.5">
                          {v.testable ? (
                            <>
                              <Select value={pickCategory ? "__pick" : (v.choice.categoryId ?? "")} className="py-2"
                                aria-label={t("grovnewsAdm.sourceImport.categoryFor", { line })}
                                aria-invalid={pickCategory || undefined}
                                onChange={(e) => setChoice(line, {
                                  categoryId: e.target.value === "" || e.target.value === "__pick" ? null : e.target.value,
                                  categoryResolved: e.target.value !== "__pick",
                                })}>
                                {pickCategory && <option value="__pick" disabled>{t("grovnewsAdm.sourceImport.categoryPick")}</option>}
                                <option value="">{t("grovnewsAdm.noCategory")}</option>
                                {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </Select>
                              {pickCategory && (
                                <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                                  <span className="min-w-0 break-words">{t("grovnewsAdm.sourceImport.categoryFromFile", { label: v.row.categoryLabel })}</span>
                                  <Badge tone="warning">{t("grovnewsAdm.sourceImport.categoryNotFound")}</Badge>
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="block max-w-[12rem] break-words text-muted">{v.row.categoryLabel || t("grovnewsAdm.noCategory")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {v.testable ? (
                            <Input type="number" inputMode="numeric" min={0} max={100} step={1} value={v.edit.priority}
                              aria-label={t("grovnewsAdm.sourceImport.priorityFor", { line })}
                              aria-invalid={v.problems.includes("priority") || undefined}
                              onChange={(e) => setEdit(v, { priority: e.target.value })} className="w-20 py-2" />
                          ) : (
                            <span className="tabular-nums text-muted">{v.row.priority}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <label className="flex min-h-9 cursor-pointer items-center" title={t("grovnewsAdm.sourceImport.officialHint")}>
                            <input type="checkbox" checked={v.edit.official} disabled={!v.testable && !updatable(v)}
                              aria-label={t("grovnewsAdm.sourceImport.officialFor", { line })}
                              onChange={(e) => setEdit(v, { official: e.target.checked, officialSet: true })} data-grovnews-import-official={line}
                              className="size-4 accent-[rgb(var(--accent))] disabled:cursor-not-allowed" />
                          </label>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={STATUS_TONE[v.status]} dot>{t(`grovnewsAdm.sourceImport.status.${v.status}`)}</Badge>
                        </td>
                        <td className="min-w-[14rem] max-w-[18rem] px-3 py-2.5">
                          {v.problems.length === 0 ? <span className="text-faint">—</span> : (
                            <ul className="space-y-1 text-[12px] leading-snug">
                              {v.problems.map((p) => (
                                <li key={p} className={cn("break-words", v.status === "ERROR" ? "text-danger" : "text-muted")}
                                  data-grovnews-import-problem={p}>
                                  {problemText(v, p)}
                                </li>
                              ))}
                              {updatable(v) && (
                                <li className="break-words text-accent" data-grovnews-import-will-update>
                                  {t("grovnewsAdm.sourceImport.willUpdate")}
                                </li>
                              )}
                              {probe?.code && probe.code !== "empty" && probe.verdict !== "OK" && (
                                <li className="break-words text-faint">{describeError(probe.code)}</li>
                              )}
                            </ul>
                          )}
                        </td>
                        <td className="min-w-[15rem] px-3 py-2.5">
                          {v.testable && probe && probe.options.length > 0 ? (
                            <div className="min-w-0 space-y-1.5">
                              <Select value={optionIndex >= 0 ? String(optionIndex) : "__file"} className="py-2"
                                aria-label={t("grovnewsAdm.sourceImport.optionFor", { line })}
                                onChange={(e) => {
                                  const o = probe.options[Number(e.target.value)];
                                  if (o) setChoice(line, { type: o.type, url: o.url });
                                }}>
                                {optionIndex < 0 && (
                                  <option value="__file" disabled>
                                    {t("grovnewsAdm.sourceImport.optionUnverified", {
                                      option: optionLabel(v.choice.type ?? v.row.fileType, v.choice.url),
                                    })}
                                  </option>
                                )}
                                {probe.options.map((o, i) => (
                                  <option key={`${o.type}-${o.url}`} value={String(i)}>{optionLabel(o.type, o.url)}</option>
                                ))}
                              </Select>
                              {recDiffers && (
                                <Button size="sm" variant="secondary" className="w-full whitespace-nowrap" onClick={() => applyRecommendation(v)}
                                  data-grovnews-import-apply={line}>
                                  <Wand2 size={13} aria-hidden />{t("grovnewsAdm.sourceImport.applyRec")}
                                </Button>
                              )}
                            </div>
                          ) : <span className="text-faint">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3" data-grovnews-import-update>
            <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--accent))]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{t("grovnewsAdm.sourceImport.update.label")}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t("grovnewsAdm.sourceImport.update.hint")}</span>
            </span>
          </label>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <Button variant="ghost" onClick={reset} data-grovnews-import-cancel>{t("common.cancel")}</Button>
            <Button onClick={() => setConfirming(true)} disabled={chosen.length === 0 || importing || testing} data-grovnews-import-submit>
              <Upload size={15} aria-hidden />{t("grovnewsAdm.sourceImport.submit", { count: chosen.length })}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal open={confirming} onClose={() => { if (!importing) setConfirming(false); }} onConfirm={() => void runImport()}
        pending={importing}
        title={t("grovnewsAdm.sourceImport.confirm.title")}
        body={t(updateExisting ? "grovnewsAdm.sourceImport.confirm.bodyUpdate" : "grovnewsAdm.sourceImport.confirm.bodySkip", { count: chosen.length })}
        confirmLabel={importing ? t("grovnewsAdm.sourceImport.importing") : t("grovnewsAdm.sourceImport.confirm.ok")} />
    </section>
  );
}

function toneText(tone: "success" | "warning" | "danger" | "neutral"): string {
  return tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-faint";
}

function ColumnList({ label, columns }: { label: string; columns: readonly string[] }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span>{label}:</span>
      {columns.map((c) => (
        <code key={c} className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{c}</code>
      ))}
    </p>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}
