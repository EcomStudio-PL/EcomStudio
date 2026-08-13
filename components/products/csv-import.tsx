"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  IMPORT_FIELDS, SAMPLE_CSV, autoMap, issuesToCsv, mapRows, parseCsv, validateRows,
  type ImportField, type ImportRow, type RowIssue,
} from "@/lib/services/csv";
import { importProductsAction } from "@/app/actions/products";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = 20;
/** Rows sent per server call — the action writes them in its own batches. */
const CHUNK = 250;

/**
 * CSV IMPORT — file → column mapping → preview → import.
 *
 * Built for real catalogues: the file is parsed in the browser, only the
 * first twenty rows are ever rendered, and the import runs in chunks with a
 * live count so a 2000-product upload shows progress instead of a frozen
 * dialog. Column mapping is a stacked list of rows on a phone (CSV header
 * above, target field below) rather than a desktop table squeezed to 390px.
 */
export function CsvImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, ImportField | "">>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; failed: number } | null>(null);

  const mapped: ImportRow[] = headers.length ? mapRows(rawRows, mapping) : [];
  const issues: RowIssue[] = mapped.length ? validateRows(mapped) : [];
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.filter((i) => i.level === "warning").length;
  const hasName = Object.values(mapping).includes("name");

  function reset() {
    setFileName(""); setHeaders([]); setRawRows([]); setMapping({});
    setResult(null); setProgress(null); setBusy(false);
  }

  async function readFile(file: File) {
    const text = await file.text();
    const { headers: h, rows } = parseCsv(text);
    if (h.length === 0 || rows.length === 0) { toast.error(t("import.emptyFile")); return; }
    setFileName(file.name);
    setHeaders(h);
    setRawRows(rows);
    setMapping(autoMap(h));
    setResult(null);
  }

  async function run() {
    if (!hasName || busy) return;
    setBusy(true);
    const valid = mapped.filter((r) => r.name?.trim());
    let imported = 0, skipped = mapped.length - valid.length, failed = 0;
    setProgress({ done: 0, total: valid.length });
    for (let i = 0; i < valid.length; i += CHUNK) {
      const res = await importProductsAction(valid.slice(i, i + CHUNK));
      if (res.ok) { imported += res.imported; skipped += res.skipped; failed += res.failed; }
      else { failed += Math.min(CHUNK, valid.length - i); }
      setProgress({ done: Math.min(i + CHUNK, valid.length), total: valid.length });
    }
    setBusy(false);
    setProgress(null);
    setResult({ imported, skipped, failed });
    if (imported > 0) router.refresh();
  }

  function download(content: string, name: string) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={t("import.title")} wide>
      {/* STEP 1 — file */}
      {headers.length === 0 && !result && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">{t("import.intro")}</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 px-4 py-10 text-faint transition-colors hover:border-[rgb(var(--accent)/0.6)] hover:bg-accent-soft/30 hover:text-accent"
          >
            <FileSpreadsheet size={26} aria-hidden />
            <span className="text-sm font-semibold">{t("import.pick")}</span>
            <span className="text-xs">{t("import.pickHint")}</span>
          </button>
          <Button variant="ghost" size="sm" onClick={() => download(SAMPLE_CSV, "ecomstudio-products.csv")}>
            <Download size={14} aria-hidden /> {t("import.sample")}
          </Button>
        </div>
      )}

      {/* STEP 2 — mapping + preview */}
      {headers.length > 0 && !result && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">{fileName}</p>
            <span className="shrink-0 text-xs text-muted">{t("import.rows", { n: rawRows.length })}</span>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="overline">{t("import.mapping")}</p>
              <Button variant="ghost" size="sm" onClick={() => setMapping(autoMap(headers))}>
                {t("import.auto")}
              </Button>
            </div>
            {/* One card per column: readable at 320px, still compact on desktop. */}
            <ul className="thin-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
              {headers.map((h, i) => (
                <li key={`${h}-${i}`} className="plate grid grid-cols-1 items-center gap-2 rounded-xl p-2.5 sm:grid-cols-[1fr_auto_1fr]">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{h || `#${i + 1}`}</p>
                    <p className="truncate text-[11px] text-faint">{rawRows[0]?.[i] || "—"}</p>
                  </div>
                  <span aria-hidden className="hidden text-faint sm:block">→</span>
                  <Select
                    value={mapping[i] ?? ""}
                    aria-label={t("import.mapTo", { column: h })}
                    onChange={(e) => setMapping({ ...mapping, [i]: e.target.value as ImportField | "" })}
                  >
                    <option value="">{t("import.ignore")}</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f} value={f}>{t(`import.field.${f}`)}</option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </div>

          {!hasName && (
            <p className="flex items-start gap-2 rounded-xl bg-[rgb(var(--danger)/0.12)] px-3 py-2.5 text-xs text-danger">
              <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
              {t("import.needName")}
            </p>
          )}

          {hasName && (
            <div>
              <p className="overline mb-2">{t("import.preview")}</p>
              <div className="table-scroll thin-scroll rounded-xl border border-[rgb(var(--hairline)/var(--hairline-alpha))]">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-faint">
                      <th className="px-3 py-2 font-semibold">{t("import.field.name")}</th>
                      <th className="px-3 py-2 font-semibold">{t("import.field.category")}</th>
                      <th className="px-3 py-2 font-semibold">SKU</th>
                      <th className="px-3 py-2 font-semibold">{t("common.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapped.slice(0, PREVIEW_ROWS).map((r, i) => {
                      const issue = issues.find((x) => x.line === i + 2);
                      return (
                        <tr key={i} className="border-t border-line">
                          <td className="max-w-[12rem] truncate px-3 py-2">{r.name || "—"}</td>
                          <td className="max-w-[8rem] truncate px-3 py-2 text-muted">{r.category || "—"}</td>
                          <td className="px-3 py-2 text-muted">{r.sku || "—"}</td>
                          <td className="px-3 py-2">
                            {issue
                              ? <Badge tone={issue.level === "error" ? "red" : "amber"}>{t(`import.issue.${issue.reason}`)}</Badge>
                              : <Badge tone="green" dot>{t("import.ok")}</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rawRows.length > PREVIEW_ROWS && (
                <p className="mt-2 text-[11px] text-faint">{t("import.more", { n: rawRows.length - PREVIEW_ROWS })}</p>
              )}
              {(errorCount > 0 || warnCount > 0) && (
                <p className="mt-2 text-[11px] text-muted">
                  {errorCount > 0 && <span className="text-danger">{t("import.errors", { n: errorCount })} </span>}
                  {warnCount > 0 && <span className="text-accent2">{t("import.warnings", { n: warnCount })}</span>}
                </p>
              )}
            </div>
          )}

          {progress && (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                <div className="brand-gradient h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-center text-xs tabular-nums text-muted">
                {t("import.progress", { done: progress.done, total: progress.total })}
              </p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={reset} disabled={busy}>{t("common.cancel")}</Button>
            <Button onClick={run} disabled={!hasName || busy}>
              <Upload size={15} aria-hidden />
              {busy ? t("import.running") : t("import.start", { n: mapped.length - errorCount })}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3 — summary */}
      {result && (
        <div className="space-y-4 text-center">
          <span aria-hidden className={cn(
            "mx-auto flex h-14 w-14 items-center justify-center rounded-2xl",
            result.failed > 0 ? "bg-accent2-soft text-accent2" : "bg-[rgb(var(--success)/0.14)] text-success"
          )}>
            {result.failed > 0 ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
          </span>
          <div>
            <p className="font-display text-lg font-semibold">{t("import.doneTitle")}</p>
            <p className="mt-1 text-sm text-muted">
              {t("import.summary", { imported: result.imported, skipped: result.skipped, failed: result.failed })}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            {issues.length > 0 && (
              <Button variant="secondary" onClick={() => download(issuesToCsv(mapped, issues), "ecomstudio-import-issues.csv")}>
                <Download size={14} aria-hidden /> {t("import.downloadIssues")}
              </Button>
            )}
            <Button onClick={() => { reset(); onClose(); }}>{t("common.close")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
