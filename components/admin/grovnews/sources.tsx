"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Download, FileSpreadsheet, Filter, FlaskConical, KeyRound, Pencil, Plus, Rss, ShieldCheck, Square, Wand2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { AdminTable } from "@/components/ui/admin-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ingestNowAction, saveSourceAction, saveSourceSecretAction, setSourceEnabledAction, testSourceAction,
} from "@/app/actions/grovnews-research";
import { checkSourcesAction } from "@/app/actions/grovnews-sources";
import {
  FETCHED_TYPES, HEALTH_STATUSES, SOURCE_ERROR_KINDS, SOURCE_TYPES, isAcceptableSourceUrl, isValidAuthHeader, sourceMethod, sourceState,
  type SourceAuthKind, type SourceHealth, type SourceState, type SourceType,
} from "@/lib/grovnews-research";
import type { ProbeSummary } from "@/lib/grovnews-import";
import type { AdminSource, SourceHealthSummary } from "@/lib/services/grovnews-research";
import type { CategoryRow } from "@/lib/services/grovnews";
import { ProgressBar, SourceImport } from "./source-import";
import { SourceAuthFields, type SourceSecretState } from "./source-auth";

export type { SourceSecretState } from "./source-auth";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Language = AdminSource["language"];
const LANGUAGES: readonly Language[] = ["pl", "en", "de"];

/** The fetcher's machine codes (lib/server/grovnews/fetch.ts + pipeline) that
 *  have their own sentence; `http_status_<n>` is a pattern, anything else is
 *  shown as the generic "error". */
const ERROR_CODES = [
  "timeout", "dns", "private_address", "forbidden_host", "invalid_url", "too_large", "too_many_redirects",
  "network", "robots", "unrecognized_format", "adapter_unavailable", "no_url", "manual", "error",
  // 0125: what a test or a health check can record besides a fetch failure.
  "empty", "robots_unreachable", "requires_access", "bot_protection",
  // 0128: an API source's own refusals.
  "auth_failed", "secret_missing",
] as const;

function errorLabel(t: T, code: string): string {
  const http = /^http_status_(\d{3})$/.exec(code);
  if (http) return t("grovnewsAdm.sources.errors.httpStatus", { status: http[1] });
  const known = (ERROR_CODES as readonly string[]).includes(code) ? code : "error";
  return t(`grovnewsAdm.sources.errors.${known}`);
}

/** Every refusal an action on this screen can return, as a sentence. */
const ERROR_KEYS: Record<string, string> = {
  name: "grovnewsAdm.sources.err.name",
  type: "grovnewsAdm.sources.err.type",
  url: "grovnewsAdm.sources.err.url",
  category: "grovnewsAdm.sources.err.category",
  priority: "grovnewsAdm.sources.err.priority",
  language: "grovnewsAdm.sources.err.language",
  urlTaken: "grovnewsAdm.sources.err.urlTaken",
  authHeader: "grovnewsAdm.sources.auth.errHeader",
  secret: "grovnewsAdm.sources.auth.errSecret",
  notApi: "grovnewsAdm.sources.auth.errNotApi",
  noServerKey: "grovnewsAdm.sources.err.noServerKey",
  invalid: "grovnewsAdm.sources.err.invalid",
  forbidden: "grovnewsAdm.errForbidden",
  generic: "common.error",
};
const errorMessage = (t: T, code: string | undefined) => t(ERROR_KEYS[code ?? "generic"] ?? "common.error");

/** Read by the job (and testable here): the feed types, pages and — since
 *  0128 — API sources. */
const isFetched = (type: SourceType) => FETCHED_TYPES.includes(type) || type === "API";

/** 0128: the compact state a row shows. */
const STATE_TONE: Record<SourceState, Tone> = { ok: "success", problem: "danger", untested: "neutral", off: "neutral" };

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Numeric, in Warsaw time: "26.09.2026 07:05". Month NAMES differ between
 *  the server's and the browser's ICU builds (a hydration error); numbers do
 *  not. */
function useFormatDateTime() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : locale === "de" ? "de-DE" : "en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw",
  });
  return (iso: string | null) => (iso ? fmt.format(new Date(iso)) : null);
}

type Tone = "success" | "warning" | "danger" | "neutral";

/** 0125 §2: how each health state reads at a glance. */
const HEALTH_TONE: Record<SourceHealth, Tone> = {
  HEALTHY: "success", DEGRADED: "warning", FAILED: "danger", UNSUPPORTED: "danger", DISABLED: "neutral", UNCHECKED: "neutral",
};
const TONE_TEXT: Record<Tone, string> = {
  success: "text-success", warning: "text-warning", danger: "text-danger", neutral: "text-faint",
};

const asHealth = (v: string | null | undefined): SourceHealth | null =>
  (HEALTH_STATUSES as readonly string[]).includes(v ?? "") ? (v as SourceHealth) : null;
const asType = (v: string | null | undefined): SourceType | null =>
  (SOURCE_TYPES as readonly string[]).includes(v ?? "") ? (v as SourceType) : null;

function HealthBadge({ health }: { health: SourceHealth }) {
  const { t } = useI18n();
  return <Badge tone={HEALTH_TONE[health]} dot>{t(`grovnewsAdm.sourceHealth.${health}`)}</Badge>;
}

type TestResult =
  | { state: "running" }
  | { state: "ok"; entries: number; sample: string[]; health: SourceHealth | null; probe: ProbeSummary }
  | { state: "failed"; message: string; health: SourceHealth | null; probe: ProbeSummary | null };

/** The list's filters — client-side, over the sources already on the page. */
type Filters = { type: string; category: string; health: string; official: "all" | "yes" | "no"; language: string };
const NO_FILTERS: Filters = { type: "all", category: "all", health: "all", official: "all", language: "all" };
const NO_CATEGORY = "__none";

const matches = (s: AdminSource, f: Filters) =>
  (f.type === "all" || s.type === f.type)
  && (f.category === "all" || (f.category === NO_CATEGORY ? s.categoryId === null : s.categoryId === f.category))
  && (f.health === "all" || s.health === f.health)
  && (f.official === "all" || s.official === (f.official === "yes"))
  && (f.language === "all" || s.language === f.language);

/** "Sprawdź wszystkie źródła" while it runs: the running totals of every call. */
type CheckRun = { checked: number; remaining: number | null; statuses: Record<string, number>; stopping: boolean };

/** The list of sources the daily research reads: add, edit, switch on/off,
 *  test one (which records its health), check them all, fetch one or all
 *  now, and bulk-import a file. */
export function SourcesManager({ sources, categories, summary, secrets = {} }: {
  sources: AdminSource[]; categories: CategoryRow[];
  /** 0128: real counts, from the service the Pulpit uses too. */
  summary?: SourceHealthSummary;
  /** 0128: per API source that authenticates — stored or not, last four. */
  secrets?: Record<string, SourceSecretState>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormatDateTime();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminSource | "new" | null>(null);
  // A recommendation from a test opens the form PREFILLED; the admin saves it.
  const [preset, setPreset] = useState<{ type: SourceType; url: string } | null>(null);
  const [testing, setTesting] = useState<{ source: AdminSource; result: TestResult } | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [check, setCheck] = useState<CheckRun | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Closing the test modal while the read is still running must not reopen it
  // when the answer arrives: each run carries a number, a close bumps it.
  const testRun = useRef(0);
  const closeTest = () => { testRun.current += 1; setTesting(null); };
  // Leaving the page stops the check loop after its current call.
  const stopCheck = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stopCheck.current = true; };
  }, []);

  const locked = pending || check !== null;
  const checkable = sources.filter((s) => s.enabled && isFetched(s.type) && s.url).length;
  const healthCounts = useMemo(() => {
    const out = Object.fromEntries(HEALTH_STATUSES.map((h) => [h, 0])) as Record<SourceHealth, number>;
    for (const s of sources) out[s.health] += 1;
    return out;
  }, [sources]);
  const officialCount = sources.filter((s) => s.official).length;
  const visible = useMemo(() => sources.filter((s) => matches(s, filters)), [sources, filters]);
  const filtered = (Object.keys(NO_FILTERS) as (keyof Filters)[]).some((k) => filters[k] !== NO_FILTERS[k]);
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const ingest = (id: string | null) => {
    setBusy(id ?? "all");
    start(async () => {
      const res = await ingestNowAction(id);
      setBusy(null);
      if (!res.ok) { toast.error(errorMessage(t, res.error)); return; }
      if (res.sources === 0) toast.info(t("grovnewsAdm.sources.nothingToIngest"));
      else {
        const msg = t("grovnewsAdm.sources.ingested", {
          sources: res.sources, failed: res.failed, inserted: res.inserted, duplicates: res.duplicates,
        });
        if (res.failed > 0) toast.warning(msg); else toast.success(msg);
      }
      router.refresh();
    });
  };

  const setEnabled = (s: AdminSource, enabled: boolean) => start(async () => {
    const res = await setSourceEnabledAction(s.id, enabled);
    if (!res.ok) { toast.error(errorMessage(t, res.error)); return; }
    toast.success(t(enabled ? "grovnewsAdm.sources.enabledOn" : "grovnewsAdm.sources.enabledOff"));
    router.refresh();
  });

  const test = (s: AdminSource) => {
    const run = ++testRun.current;
    setTesting({ source: s, result: { state: "running" } });
    start(async () => {
      const res = await testSourceAction(s.id);
      // The test recorded the source's health: the table shows it even if
      // the modal was closed meanwhile.
      if (res.ok || res.health) router.refresh();
      if (run !== testRun.current) return;
      if (res.ok) {
        setTesting({
          source: s, result: { state: "ok", entries: res.entries, sample: res.sample, health: asHealth(res.health), probe: res.probe },
        });
        return;
      }
      const message = (res.error === "fetch" || res.error === "notFetchable")
        ? errorLabel(t, res.code ?? "error") : errorMessage(t, res.error);
      setTesting({ source: s, result: { state: "failed", message, health: asHealth(res.health), probe: res.probe ?? null } });
      toast.error(message);
    });
  };

  /** Never saves: opens the ordinary form with the test's type and address. */
  const openRecommendation = (s: AdminSource, rec: { type: SourceType; url: string }) => {
    closeTest();
    setPreset(rec);
    setEditing(s);
  };

  /* ── "Sprawdź wszystkie źródła": call until nothing checked before `since` remains ── */
  const checkAll = async () => {
    const since = new Date().toISOString();
    stopCheck.current = false;
    let checked = 0;
    let remaining: number | null = null;
    const statuses: Record<string, number> = {};
    let error: string | null = null;
    let stalled = false;
    setCheck({ checked, remaining, statuses: {}, stopping: false });
    for (;;) {
      const res = await checkSourcesAction(since).catch(() => null);
      if (!alive.current) return;
      if (!res || !res.ok) { error = res?.error ?? "generic"; break; }
      checked += res.checked;
      for (const [k, n] of Object.entries(res.statuses)) statuses[k] = (statuses[k] ?? 0) + n;
      remaining = res.remaining;
      const snapshot = { checked, remaining, statuses: { ...statuses } };
      setCheck((prev) => ({ ...snapshot, stopping: prev?.stopping ?? false }));
      if (remaining === 0 || stopCheck.current) break;
      // A call that checked nothing while some remain would loop forever.
      if (res.checked === 0) { stalled = true; break; }
    }
    const stopped = stopCheck.current && remaining !== 0;
    setCheck(null);
    if (error) toast.error(errorMessage(t, error));
    else if (stalled) toast.warning(t("grovnewsAdm.sources.check.stalled", { checked }));
    else {
      const issues = (statuses.DEGRADED ?? 0) + (statuses.FAILED ?? 0) + (statuses.UNSUPPORTED ?? 0);
      const msg = t(stopped ? "grovnewsAdm.sources.check.cancelled" : "grovnewsAdm.sources.check.done", {
        checked, healthy: statuses.HEALTHY ?? 0, issues,
      });
      if (stopped || issues > 0) toast.warning(msg); else toast.success(msg);
    }
    router.refresh();
  };
  const cancelCheck = () => {
    stopCheck.current = true;
    setCheck((prev) => (prev ? { ...prev, stopping: true } : prev));
  };

  const addButton = (label: string) => (
    <Button onClick={() => { setPreset(null); setEditing("new"); }} className="shrink-0 whitespace-nowrap" data-grovnews-sources-add>
      <Plus size={15} aria-hidden />{label}
    </Button>
  );

  const detailLabel = (key: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{t(key)}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-[13px]">{value}</dd>
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {addButton(t("grovnewsAdm.sources.add"))}
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" disabled={locked || sources.length === 0}
          onClick={() => ingest(null)} data-grovnews-sources-ingest-all>
          <Download size={15} aria-hidden />
          {busy === "all" ? t("grovnewsAdm.sources.ingesting") : t("grovnewsAdm.sources.ingestAll")}
        </Button>
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" disabled={locked || checkable === 0}
          onClick={() => void checkAll()} data-grovnews-check-all>
          <Activity size={15} aria-hidden />
          {check ? t("grovnewsAdm.sources.check.running") : t("grovnewsAdm.sources.check.all")}
        </Button>
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" aria-expanded={importOpen}
          onClick={() => setImportOpen((o) => !o)} data-grovnews-import-open>
          <FileSpreadsheet size={15} aria-hidden />{t("grovnewsAdm.sources.importOpen")}
        </Button>
      </div>

      {check && (
        <div className="panel min-w-0 space-y-2.5 rounded-2xl p-4" data-grovnews-check-progress aria-live="polite">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
              <Activity size={16} aria-hidden className="shrink-0 text-accent" />
              <span className="min-w-0 tabular-nums">
                {check.remaining === null
                  ? t("grovnewsAdm.sources.check.starting")
                  : t("grovnewsAdm.sources.check.progress", { checked: check.checked, remaining: check.remaining })}
              </span>
            </p>
            <Button size="sm" variant="secondary" disabled={check.stopping} onClick={cancelCheck} data-grovnews-check-cancel>
              <Square size={13} aria-hidden />
              {check.stopping ? t("grovnewsAdm.sources.check.stopping") : t("common.cancel")}
            </Button>
          </div>
          {check.remaining !== null && <ProgressBar done={check.checked} total={check.checked + check.remaining} />}
          {Object.keys(check.statuses).length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-grovnews-check-statuses>
              {HEALTH_STATUSES.filter((h) => (check.statuses[h] ?? 0) > 0).map((h) => (
                <Badge key={h} tone={HEALTH_TONE[h]}>
                  {t(`grovnewsAdm.sourceHealth.${h}`)}<span className="tabular-nums">{check.statuses[h]}</span>
                </Badge>
              ))}
            </div>
          )}
          <p className="text-[12px] leading-snug text-faint">{t("grovnewsAdm.sources.check.note")}</p>
        </div>
      )}

      {importOpen && (
        <SourceImport categories={categories} describeError={(code) => errorLabel(t, code)} onClose={() => setImportOpen(false)} />
      )}

      <p className="flex min-w-0 items-start gap-2 text-[12.5px] leading-relaxed text-muted" data-grovnews-sources-guidance>
        <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-success" />
        <span className="min-w-0">{t("grovnewsAdm.sources.guidance")}</span>
      </p>

      {sources.length === 0 ? (
        <div data-grovnews-sources-empty>
          <EmptyState icon={Rss} title={t("grovnewsAdm.sources.emptyTitle")} body={t("grovnewsAdm.sources.emptyBody")}
            action={addButton(t("grovnewsAdm.sources.addFirst"))} />
        </div>
      ) : (
        <>
          {summary && (
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums" data-grovnews-health-line
              data-ok={summary.ok} data-problem={summary.problem} data-untested={summary.untested}>
              <span className="font-semibold">{t("grovnewsAdm.sources.line.sources", { n: summary.enabled })}</span>
              <span aria-hidden className="text-faint">·</span>
              <span className="text-success">{t("grovnewsAdm.sources.line.ok", { n: summary.ok })}</span>
              {SOURCE_ERROR_KINDS.filter((k) => summary.byKind[k] > 0).map((k) => (
                <span key={k} className="contents">
                  <span aria-hidden className="text-faint">·</span>
                  <span className="text-danger" data-grovnews-health-kind={k}>{t(`grovnewsAdm.sources.kind.${k}`, { n: summary.byKind[k] })}</span>
                </span>
              ))}
              {summary.untested > 0 && (
                <>
                  <span aria-hidden className="text-faint">·</span>
                  <span className="text-muted">{t("grovnewsAdm.sources.line.untested", { n: summary.untested })}</span>
                </>
              )}
            </p>
          )}

          {/* ── health summary: a chip per state, a click filters by it ───────── */}
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" data-grovnews-health-summary>
            <SummaryChip data="total" label={t("grovnewsAdm.sources.summary.total")} value={sources.length}
              active={filters.health === "all"} onClick={() => setFilter("health", "all")} />
            {HEALTH_STATUSES.map((h) => (
              <SummaryChip key={h} data={h} tone={HEALTH_TONE[h]} label={t(`grovnewsAdm.sourceHealth.${h}`)} value={healthCounts[h]}
                active={filters.health === h} onClick={() => setFilter("health", filters.health === h ? "all" : h)} />
            ))}
            <SummaryChip data="official" tone="success" label={t("grovnewsAdm.sources.summary.official")} value={officialCount}
              active={filters.official === "yes"} onClick={() => setFilter("official", filters.official === "yes" ? "all" : "yes")} />
          </div>
          {healthCounts.UNSUPPORTED > 0 && (
            <p className="text-[12px] leading-relaxed text-muted" data-grovnews-unsupported-note>{t("grovnewsAdm.sources.unsupportedNote")}</p>
          )}

          {/* ── filters ─────────────────────────────────────────────────────── */}
          <div className="panel min-w-0 space-y-3 rounded-2xl p-3.5 sm:p-4" data-grovnews-source-filters>
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="min-w-0">
                <Label htmlFor="gns-f-type">{t("common.type")}</Label>
                <Select id="gns-f-type" value={filters.type} onChange={(e) => setFilter("type", e.target.value)} className="py-2.5">
                  <option value="all">{t("common.all")}</option>
                  {SOURCE_TYPES.map((s) => <option key={s} value={s}>{t(`grovnewsAdm.sourceType.${s}`)}</option>)}
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="gns-f-cat">{t("grovnewsAdm.colCategory")}</Label>
                <Select id="gns-f-cat" value={filters.category} onChange={(e) => setFilter("category", e.target.value)} className="py-2.5">
                  <option value="all">{t("common.all")}</option>
                  <option value={NO_CATEGORY}>{t("grovnewsAdm.noCategory")}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="gns-f-health">{t("grovnewsAdm.sources.colHealth")}</Label>
                <Select id="gns-f-health" value={filters.health} onChange={(e) => setFilter("health", e.target.value)} className="py-2.5">
                  <option value="all">{t("common.all")}</option>
                  {HEALTH_STATUSES.map((h) => <option key={h} value={h}>{t(`grovnewsAdm.sourceHealth.${h}`)}</option>)}
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="gns-f-official">{t("grovnewsAdm.sources.official")}</Label>
                <Select id="gns-f-official" value={filters.official} className="py-2.5"
                  onChange={(e) => setFilter("official", e.target.value === "yes" ? "yes" : e.target.value === "no" ? "no" : "all")}>
                  <option value="all">{t("common.all")}</option>
                  <option value="yes">{t("grovnewsAdm.sources.filters.yes")}</option>
                  <option value="no">{t("grovnewsAdm.sources.filters.no")}</option>
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="gns-f-lang">{t("grovnewsAdm.fLanguage")}</Label>
                <Select id="gns-f-lang" value={filters.language} onChange={(e) => setFilter("language", e.target.value)} className="py-2.5">
                  <option value="all">{t("common.all")}</option>
                  {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] tabular-nums text-muted" data-grovnews-source-count={visible.length}>
                {t("grovnewsAdm.sources.filters.count", { shown: visible.length, total: sources.length })}
              </p>
              <Button size="sm" variant="ghost" disabled={!filtered} onClick={() => setFilters(NO_FILTERS)} data-grovnews-source-filters-reset>
                {t("common.clearFilters")}
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div data-grovnews-sources-filtered-empty>
              <EmptyState icon={Filter} title={t("grovnewsAdm.sources.filters.emptyTitle")} body={t("grovnewsAdm.sources.filters.emptyBody")}
                action={<Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>{t("common.clearFilters")}</Button>} />
            </div>
          ) : (
            <AdminTable
              empty={t("grovnewsAdm.sources.emptyTitle")}
              // Type + category and the two timestamps share cells, so the row's
              // actions stay on screen in a desktop table instead of scrolling away.
              headers={[t("common.name"), `${t("grovnewsAdm.sources.colMethod")} · ${t("grovnewsAdm.colCategory")}`, t("grovnewsAdm.sources.colPriority"),
                t("grovnewsAdm.sources.colEnabled"), `${t("grovnewsAdm.sources.colChecked")} · ${t("grovnewsAdm.sources.colSuccess")}`,
                `${t("grovnewsAdm.sources.colHealth")} · ${t("grovnewsAdm.sources.colError")}`, t("common.actions")]}
              rows={visible.map((s) => {
                const host = hostOf(s.url);
                const fetched = isFetched(s.type);
                const detected = asType(s.detectedType);
                const meta = [
                  s.failures > 0 ? t("grovnewsAdm.sources.health.failures", { count: s.failures }) : null,
                  s.lastHttpStatus !== null ? t("grovnewsAdm.sources.errors.httpStatus", { status: s.lastHttpStatus }) : null,
                  detected && detected !== s.type
                    ? t("grovnewsAdm.sources.health.detected", { type: t(`grovnewsAdm.sourceType.${detected}`) }) : null,
                  s.lastNewItems !== null ? t("grovnewsAdm.sources.health.newItems", { count: s.lastNewItems }) : null,
                ].filter((m): m is string => m !== null);
                return [
                  <span key="n" className="block min-w-0 max-w-[15rem]" data-grovnews-source={s.id}>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="min-w-0 break-words">{s.name}</span>
                      {s.official && <Badge tone="success">{t("grovnewsAdm.sources.official")}</Badge>}
                    </span>
                    {host && (
                      <span className="block truncate text-[11.5px] font-normal text-muted" title={s.url ?? undefined}>{host}</span>
                    )}
                  </span>,
                  <span key="ty" className="block min-w-0" data-grovnews-source-method={sourceMethod(s.type)}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral">{t(`grovnewsAdm.sources.method.${sourceMethod(s.type)}`)}</Badge>
                      <span className="whitespace-nowrap text-[12px] font-normal text-muted">{t(`grovnewsAdm.sourceType.${s.type}`)}</span>
                      {s.type === "API" && s.authKind !== "none" && (
                        <Badge className="max-w-full !whitespace-normal" tone={secrets[s.id]?.configured ? "success" : "warning"}>
                          <KeyRound size={11} aria-hidden />
                          {t(secrets[s.id]?.configured ? `grovnewsAdm.sources.auth.${s.authKind}` : "grovnewsAdm.sources.errors.secret_missing")}
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-[11.5px] font-normal text-muted">{s.categoryName ?? t("grovnewsAdm.noCategory")}</span>
                  </span>,
                  <span key="p" className="tabular-nums">{s.priority}</span>,
                  <Switch key="e" checked={s.enabled} disabled={pending}
                    label={`${t("grovnewsAdm.sources.colEnabled")}: ${s.name}`} onChange={(v) => setEnabled(s, v)} />,
                  <span key="lc" className="block tabular-nums lg:whitespace-nowrap">
                    <span className="block">{fmt(s.lastCheckedAt) ?? t("grovnewsAdm.sources.never")}</span>
                    <span className="block text-[11.5px] text-muted">{t("grovnewsAdm.sources.colSuccess")}: {fmt(s.lastSuccessAt) ?? t("grovnewsAdm.sources.never")}</span>
                  </span>,
                  <span key="er" className="block min-w-0 max-w-[14rem] space-y-1" data-grovnews-source-health={s.health}
                    data-grovnews-source-state={sourceState(s.health)}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={STATE_TONE[sourceState(s.health)]} dot>{t(`grovnewsAdm.sources.state.${sourceState(s.health)}`)}</Badge>
                      {sourceState(s.health) === "problem" && (
                        <span className={cn("text-[11.5px] font-normal", TONE_TEXT[HEALTH_TONE[s.health]])}>{t(`grovnewsAdm.sourceHealth.${s.health}`)}</span>
                      )}
                    </span>
                    {s.lastError && (
                      <span className={cn("block break-words text-[12.5px]", s.health === "DEGRADED" ? "text-warning" : "text-danger")}
                        data-grovnews-source-error={s.lastError}>
                        {errorLabel(t, s.lastError)}
                      </span>
                    )}
                    {meta.length > 0 && (
                      <span className="block break-words text-[11.5px] leading-snug text-muted tabular-nums">{meta.join(" · ")}</span>
                    )}
                  </span>,
                  <span key="a" className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={pending}
                      onClick={() => { setPreset(null); setEditing(s); }} data-grovnews-source-edit={s.id}>
                      <Pencil size={14} aria-hidden />{t("grovnewsAdm.edit")}
                    </Button>
                    <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={locked || !fetched || !s.url}
                      onClick={() => test(s)} data-grovnews-source-test={s.id}>
                      <FlaskConical size={14} aria-hidden />{t("grovnewsAdm.sources.test")}
                    </Button>
                    <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={locked || !fetched || !s.url}
                      onClick={() => ingest(s.id)} data-grovnews-source-ingest={s.id}>
                      <Download size={14} aria-hidden />
                      {busy === s.id ? t("grovnewsAdm.sources.ingesting") : t("grovnewsAdm.sources.ingestOne")}
                    </Button>
                  </span>,
                ];
              })}
            />
          )}
        </>
      )}

      {editing && (
        <SourceForm key={editing === "new" ? "new" : editing.id} source={editing === "new" ? null : editing} preset={preset}
          categories={categories} onClose={() => { setEditing(null); setPreset(null); }}
          secretState={editing === "new" ? null : secrets[editing.id] ?? null}
          onTest={editing === "new" || locked ? undefined : () => { const src = editing; setEditing(null); setPreset(null); test(src); }}
          onSaved={() => { setEditing(null); setPreset(null); router.refresh(); }} />
      )}

      {testing && (() => {
        const r = testing.result;
        const probe = r.state === "running" ? null : r.probe;
        const health = r.state === "running" ? null : r.health;
        const rec = probe?.recommended ?? null;
        const recDiffers = rec !== null && (rec.type !== testing.source.type || rec.url !== testing.source.url);
        const detected = asType(probe?.detectedType);
        const resolved = probe?.resolvedUrl && probe.resolvedUrl !== testing.source.url ? probe.resolvedUrl : null;
        const unsupported = health === "UNSUPPORTED" || probe?.verdict === "UNSUPPORTED";
        return (
          <Modal open onClose={closeTest} title={t("grovnewsAdm.sources.testTitle", { name: testing.source.name })}>
            <div className="min-w-0 space-y-3 text-sm" data-grovnews-source-test-result={r.state}>
              {r.state === "running" && <p className="text-muted">{t("grovnewsAdm.sources.testing")}</p>}
              {r.state === "failed" && (
                <div className="rounded-xl border border-line bg-raised px-3.5 py-3">
                  <p className="font-semibold text-danger">✕ {t("grovnewsAdm.sources.testFailed")}</p>
                  <p className="mt-1 break-words text-muted">{r.message}</p>
                </div>
              )}
              {r.state === "ok" && (
                <p className="font-semibold text-success" data-grovnews-source-test-works>
                  ✓ {t("grovnewsAdm.sources.testWorks")} · {t("grovnewsAdm.sources.testEntries", { count: r.entries })}
                </p>
              )}
              {probe?.lastItemAt && (
                <p className="text-[12.5px] text-muted" data-grovnews-source-test-last-item>
                  {t("grovnewsAdm.sources.testLastItem", { at: fmt(probe.lastItemAt) ?? "—" })}
                </p>
              )}
              {(health || detected || resolved || (testing.source.type === "API" && r.state === "ok")) && (
                <dl className="grid min-w-0 grid-cols-1 gap-2.5 rounded-xl border border-line px-3.5 py-3 sm:grid-cols-2" data-grovnews-source-test-details>
                  {health && detailLabel("grovnewsAdm.sources.testHealth", <HealthBadge health={health} />)}
                  {detected && detailLabel("grovnewsAdm.sources.testDetected", t(`grovnewsAdm.sourceType.${detected}`))}
                  {!detected && testing.source.type === "API" && r.state === "ok"
                    && detailLabel("grovnewsAdm.sources.testDetected", t("grovnewsAdm.sources.apiJson"))}
                  {resolved && (
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{t("grovnewsAdm.sources.testResolved")}</dt>
                      <dd className="mt-0.5 min-w-0 break-all text-[12.5px] text-muted">{resolved}</dd>
                    </div>
                  )}
                </dl>
              )}
              {unsupported && (
                <p className="rounded-xl border border-line bg-raised px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted" data-grovnews-source-unsupported>
                  {t("grovnewsAdm.sources.unsupportedNote")}
                </p>
              )}
              {rec && recDiffers && (
                <div className="min-w-0 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-accent-soft/40 px-3.5 py-3"
                  data-grovnews-source-recommendation={rec.type}>
                  <p className="flex min-w-0 items-center gap-2 font-semibold">
                    <Wand2 size={15} aria-hidden className="shrink-0 text-accent" />
                    <span className="min-w-0">{t("grovnewsAdm.sources.recommend.title", { type: t(`grovnewsAdm.sourceType.${rec.type}`) })}</span>
                  </p>
                  <p className="mt-1 break-all text-[12.5px] text-muted">{rec.url}</p>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{t("grovnewsAdm.sources.recommend.body")}</p>
                  <Button size="sm" className="mt-2.5 w-full sm:w-auto" onClick={() => openRecommendation(testing.source, rec)}
                    data-grovnews-source-recommend-apply>
                    <Pencil size={14} aria-hidden />{t("grovnewsAdm.sources.recommend.apply")}
                  </Button>
                </div>
              )}
              {r.state === "ok" && (
                r.sample.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">
                      {t("grovnewsAdm.sources.testSample")}
                    </p>
                    <ul className="space-y-1.5">
                      {r.sample.map((title, i) => (
                        <li key={i} className="break-words rounded-lg bg-raised px-3 py-2 text-[13px]">{title}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted">{t("grovnewsAdm.sources.testNone")}</p>
                )
              )}
              <p className="text-[12px] text-faint">{t("grovnewsAdm.sources.testNoteHealth")}</p>
              <div className="flex justify-end">
                <Button variant="ghost" onClick={closeTest}>{t("common.close")}</Button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function SummaryChip({ label, value, tone, active, onClick, data }: {
  label: string; value: number; tone?: Tone; active: boolean; onClick: () => void; data: string;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} data-grovnews-health-chip={data}
      className={cn(
        "panel min-w-0 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raised/60",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active && "bg-raised/60 ring-1 ring-[rgb(var(--accent)/0.45)]",
      )}>
      <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
        {tone && <span aria-hidden className={cn("dot shrink-0 bg-current", TONE_TEXT[tone])} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1 block text-lg font-semibold tabular-nums text-ink">{value}</span>
    </button>
  );
}

/** Add and edit share one form: the same fields, the same validation (the
 *  server re-validates with validateSourceInput). */
function SourceForm({ source, preset, categories, onClose, onSaved, secretState, onTest }: {
  source: AdminSource | null;
  /** A test's recommendation: the form opens with it, the admin reviews and saves. */
  preset?: { type: SourceType; url: string } | null;
  categories: CategoryRow[]; onClose: () => void; onSaved: () => void;
  /** 0128: the stored secret of an API source (never its value). */
  secretState?: SourceSecretState | null;
  /** 0128: "Testuj źródło" for a saved source (runs the recorded test). */
  onTest?: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [name, setName] = useState(source?.name ?? "");
  const [type, setType] = useState<SourceType>(preset?.type ?? source?.type ?? "RSS");
  const [url, setUrl] = useState(preset?.url ?? source?.url ?? "");
  const [categoryId, setCategoryId] = useState(source?.categoryId ?? "");
  const [priority, setPriority] = useState(String(source?.priority ?? 50));
  const [official, setOfficial] = useState(source?.official ?? false);
  const [language, setLanguage] = useState<Language>(source?.language ?? "pl");
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  // 0128: an API source's authorization; the secret typed here is write-only.
  const [authKind, setAuthKind] = useState<SourceAuthKind>(source?.authKind ?? "none");
  const [authHeader, setAuthHeader] = useState(source?.authHeader ?? "");
  const [secret, setSecret] = useState("");
  const [secretGone, setSecretGone] = useState(false);

  // An inactive category stays selectable for the source that already uses it,
  // so editing something else never silently clears it.
  const choices = categories.filter((c) => c.is_active || c.id === source?.categoryId);
  const manual = type === "MANUAL";
  const urlBad = url.trim() !== "" && !isAcceptableSourceUrl(url);
  const priorityNum = priority.trim() === "" ? Number.NaN : Number(priority);
  const priorityBad = !Number.isInteger(priorityNum) || priorityNum < 0 || priorityNum > 100;
  const api = type === "API";
  const headerBad = api && authKind === "header" && !isValidAuthHeader(authHeader.trim());

  const save = () => start(async () => {
    const kind: SourceAuthKind = api ? authKind : "none";
    const res = await saveSourceAction(source?.id ?? null, {
      name, type, url: url.trim() || null, enabled, categoryId: categoryId || null, priority: priorityNum, official, language,
      authKind: kind, authHeader: kind === "header" ? authHeader.trim() : null,
    });
    if (!res.ok) { toast.error(errorMessage(t, res.error)); return; }
    // The secret goes to the vault only after the row says it is expected.
    if (kind !== "none" && secret.trim()) {
      const sec = await saveSourceSecretAction(res.id, secret);
      setSecret("");
      if (!sec.ok) { toast.error(errorMessage(t, sec.error)); onSaved(); return; }
      toast.success(t("grovnewsAdm.sources.auth.secretSavedToast"));
    }
    toast.success(t(source ? "grovnewsAdm.sources.updated" : "grovnewsAdm.sources.created"));
    onSaved();
  });

  return (
    <Modal open onClose={onClose} title={t(source ? "grovnewsAdm.sources.formEdit" : "grovnewsAdm.sources.formAdd")}>
      <form className="min-w-0 space-y-4" data-grovnews-source-form={source?.id ?? "new"}
        onSubmit={(e) => { e.preventDefault(); save(); }}>
        {preset && (
          <p className="flex min-w-0 items-start gap-2 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-accent-soft/40 px-3.5 py-2.5 text-[12.5px] leading-snug text-muted"
            data-grovnews-source-form-preset={preset.type}>
            <Wand2 size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <span className="min-w-0">{t("grovnewsAdm.sources.recommend.formNote")}</span>
          </p>
        )}
        <div>
          <Label htmlFor="gns-name" hint={`${name.length}/120`}>{t("common.name")}</Label>
          <Input id="gns-name" value={name} maxLength={120} required autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="gns-type">{t("grovnewsAdm.sources.fType")}</Label>
          <Select id="gns-type" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
            {SOURCE_TYPES.map((s) => <option key={s} value={s}>{t(`grovnewsAdm.sourceType.${s}`)}</option>)}
          </Select>
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] leading-snug text-muted" data-grovnews-source-type-hint={type}>
            <span className="min-w-0">{t(`grovnewsAdm.sourceTypeHint.${type}`)}</span>
          </p>
        </div>

        <div>
          <Label htmlFor="gns-url" hint={manual ? t("grovnewsAdm.sources.optional") : t("grovnewsAdm.sources.fUrlHint")}>
            {t("grovnewsAdm.sources.fUrl")}
          </Label>
          <Input id="gns-url" type="url" inputMode="url" value={url} maxLength={2000} spellCheck={false} autoComplete="off"
            placeholder="https://" required={!manual} aria-invalid={urlBad || undefined} onChange={(e) => setUrl(e.target.value)} />
          {urlBad && <p className="mt-1.5 text-[12px] text-danger">{t("grovnewsAdm.sources.err.url")}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="gns-cat">{t("grovnewsAdm.fCategory")}</Label>
            <Select id="gns-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("grovnewsAdm.noCategory")}</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="gns-prio" hint="0–100">{t("grovnewsAdm.sources.colPriority")}</Label>
            <Input id="gns-prio" type="number" inputMode="numeric" min={0} max={100} step={1} value={priority}
              aria-invalid={priorityBad || undefined} onChange={(e) => setPriority(e.target.value)} />
            {priorityBad && <p className="mt-1.5 text-[12px] text-danger">{t("grovnewsAdm.sources.err.priority")}</p>}
          </div>
          <div className="min-w-0">
            <Label htmlFor="gns-lang">{t("grovnewsAdm.fLanguage")}</Label>
            <Select id="gns-lang" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </Select>
          </div>
        </div>

        {api && (
          <SourceAuthFields sourceId={source?.id ?? null} kind={authKind} header={authHeader} secret={secret}
            secretState={secretGone ? { configured: false, lastFour: null } : secretState ?? null}
            onKind={setAuthKind} onHeader={setAuthHeader} onSecret={setSecret} onSecretRemoved={() => setSecretGone(true)} />
        )}

        <div className="space-y-3 rounded-xl border border-line px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{t("grovnewsAdm.sources.fOfficial")}</span>
              <span className="block text-[12px] leading-snug text-muted">{t("grovnewsAdm.sources.fOfficialHint")}</span>
            </span>
            <Switch checked={official} onChange={setOfficial} label={t("grovnewsAdm.sources.fOfficial")} />
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{t("grovnewsAdm.sources.colEnabled")}</span>
              <span className="block text-[12px] leading-snug text-muted">{t("grovnewsAdm.sources.fEnabledHint")}</span>
            </span>
            <Switch checked={enabled} onChange={setEnabled} label={t("grovnewsAdm.sources.colEnabled")} />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {onTest && source && isFetched(source.type) && source.url && (
            <Button type="button" variant="secondary" className="mr-auto" disabled={pending} onClick={onTest} data-grovnews-source-form-test>
              <FlaskConical size={14} aria-hidden />{t("grovnewsAdm.sources.testSource")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={pending || !name.trim() || urlBad || priorityBad || headerBad || (!manual && !url.trim())}>
            {pending ? t("common.saving") : t("grovnewsAdm.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
