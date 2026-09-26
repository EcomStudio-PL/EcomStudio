"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FlaskConical, Pencil, Plus, Rss, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { AdminTable } from "@/components/ui/admin-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ingestNowAction, saveSourceAction, setSourceEnabledAction, testSourceAction,
} from "@/app/actions/grovnews-research";
import { FETCHED_TYPES, SOURCE_TYPES, isAcceptableSourceUrl, type SourceType } from "@/lib/grovnews-research";
import type { AdminSource } from "@/lib/services/grovnews-research";
import type { CategoryRow } from "@/lib/services/grovnews";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Language = AdminSource["language"];
const LANGUAGES: readonly Language[] = ["pl", "en", "de"];

/** The fetcher's machine codes (lib/server/grovnews/fetch.ts + pipeline) that
 *  have their own sentence; `http_status_<n>` is a pattern, anything else is
 *  shown as the generic "error". */
const ERROR_CODES = [
  "timeout", "dns", "private_address", "forbidden_host", "invalid_url", "too_large", "too_many_redirects",
  "network", "robots", "unrecognized_format", "adapter_unavailable", "no_url", "manual", "error",
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
  noServerKey: "grovnewsAdm.sources.err.noServerKey",
  invalid: "grovnewsAdm.sources.err.invalid",
  forbidden: "grovnewsAdm.errForbidden",
  generic: "common.error",
};
const errorMessage = (t: T, code: string | undefined) => t(ERROR_KEYS[code ?? "generic"] ?? "common.error");

const isFetched = (type: SourceType) => FETCHED_TYPES.includes(type);

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

type TestResult =
  | { state: "running" }
  | { state: "ok"; entries: number; sample: string[] }
  | { state: "failed"; message: string };

/** The list of sources the daily research reads: add, edit, switch on/off,
 *  test one without storing anything, fetch one or all now. */
export function SourcesManager({ sources, categories }: { sources: AdminSource[]; categories: CategoryRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormatDateTime();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminSource | "new" | null>(null);
  const [testing, setTesting] = useState<{ name: string; result: TestResult } | null>(null);
  // Closing the test modal while the read is still running must not reopen it
  // when the answer arrives: each run carries a number, a close bumps it.
  const testRun = useRef(0);
  const closeTest = () => { testRun.current += 1; setTesting(null); };

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
    setTesting({ name: s.name, result: { state: "running" } });
    start(async () => {
      const res = await testSourceAction(s.id);
      if (run !== testRun.current) return;
      if (res.ok) {
        setTesting({ name: s.name, result: { state: "ok", entries: res.entries, sample: res.sample } });
        return;
      }
      const message = (res.error === "fetch" || res.error === "notFetchable")
        ? errorLabel(t, res.code ?? "error") : errorMessage(t, res.error);
      setTesting({ name: s.name, result: { state: "failed", message } });
      toast.error(message);
    });
  };

  const addButton = (label: string) => (
    <Button onClick={() => setEditing("new")} className="shrink-0 whitespace-nowrap" data-grovnews-sources-add>
      <Plus size={15} aria-hidden />{label}
    </Button>
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {addButton(t("grovnewsAdm.sources.add"))}
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" disabled={pending || sources.length === 0}
          onClick={() => ingest(null)} data-grovnews-sources-ingest-all>
          <Download size={15} aria-hidden />
          {busy === "all" ? t("grovnewsAdm.sources.ingesting") : t("grovnewsAdm.sources.ingestAll")}
        </Button>
      </div>

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
        <AdminTable
          empty={t("grovnewsAdm.sources.emptyTitle")}
          // Type + category and the two timestamps share cells, so the row's
          // actions stay on screen in a desktop table instead of scrolling away.
          headers={[t("common.name"), `${t("common.type")} · ${t("grovnewsAdm.colCategory")}`, t("grovnewsAdm.sources.colPriority"),
            t("grovnewsAdm.sources.colEnabled"), `${t("grovnewsAdm.sources.colChecked")} · ${t("grovnewsAdm.sources.colSuccess")}`,
            t("grovnewsAdm.sources.colError"), t("common.actions")]}
          rows={sources.map((s) => {
            const host = hostOf(s.url);
            const fetched = isFetched(s.type);
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
              <span key="ty" className="block min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="whitespace-nowrap">{t(`grovnewsAdm.sourceType.${s.type}`)}</span>
                  {s.type === "API" && <Badge tone="warning">{t("common.unavailable")}</Badge>}
                </span>
                <span className="block truncate text-[11.5px] font-normal text-muted">{s.categoryName ?? t("grovnewsAdm.noCategory")}</span>
              </span>,
              <span key="p" className="tabular-nums">{s.priority}</span>,
              <Switch key="e" checked={s.enabled} disabled={pending}
                label={`${t("grovnewsAdm.sources.colEnabled")}: ${s.name}`} onChange={(v) => setEnabled(s, v)} />,
              <span key="lc" className="block whitespace-nowrap tabular-nums">
                <span className="block">{fmt(s.lastCheckedAt) ?? t("grovnewsAdm.sources.never")}</span>
                <span className="block text-[11.5px] text-muted">{t("grovnewsAdm.sources.colSuccess")}: {fmt(s.lastSuccessAt) ?? t("grovnewsAdm.sources.never")}</span>
              </span>,
              s.lastError
                ? <span key="er" className="block min-w-0 max-w-[12rem] break-words text-[12.5px] text-danger" data-grovnews-source-error={s.lastError}>
                    {errorLabel(t, s.lastError)}
                  </span>
                : <span key="er" className="text-faint">{t("grovnewsAdm.sources.noError")}</span>,
              <span key="a" className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={pending}
                  onClick={() => setEditing(s)} data-grovnews-source-edit={s.id}>
                  <Pencil size={14} aria-hidden />{t("grovnewsAdm.edit")}
                </Button>
                <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={pending || !fetched || !s.url}
                  onClick={() => test(s)} data-grovnews-source-test={s.id}>
                  <FlaskConical size={14} aria-hidden />{t("grovnewsAdm.sources.test")}
                </Button>
                <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={pending || !fetched || !s.url}
                  onClick={() => ingest(s.id)} data-grovnews-source-ingest={s.id}>
                  <Download size={14} aria-hidden />
                  {busy === s.id ? t("grovnewsAdm.sources.ingesting") : t("grovnewsAdm.sources.ingestOne")}
                </Button>
              </span>,
            ];
          })}
        />
      )}

      {editing && (
        <SourceForm source={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }} />
      )}

      {testing && (
        <Modal open onClose={closeTest} title={t("grovnewsAdm.sources.testTitle", { name: testing.name })}>
          <div className="min-w-0 space-y-3 text-sm" data-grovnews-source-test-result={testing.result.state}>
            {testing.result.state === "running" && <p className="text-muted">{t("grovnewsAdm.sources.testing")}</p>}
            {testing.result.state === "failed" && (
              <div className="rounded-xl border border-line bg-raised px-3.5 py-3">
                <p className="font-semibold text-danger">{t("grovnewsAdm.sources.testFailed")}</p>
                <p className="mt-1 break-words text-muted">{testing.result.message}</p>
              </div>
            )}
            {testing.result.state === "ok" && (
              <>
                <p className="font-semibold">{t("grovnewsAdm.sources.testEntries", { count: testing.result.entries })}</p>
                {testing.result.sample.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">
                      {t("grovnewsAdm.sources.testSample")}
                    </p>
                    <ul className="space-y-1.5">
                      {testing.result.sample.map((title, i) => (
                        <li key={i} className="break-words rounded-lg bg-raised px-3 py-2 text-[13px]">{title}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted">{t("grovnewsAdm.sources.testNone")}</p>
                )}
              </>
            )}
            <p className="text-[12px] text-faint">{t("grovnewsAdm.sources.testNote")}</p>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={closeTest}>{t("common.close")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Add and edit share one form: the same fields, the same validation (the
 *  server re-validates with validateSourceInput). */
function SourceForm({ source, categories, onClose, onSaved }: {
  source: AdminSource | null; categories: CategoryRow[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [name, setName] = useState(source?.name ?? "");
  const [type, setType] = useState<SourceType>(source?.type ?? "RSS");
  const [url, setUrl] = useState(source?.url ?? "");
  const [categoryId, setCategoryId] = useState(source?.categoryId ?? "");
  const [priority, setPriority] = useState(String(source?.priority ?? 50));
  const [official, setOfficial] = useState(source?.official ?? false);
  const [language, setLanguage] = useState<Language>(source?.language ?? "pl");
  const [enabled, setEnabled] = useState(source?.enabled ?? true);

  // An inactive category stays selectable for the source that already uses it,
  // so editing something else never silently clears it.
  const choices = categories.filter((c) => c.is_active || c.id === source?.categoryId);
  const manual = type === "MANUAL";
  const urlBad = url.trim() !== "" && !isAcceptableSourceUrl(url);
  const priorityNum = priority.trim() === "" ? Number.NaN : Number(priority);
  const priorityBad = !Number.isInteger(priorityNum) || priorityNum < 0 || priorityNum > 100;

  const save = () => start(async () => {
    const res = await saveSourceAction(source?.id ?? null, {
      name, type, url: url.trim() || null, enabled, categoryId: categoryId || null, priority: priorityNum, official, language,
    });
    if (!res.ok) { toast.error(errorMessage(t, res.error)); return; }
    toast.success(t(source ? "grovnewsAdm.sources.updated" : "grovnewsAdm.sources.created"));
    onSaved();
  });

  return (
    <Modal open onClose={onClose} title={t(source ? "grovnewsAdm.sources.formEdit" : "grovnewsAdm.sources.formAdd")}>
      <form className="min-w-0 space-y-4" data-grovnews-source-form={source?.id ?? "new"}
        onSubmit={(e) => { e.preventDefault(); save(); }}>
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
            {type === "API" && <Badge tone="warning">{t("common.unavailable")}</Badge>}
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
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={pending || !name.trim() || urlBad || priorityBad || (!manual && !url.trim())}>
            {pending ? t("common.saving") : t("grovnewsAdm.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
