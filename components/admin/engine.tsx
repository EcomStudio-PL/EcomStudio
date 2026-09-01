"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen, ChevronDown, FileArchive, History, Loader2, Plus, ScrollText, Star, Trash2, Upload, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import {
  activateEngineVersionAction, addEngineVersionAction,
  deleteEngineRuleAction, deleteKnowledgeExampleAction, deleteKnowledgeSetAction,
  saveEngineRuleAction, toggleEngineRuleAction,
  updateKnowledgeExampleAction, updateKnowledgeSetAction,
} from "@/app/actions/engine";

/**
 * AI ENGINE console (admin): ZIP import with live stage feedback, the
 * knowledge-set library with curation-level example editing, the prompt
 * rules the engine always applies, and the version history. Content read
 * from imported PDFs/ZIPs is DATA the admin curates — never instructions.
 */

export type KnowledgeSetView = {
  id: string; name: string;
  category: string | null; description: string | null; model: string | null;
  status: string; error: string | null; notes: string | null;
  fileCount: number; version: number;
  createdAt: string; updatedAt: string;
  exampleCount: number; enabledCount: number; avgRating: number | null;
};
export type EngineRuleView = {
  id: string; name: string; ruleType: string; content: string;
  priority: number; enabled: boolean; version: number; updatedAt: string;
};
export type EngineVersionView = {
  id: string; version: string; changelog: string | null; active: boolean; createdAt: string;
};

type ExampleRow = {
  id: string; reference_path: string | null; generated_path: string | null;
  prompt_used: string | null; result_rating: number | null;
  what_worked: string | null; what_failed: string | null; correction: string | null;
  tags: string[]; enabled: boolean;
};

const STATUS_TONE: Record<string, string> = {
  ready: "text-success", error: "text-danger",
  uploaded: "text-muted", validating: "text-accent2", extracting: "text-accent2",
  processing: "text-accent2", indexing: "text-accent2",
};

function StatusChip({ status }: { status: string }) {
  const { t } = useI18n();
  const live = !["ready", "error"].includes(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold",
      STATUS_TONE[status] ?? "text-muted")}>
      {live && <Loader2 size={10} className="animate-spin" aria-hidden />}
      {t(`admin.engine.status.${status}`, {}) || status}
    </span>
  );
}

export function EngineAdmin({ sets, rules, versions }: {
  sets: KnowledgeSetView[]; rules: EngineRuleView[]; versions: EngineVersionView[];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"knowledge" | "rules" | "versions">("knowledge");
  const tabs = [
    { key: "knowledge" as const, icon: BookOpen, label: t("admin.engine.tabKnowledge") },
    { key: "rules" as const, icon: ScrollText, label: t("admin.engine.tabRules") },
    { key: "versions" as const, icon: History, label: t("admin.engine.tabVersions") },
  ];
  return (
    <div>
      <div className="mb-4 flex w-full items-stretch gap-1 rounded-xl border border-line bg-sunken/70 p-1 sm:w-fit">
        {tabs.map((tb) => (
          <button key={tb.key} type="button" aria-pressed={tab === tb.key} onClick={() => setTab(tb.key)}
            className={cn("flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors sm:flex-none sm:px-4",
              tab === tb.key ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.4)]" : "text-muted hover:text-ink")}>
            <tb.icon size={14} aria-hidden className={tab === tb.key ? "text-accent" : "text-faint"} />
            <span className="truncate">{tb.label}</span>
          </button>
        ))}
      </div>
      {tab === "knowledge" && <KnowledgeTab sets={sets} />}
      {tab === "rules" && <RulesTab rules={rules} />}
      {tab === "versions" && <VersionsTab versions={versions} />}
    </div>
  );
}

/* ── Knowledge: import + set library ────────────────────────────────────── */

function KnowledgeTab({ sets }: { sets: KnowledgeSetView[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(sets.map((x) => x.category).filter((c): c is string => !!c))].sort(),
    [sets]);

  const filtered = useMemo(() => sets.filter((x) =>
    (!status || x.status === status)
    && (!category || x.category === category)
    && (!q.trim() || `${x.name} ${x.category ?? ""} ${x.model ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
  ), [sets, q, status, category]);

  // While the import request runs, its set row reports each pipeline stage —
  // poll it so the admin watches the progress live.
  useEffect(() => {
    if (!busy) { setLiveStatus(null); return; }
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data } = await supabase.from("knowledge_sets")
        .select("status, error").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data) setLiveStatus(data.status);
    }, 2500);
    return () => clearInterval(id);
  }, [busy]);

  async function doImport() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      const res = await fetch("/api/admin/knowledge/import", { method: "POST", body: fd });
      const json = await res.json() as {
        ok: boolean; error?: string; examples?: number; indexed?: number; embeddings?: boolean; skipped?: string[];
      };
      if (json.ok) {
        toast.success(t("admin.engine.importDone", { n: json.examples ?? 0 }));
        if (!json.embeddings) toast.warning(t("admin.engine.importNoEmbeddings"));
        if (json.skipped?.length) toast.message(t("admin.engine.importSkipped", { n: json.skipped.length }));
        setFile(null); setName("");
        if (fileRef.current) fileRef.current.value = "";
      } else {
        const known = t(`admin.engine.err.${json.error}`, {});
        toast.error(known && known !== `admin.engine.err.${json.error}` ? known : t("common.error"));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {/* Import */}
      <section className="panel rounded-2xl p-4 sm:p-5">
        <p className="text-[13.5px] font-semibold tracking-tight">{t("admin.engine.importTitle")}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("admin.engine.importSub")}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">{t("admin.engine.importLayout")}</p>
        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-sunken/50 px-4 py-2.5 text-[12.5px] font-semibold text-muted transition-colors hover:border-[rgb(var(--accent)/0.5)] hover:text-accent">
            <FileArchive size={14} aria-hidden />
            <span className="max-w-56 truncate">{file ? file.name : t("admin.engine.pickZip")}</span>
          </button>
          <div className="min-w-0 flex-1">
            <Label htmlFor="ke-name">{t("admin.engine.setName")}</Label>
            <Input id="ke-name" value={name} disabled={busy} placeholder={t("admin.engine.setNamePh")}
              onChange={(e) => setName(e.target.value)} maxLength={160} />
          </div>
          <button type="button" disabled={!file || busy} onClick={doImport}
            className={cn("cta flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold",
              (!file || busy) && "cursor-not-allowed opacity-55")}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
            {busy
              ? (liveStatus ? t(`admin.engine.status.${liveStatus}`, {}) || t("admin.engine.importing") : t("admin.engine.importing"))
              : t("admin.engine.importCta")}
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">{t("admin.engine.importSecurity")}</p>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.engine.searchPh")}
          className="w-full sm:w-60" aria-label={t("admin.engine.searchPh")} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
          <option value="">{t("admin.engine.anyStatus")}</option>
          {["ready", "error", "processing", "indexing"].map((st) => (
            <option key={st} value={st}>{t(`admin.engine.status.${st}`, {}) || st}</option>
          ))}
        </Select>
        {categories.length > 0 && (
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto"
            aria-label={t("admin.engine.category")}>
            <option value="">{t("admin.engine.anyCategory")}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        <span className="ml-auto text-[11.5px] tabular-nums text-faint">
          {t("admin.engine.setCount", { n: filtered.length })}
        </span>
      </div>

      {/* Sets */}
      {filtered.length === 0 ? (
        <p className="panel rounded-2xl p-8 text-center text-[13px] text-muted">{t("admin.engine.noSets")}</p>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((set) => (
            <SetCard key={set.id} set={set} open={openId === set.id}
              onToggle={() => setOpenId(openId === set.id ? null : set.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SetCard({ set, open, onToggle }: { set: KnowledgeSetView; open: boolean; onToggle: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({
    name: set.name, category: set.category ?? "", model: set.model ?? "",
    description: set.description ?? "", notes: set.notes ?? "",
  });
  const [examples, setExamples] = useState<ExampleRow[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  // Examples load on first expand — the list page stays light.
  useEffect(() => {
    if (!open || examples !== null) return;
    const supabase = createClient();
    void (async () => {
      const { data } = await supabase.from("knowledge_examples")
        .select("id, reference_path, generated_path, prompt_used, result_rating, what_worked, what_failed, correction, tags, enabled")
        .eq("set_id", set.id).order("created_at", { ascending: true }).limit(200);
      const rows = (data ?? []) as ExampleRow[];
      setExamples(rows);
      const paths = rows.flatMap((r) => [r.reference_path, r.generated_path]).filter((p): p is string => !!p);
      if (paths.length) {
        const { data: signed } = await supabase.storage.from("knowledge").createSignedUrls(paths, 3600);
        const map = new Map<string, string>();
        (signed ?? []).forEach((entry, i) => { if (entry.signedUrl) map.set(paths[i], entry.signedUrl); });
        setUrls(map);
      }
    })();
  }, [open, examples, set.id]);

  async function saveMeta() {
    setBusy(true);
    const res = await updateKnowledgeSetAction(set.id, {
      name: meta.name, product_category: meta.category, model: meta.model,
      product_description: meta.description, notes: meta.notes,
    });
    setBusy(false);
    if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
    else toast.error(t("common.error"));
  }

  async function removeSet() {
    if (!window.confirm(t("admin.engine.deleteSetConfirm"))) return;
    setBusy(true);
    const res = await deleteKnowledgeSetAction(set.id);
    setBusy(false);
    if (res.ok) { toast.success(t("common.deleted")); router.refresh(); }
    else toast.error(t("common.error"));
  }

  return (
    <section className="panel rounded-2xl">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold tracking-tight">{set.name}</span>
          <span className="mt-0.5 block text-[11px] text-faint">
            {[set.category, set.model, new Date(set.createdAt).toLocaleDateString(locale)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <StatusChip status={set.status} />
        <span className="text-[11.5px] tabular-nums text-muted">
          {t("admin.engine.examplesShort", { n: set.exampleCount })}
        </span>
        {set.avgRating !== null && (
          <span className="flex items-center gap-1 text-[11.5px] font-semibold tabular-nums text-accent2">
            <Star size={11} aria-hidden fill="currentColor" />{set.avgRating}
          </span>
        )}
        <ChevronDown size={15} aria-hidden className={cn("text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {set.status === "error" && set.error && (
            <p className="rounded-xl bg-[rgb(var(--danger)/0.08)] px-3 py-2 text-[12px] font-medium text-danger">
              {t(`admin.engine.err.${set.error}`, {}) || set.error}
            </p>
          )}
          {/* Meta */}
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div><Label htmlFor={`sn-${set.id}`}>{t("admin.engine.setName")}</Label>
              <Input id={`sn-${set.id}`} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={160} /></div>
            <div><Label htmlFor={`sc-${set.id}`}>{t("admin.engine.category")}</Label>
              <Input id={`sc-${set.id}`} value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })} maxLength={120} /></div>
            <div><Label htmlFor={`sm-${set.id}`}>{t("admin.engine.model")}</Label>
              <Input id={`sm-${set.id}`} value={meta.model} onChange={(e) => setMeta({ ...meta, model: e.target.value })} maxLength={120} /></div>
          </div>
          <div><Label htmlFor={`sd-${set.id}`}>{t("admin.engine.description")}</Label>
            <Textarea id={`sd-${set.id}`} rows={2} value={meta.description}
              onChange={(e) => setMeta({ ...meta, description: e.target.value })} maxLength={2000} /></div>
          <div><Label htmlFor={`sno-${set.id}`}>{t("admin.engine.notes")}</Label>
            <Textarea id={`sno-${set.id}`} rows={2} value={meta.notes}
              onChange={(e) => setMeta({ ...meta, notes: e.target.value })} maxLength={8000} /></div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" disabled={busy} onClick={removeSet}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold text-danger transition-colors hover:bg-[rgb(var(--danger)/0.08)]">
              <Trash2 size={13} aria-hidden />{t("admin.engine.deleteSet")}
            </button>
            <button type="button" disabled={busy} onClick={saveMeta}
              className="rounded-xl bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>

          {/* Examples */}
          <p className="text-[12.5px] font-semibold tracking-tight">{t("admin.engine.examplesTitle")}</p>
          {examples === null ? (
            <p className="flex items-center gap-2 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" aria-hidden />{t("common.loading")}</p>
          ) : examples.length === 0 ? (
            <p className="text-[12px] text-muted">{t("admin.engine.noExamples")}</p>
          ) : (
            <div className="space-y-2.5">
              {examples.map((ex) => (
                <ExampleCard key={ex.id} ex={ex} urls={urls}
                  onGone={() => setExamples((prev) => (prev ?? []).filter((x) => x.id !== ex.id))} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ExampleCard({ ex, urls, onGone }: {
  ex: ExampleRow; urls: Map<string, string>; onGone: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState({
    what_worked: ex.what_worked ?? "", what_failed: ex.what_failed ?? "",
    correction: ex.correction ?? "", tags: ex.tags.join(", "),
    rating: ex.result_rating, enabled: ex.enabled,
  });

  async function save(patch?: Partial<{ enabled: boolean; result_rating: number | null }>) {
    setBusy(true);
    const res = await updateKnowledgeExampleAction(ex.id, {
      what_worked: state.what_worked, what_failed: state.what_failed, correction: state.correction,
      tags: state.tags.split(",").map((x) => x.trim()).filter(Boolean),
      result_rating: patch?.result_rating !== undefined ? patch.result_rating : state.rating,
      enabled: patch?.enabled !== undefined ? patch.enabled : state.enabled,
    });
    setBusy(false);
    if (res.ok) toast.success(t("common.saved"));
    else toast.error(t("common.error"));
  }

  async function remove() {
    if (!window.confirm(t("admin.engine.deleteExampleConfirm"))) return;
    setBusy(true);
    const res = await deleteKnowledgeExampleAction(ex.id);
    setBusy(false);
    if (res.ok) { toast.success(t("common.deleted")); onGone(); }
    else toast.error(t("common.error"));
  }

  const pair = [
    { path: ex.reference_path, label: t("admin.engine.before") },
    { path: ex.generated_path, label: t("admin.engine.after") },
  ];
  return (
    <div className={cn("plate rounded-xl p-3", !state.enabled && "opacity-60")}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 gap-2">
          {pair.map((p) => (
            <figure key={p.label} className="w-24">
              <div className="aspect-square overflow-hidden rounded-lg bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
                {p.path && urls.get(p.path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(p.path)} alt={p.label} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-faint"><X size={13} aria-hidden /></span>
                )}
              </div>
              <figcaption className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wide text-faint">{p.label}</figcaption>
            </figure>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Rating 1-5 */}
            <span className="flex items-center gap-0.5" role="radiogroup" aria-label={t("admin.engine.rating")}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} type="button" role="radio" aria-checked={state.rating === star}
                  aria-label={String(star)} disabled={busy}
                  onClick={() => {
                    const next = state.rating === star ? null : star;
                    setState((prev) => ({ ...prev, rating: next }));
                    void save({ result_rating: next });
                  }}
                  className={cn("transition-colors", (state.rating ?? 0) >= star ? "text-accent2" : "text-faint hover:text-muted")}>
                  <Star size={14} aria-hidden fill={(state.rating ?? 0) >= star ? "currentColor" : "none"} />
                </button>
              ))}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <Switch checked={state.enabled} disabled={busy} label={t("admin.engine.enabled")}
                onChange={(next) => { setState((prev) => ({ ...prev, enabled: next })); void save({ enabled: next }); }} />
              <button type="button" disabled={busy} onClick={remove} aria-label={t("common.delete")}
                className="rounded-lg p-1.5 text-faint transition-colors hover:bg-[rgb(var(--danger)/0.1)] hover:text-danger">
                <Trash2 size={13} aria-hidden />
              </button>
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Textarea rows={2} value={state.what_worked} maxLength={1000}
              placeholder={t("admin.engine.whatWorked")} aria-label={t("admin.engine.whatWorked")}
              onChange={(e) => setState({ ...state, what_worked: e.target.value })} className="!min-h-16 text-[12px]" />
            <Textarea rows={2} value={state.what_failed} maxLength={1000}
              placeholder={t("admin.engine.whatFailed")} aria-label={t("admin.engine.whatFailed")}
              onChange={(e) => setState({ ...state, what_failed: e.target.value })} className="!min-h-16 text-[12px]" />
            <Textarea rows={2} value={state.correction} maxLength={1000}
              placeholder={t("admin.engine.correction")} aria-label={t("admin.engine.correction")}
              onChange={(e) => setState({ ...state, correction: e.target.value })} className="!min-h-16 text-[12px]" />
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input value={state.tags} maxLength={400} placeholder={t("admin.engine.tagsPh")}
                aria-label={t("admin.engine.tagsPh")}
                onChange={(e) => setState({ ...state, tags: e.target.value })} className="text-[12px]" />
            </div>
            <button type="button" disabled={busy} onClick={() => save()}
              className="shrink-0 rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Rules ──────────────────────────────────────────────────────────────── */

const RULE_TYPES = ["style", "quality", "avoid"] as const;

function RulesTab({ rules }: { rules: EngineRuleView[] }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-muted">{t("admin.engine.rulesSub")}</p>
      {rules.map((r) => <RuleCard key={r.id} rule={r} />)}
      {adding ? (
        <RuleEditor onClose={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-sunken/40 px-4 py-4 text-[13px] font-semibold text-muted transition-colors hover:border-[rgb(var(--accent)/0.5)] hover:text-accent">
          <Plus size={14} aria-hidden />{t("admin.engine.addRule")}
        </button>
      )}
    </div>
  );
}

function RuleCard({ rule }: { rule: EngineRuleView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (editing) return <RuleEditor rule={rule} onClose={() => setEditing(false)} />;
  return (
    <section className={cn("panel rounded-2xl p-4", !rule.enabled && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold tracking-tight">{rule.name}</span>
          <span className="mt-1 block text-[12px] leading-relaxed text-muted">{rule.content}</span>
        </span>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
          {t(`admin.engine.ruleType.${rule.ruleType}`, {}) || rule.ruleType}
        </span>
        <span className="text-[11px] tabular-nums text-faint">#{rule.priority} · v{rule.version}</span>
        <Switch checked={rule.enabled} disabled={busy} label={t("admin.engine.enabled")}
          onChange={async (next) => {
            setBusy(true);
            const res = await toggleEngineRuleAction(rule.id, next);
            setBusy(false);
            if (res.ok) router.refresh(); else toast.error(t("common.error"));
          }} />
        <button type="button" onClick={() => setEditing(true)}
          className="rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
          {t("common.edit")}
        </button>
      </div>
    </section>
  );
}

function RuleEditor({ rule, onClose }: { rule?: EngineRuleView; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: rule?.name ?? "", ruleType: rule?.ruleType ?? "style",
    content: rule?.content ?? "", priority: rule?.priority ?? 100,
    enabled: rule?.enabled ?? true,
  });

  async function submit() {
    if (!form.name.trim() || !form.content.trim()) { toast.error(t("admin.engine.ruleRequired")); return; }
    setBusy(true);
    const res = await saveEngineRuleAction({
      id: rule?.id, name: form.name, rule_type: form.ruleType,
      content: form.content, priority: form.priority, enabled: form.enabled,
    });
    setBusy(false);
    if (res.ok) { toast.success(t("common.saved")); onClose(); router.refresh(); }
    else toast.error(res.error === "encryption_unavailable" ? t("admin.engine.encryptionUnavailable") : t("common.error"));
  }

  async function remove() {
    if (!rule || !window.confirm(t("admin.engine.deleteRuleConfirm"))) return;
    setBusy(true);
    const res = await deleteEngineRuleAction(rule.id);
    setBusy(false);
    if (res.ok) { toast.success(t("common.deleted")); onClose(); router.refresh(); }
    else toast.error(t("common.error"));
  }

  return (
    <section className="panel rounded-2xl p-4 ring-1 ring-[rgb(var(--accent)/0.3)]">
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_10rem_6rem]">
        <div><Label htmlFor="re-name">{t("admin.engine.ruleName")}</Label>
          <Input id="re-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label htmlFor="re-type">{t("admin.engine.ruleTypeLabel")}</Label>
          <Select id="re-type" value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value })}>
            {RULE_TYPES.map((rt) => <option key={rt} value={rt}>{t(`admin.engine.ruleType.${rt}`, {}) || rt}</option>)}
          </Select></div>
        <div><Label htmlFor="re-prio">{t("admin.engine.priority")}</Label>
          <Input id="re-prio" type="number" min={1} max={999} value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 100 })} /></div>
      </div>
      <div className="mt-2.5">
        <Label htmlFor="re-content" hint={`${form.content.length}/1000`}>{t("admin.engine.ruleContent")}</Label>
        <Textarea id="re-content" rows={3} value={form.content} maxLength={1000}
          placeholder={t("admin.engine.ruleContentPh")}
          onChange={(e) => setForm({ ...form, content: e.target.value })} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Switch checked={form.enabled} label={t("admin.engine.enabled")}
          onChange={(next) => setForm({ ...form, enabled: next })} />
        {rule && (
          <button type="button" disabled={busy} onClick={remove}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold text-danger transition-colors hover:bg-[rgb(var(--danger)/0.08)]">
            <Trash2 size={13} aria-hidden />{t("common.delete")}
          </button>
        )}
        <span className="ml-auto flex gap-2">
          <button type="button" disabled={busy} onClick={onClose}
            className="rounded-xl px-3 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:bg-raised">
            {t("common.cancel")}
          </button>
          <button type="button" disabled={busy} onClick={submit}
            className="rounded-xl bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </span>
      </div>
    </section>
  );
}

/* ── Versions ───────────────────────────────────────────────────────────── */

function VersionsTab({ versions }: { versions: EngineVersionView[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ version: "", changelog: "", activate: false });

  async function add() {
    if (!form.version.trim()) { toast.error(t("admin.engine.versionRequired")); return; }
    setBusy(true);
    const res = await addEngineVersionAction(form);
    setBusy(false);
    if (res.ok) { toast.success(t("common.saved")); setForm({ version: "", changelog: "", activate: false }); router.refresh(); }
    else toast.error(t("common.error"));
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-muted">{t("admin.engine.versionsSub")}</p>
      <section className="panel rounded-2xl p-4">
        <div className="grid gap-2.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div><Label htmlFor="ev-v">{t("admin.engine.versionLabel")}</Label>
            <Input id="ev-v" value={form.version} maxLength={40} placeholder="v4"
              onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
          <div><Label htmlFor="ev-c">{t("admin.engine.changelog")}</Label>
            <Input id="ev-c" value={form.changelog} maxLength={2000} placeholder={t("admin.engine.changelogPh")}
              onChange={(e) => setForm({ ...form, changelog: e.target.value })} /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Switch checked={form.activate} label={t("admin.engine.activateNow")}
            onChange={(next) => setForm({ ...form, activate: next })} />
          <button type="button" disabled={busy} onClick={add}
            className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            <Plus size={13} aria-hidden />{t("admin.engine.addVersion")}
          </button>
        </div>
      </section>
      <div className="space-y-2">
        {versions.map((v) => (
          <section key={v.id} className={cn("panel flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl p-4",
            v.active && "ring-1 ring-[rgb(var(--accent)/0.4)]")}>
            <span className="font-display text-[14px] font-semibold">{v.version}</span>
            {v.active && (
              <span className="rounded-full bg-[rgb(var(--accent)/0.12)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-accent">
                {t("admin.engine.active")}
              </span>
            )}
            <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">{v.changelog}</span>
            <span className="text-[11px] tabular-nums text-faint">{new Date(v.createdAt).toLocaleDateString(locale)}</span>
            {!v.active && (
              <button type="button" disabled={busy} onClick={async () => {
                setBusy(true);
                const res = await activateEngineVersionAction(v.id);
                setBusy(false);
                if (res.ok) router.refresh(); else toast.error(t("common.error"));
              }}
                className="rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
                {t("admin.engine.activate")}
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
