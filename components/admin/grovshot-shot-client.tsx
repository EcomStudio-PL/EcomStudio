"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import {
  activateKbAction, deleteTestProductAction, importKbAction, readKbVersionAction, saveShotSettingsAction, saveTestProductAction,
} from "@/app/actions/grovshot-shot";
import { diffKb, parseKb, type KbDiff, type KbIssue, type KbParsed } from "@/lib/grovshot-shot/kb";
import { SHOT_STEPS, type ShotSettings } from "@/lib/grovshot-shot/settings";
import { CLAUDE_STAGE_MODELS } from "@/lib/grovshot-v2/config";
import { ANTHROPIC_EFFORTS } from "@/lib/ai/anthropic-options";
import type { KbEventRow, KbVersionRow, ShotRunView, TestProduct } from "@/lib/server/grovshot-shot/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

/**
 * GROVBASE SHOT → Baza wiedzy / Testy — the admin's interactive pieces.
 * The knowledge file is checked in the browser for the PREVIEW and the
 * comparison only; the server parses it again before anything is saved.
 */

type T = (key: string, values?: Record<string, string | number>) => string;
const usd = (m: number | null | undefined) => (m === null || m === undefined ? "—" : `$${(m / 1_000_000).toFixed(4)}`);
const issueText = (t: T, i: KbIssue) => `${t(`gss.issue.${i.code}`)}${i.detail ? ` – ${i.detail}` : ""}`;
const pre = "whitespace-pre-wrap break-words rounded-lg bg-raised p-3 text-xs leading-relaxed";

/* ══ Baza wiedzy ══════════════════════════════════════════════════════════*/

export function ShotKbPanel({ versions, events, active }: {
  versions: KbVersionRow[]; events: KbEventRow[]; active: { id: string; version: number; kb: KbParsed } | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [original, setOriginal] = useState<{ name: string; content: string } | null>(null);
  const [note, setNote] = useState("");
  const [view, setView] = useState<{ version: number; kb: KbParsed } | null>(null);
  const [compare, setCompare] = useState<{ version: number; diff: KbDiff } | null>(null);
  const [activateNote, setActivateNote] = useState("");
  const parsed = useMemo(() => (file ? parseKb(file.content) : null), [file]);
  const diff = useMemo(() => (parsed?.kb ? diffKb(active?.kb ?? null, parsed.kb) : null), [parsed, active]);

  async function read(list: FileList | null, set: (f: { name: string; content: string } | null) => void) {
    const f = list?.[0];
    if (!f) return;
    if (!/\.(md|markdown)$/i.test(f.name)) { toast.error(t("gss.kb.notMd")); return; }
    set({ name: f.name, content: await f.text() });
  }
  function save() {
    if (!file) return;
    start(async () => {
      const r = await importKbAction({ fileName: file.name, content: file.content, note, original: original ? { fileName: original.name, content: original.content } : null });
      if (!r.ok) { toast.error(r.errors?.length ? r.errors.map((e) => issueText(t, e)).join("; ") : t(`gss.err.${r.error}`)); return; }
      toast.success(r.duplicate ? t("gss.kb.duplicate", { v: r.version }) : t("gss.kb.saved", { v: r.version }));
      setFile(null); setOriginal(null); setNote("");
      router.refresh();
    });
  }
  function activate(v: KbVersionRow) {
    start(async () => {
      const r = await activateKbAction(v.id, activateNote);
      if (!r.ok) { toast.error(t(`gss.err.${r.error}`)); return; }
      toast.success(t(`gss.kb.action.${r.action}`, { v: r.version }));
      setActivateNote("");
      router.refresh();
    });
  }
  function load(v: KbVersionRow, mode: "view" | "compare") {
    start(async () => {
      const r = await readKbVersionAction(v.id);
      if (!r.ok) { toast.error(t(`gss.err.${r.error}`)); return; }
      if (mode === "view") { setView({ version: r.version, kb: r.kb }); setCompare(null); }
      else { setCompare({ version: r.version, diff: diffKb(active?.kb ?? null, r.kb) }); setView(null); }
    });
  }

  return (
    <div className="space-y-6" data-gss-kb>
      <section className="space-y-3" data-gss-kb-import>
        <h3 className="text-sm font-semibold">{t("gss.kb.importTitle")}</h3>
        <p className="text-xs text-muted">{t("gss.kb.importHelp")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-3 text-xs text-muted"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void read(e.dataTransfer.files, setFile); }}>
            <Upload size={16} aria-hidden />
            <span>{file ? file.name : t("gss.kb.dropFile")}</span>
            <input type="file" accept=".md,.markdown,text/markdown" className="sr-only" onChange={(e) => void read(e.target.files, setFile)} />
          </label>
          <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-3 text-xs text-muted">
            <Upload size={16} aria-hidden />
            <span>{original ? original.name : t("gss.kb.dropOriginal")}</span>
            <input type="file" accept=".md,.markdown,text/markdown" className="sr-only" onChange={(e) => void read(e.target.files, setOriginal)} />
          </label>
        </div>
        <div>
          <Label htmlFor="gss-note">{t("gss.kb.note")}</Label>
          <Textarea id="gss-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={t("gss.kb.notePh")} />
        </div>
        {parsed && (
          <div className="space-y-3" data-gss-kb-check={parsed.ok ? "ok" : "error"}>
            {!parsed.ok && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-danger">{parsed.errors.map((e, i) => <li key={i}>{issueText(t, e)}</li>)}</ul>
            )}
            {parsed.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-warning">{parsed.warnings.map((e, i) => <li key={i}>{issueText(t, e)}</li>)}</ul>
            )}
            {parsed.ok && diff && (
              <>
                <p className="text-xs text-muted">{t("gss.kb.parsedSummary", { r: parsed.kb.recipes.length, f: parsed.kb.special.length, s: parsed.kb.footers.length, p: parsed.kb.planRules.length })}</p>
                <DiffView diff={diff} against={active?.version ?? null} t={t} />
                <KbPreview kb={parsed.kb} t={t} />
              </>
            )}
            <Button onClick={save} disabled={pending || !parsed.ok || note.trim().length < 3}>
              {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t("gss.kb.saveDraft")}
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3" data-gss-kb-versions>
        <h3 className="text-sm font-semibold">{t("gss.kb.versions")}</h3>
        {versions.length === 0 ? <p className="text-xs text-muted">{t("gss.kb.noVersions")}</p> : (
          <div className="space-y-2">
            <Label htmlFor="gss-act-note">{t("gss.kb.activateNote")}</Label>
            <Input id="gss-act-note" value={activateNote} maxLength={2000} onChange={(e) => setActivateNote(e.target.value)} />
            {versions.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs" data-gss-version={v.version} data-status={v.status}>
                <span className="font-semibold">v{v.version}</span>
                <Badge tone={v.status === "active" ? "success" : v.status === "draft" ? "info" : "neutral"} dot>{t(`gss.kb.status.${v.status}`)}</Badge>
                <span className="text-muted">{formatDate(v.createdAt, locale)} · {v.author ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate" title={v.note ?? ""}>{v.note}</span>
                <code className="text-[10px] text-muted">{v.sha256.slice(0, 10)}</code>
                <Button size="sm" variant="ghost" onClick={() => load(v, "view")} disabled={pending}>{t("gss.kb.preview")}</Button>
                {active && !v.active && <Button size="sm" variant="ghost" onClick={() => load(v, "compare")} disabled={pending}>{t("gss.kb.compare")}</Button>}
                {!v.active && (
                  <Button size="sm" variant="secondary" onClick={() => activate(v)} disabled={pending}>
                    {active && v.version < active.version ? t("gss.kb.rollback") : t("gss.kb.activate")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {view && <div className="space-y-2"><p className="text-xs font-semibold">{t("gss.kb.previewOf", { v: view.version })}</p><KbPreview kb={view.kb} t={t} /></div>}
        {compare && <DiffView diff={compare.diff} against={active?.version ?? null} t={t} title={t("gss.kb.compareOf", { v: compare.version })} />}
      </section>

      <section className="space-y-2" data-gss-kb-history>
        <h3 className="text-sm font-semibold">{t("gss.kb.history")}</h3>
        {events.length === 0 ? <p className="text-xs text-muted">—</p> : (
          <ul className="space-y-1 text-xs">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-muted">{formatDate(e.at, locale)}</span> · {t(`gss.kb.event.${e.action}`, { v: e.version ?? "?", from: e.fromVersion ?? "—" })}
                {e.actor ? ` · ${e.actor}` : ""}{e.note ? ` – ${e.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KbPreview({ kb, t }: { kb: KbParsed; t: T }) {
  return (
    <div className="space-y-3 text-xs" data-gss-kb-preview>
      <details open>
        <summary className="cursor-pointer font-semibold">{t("gss.kb.recipes", { n: kb.recipes.length })}</summary>
        <div className="mt-2 space-y-2">
          {kb.recipes.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2">
              <p className="font-semibold">{r.name} <code className="text-muted">{r.id}</code> {r.derived && <Badge tone="warning">{t("gss.kb.derived")}</Badge>}</p>
              <p className="text-muted">{r.categories.join(", ")}{r.testedOn ? ` · ${t("gss.kb.testedOn")}: ${r.testedOn}` : ""}</p>
              {r.derivedNote && <p className="text-warning">{r.derivedNote}</p>}
              <p className="mt-1 font-semibold">KIERUNEK</p>
              <p className={pre}>{r.direction}</p>
              {r.rules && <details><summary className="cursor-pointer text-muted">{t("gss.kb.rules")}</summary><p className={pre}>{r.rules}</p></details>}
            </div>
          ))}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">{t("gss.kb.special", { n: kb.special.length })}</summary>
        <div className="mt-2 space-y-2">
          {kb.special.map((s) => (
            <div key={s.flag} className="rounded-lg border border-border p-2">
              <p className="font-semibold"><code>{s.flag}</code> – {s.title} {s.derived && <Badge tone="warning">{t("gss.kb.derived")}</Badge>}</p>
              {s.block ? <p className={pre}>{s.block}</p> : <p className="text-muted">{t("gss.kb.rulesOnly")}</p>}
              {s.rules && <details><summary className="cursor-pointer text-muted">{t("gss.kb.rules")}</summary><p className={pre}>{s.rules}</p></details>}
            </div>
          ))}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">{t("gss.kb.footers", { n: kb.footers.length })}</summary>
        <ul className="mt-2 space-y-1">
          {kb.footers.map((f) => (
            <li key={f.key}><code>{f.key}</code> <span className="text-muted">{JSON.stringify(f.when)}</span><p className={pre}>{f.text}</p></li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">{t("gss.kb.negative", { n: kb.negativeItems.length })}</summary>
        <p className={pre}>{kb.negativeBase}</p>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">{t("gss.kb.planRules", { n: kb.planRules.length })}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{kb.planRules.map((r, i) => <li key={i}>{r.group ? <span className="text-muted">[{r.group}] </span> : null}{r.text}</li>)}</ul>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">{t("gss.kb.sections", { n: kb.sections.length })}</summary>
        <ul className="mt-2 space-y-1">{kb.sections.map((s) => <li key={s.title}>{s.title} <span className="text-muted">({s.stages.join(", ")} · {s.text.length})</span></li>)}</ul>
      </details>
    </div>
  );
}

function DiffView({ diff, against, t, title }: { diff: KbDiff; against: number | null; t: T; title?: string }) {
  const item = (label: string, xs: string[]) => (xs.length ? <li><span className="font-semibold">{label}:</span> {xs.join(", ")}</li> : null);
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-xs" data-gss-kb-diff={diff.total}>
      <p className="font-semibold">{title ?? (against ? t("gss.kb.diffAgainst", { v: against }) : t("gss.kb.diffFirst"))} · {t("gss.kb.changes", { n: diff.total })}</p>
      <ul className="space-y-1">
        {item(t("gss.diff.recipesAdded"), diff.recipes.added.map((r) => r.id))}
        {item(t("gss.diff.recipesRemoved"), diff.recipes.removed.map((r) => r.id))}
        {item(t("gss.diff.flagsAdded"), diff.special.added.map((s) => s.flag))}
        {item(t("gss.diff.flagsRemoved"), diff.special.removed.map((s) => s.flag))}
        {item(t("gss.diff.footersAdded"), diff.footers.added.map((f) => f.key))}
        {item(t("gss.diff.footersRemoved"), diff.footers.removed.map((f) => f.key))}
        {item(t("gss.diff.sectionsAdded"), diff.sections.added)}
        {item(t("gss.diff.sectionsRemoved"), diff.sections.removed)}
        {item(t("gss.diff.directionsAdded"), diff.directions.added)}
        {item(t("gss.diff.directionsRemoved"), diff.directions.removed)}
      </ul>
      {[...diff.recipes.modified.map((m) => ({ k: `${t("gss.diff.recipe")} ${m.id}`, c: m.changes })),
        ...diff.special.modified.map((m) => ({ k: `${t("gss.diff.flag")} ${m.flag}`, c: m.changes })),
        ...diff.footers.modified.map((m) => ({ k: `${t("gss.diff.footer")} ${m.key}`, c: m.changes }))].map((m) => (
        <details key={m.k}>
          <summary className="cursor-pointer">{t("gss.diff.modified")}: {m.k} ({m.c.map((c) => c.field).join(", ")})</summary>
          {m.c.map((c) => (
            <div key={c.field} className="mt-1 grid gap-1 sm:grid-cols-2">
              <p className={`${pre} line-through opacity-70`}>{c.before || "—"}</p><p className={pre}>{c.after || "—"}</p>
            </div>
          ))}
        </details>
      ))}
      {(diff.planRules.added.length + diff.planRules.removed.length + diff.planRules.modified.length) > 0 && (
        <details>
          <summary className="cursor-pointer">{t("gss.diff.rules", { a: diff.planRules.added.length, r: diff.planRules.removed.length, m: diff.planRules.modified.length })}</summary>
          <ul className="mt-1 space-y-1">
            {diff.planRules.added.map((r, i) => <li key={`a${i}`} className="text-success">+ {r.text}</li>)}
            {diff.planRules.removed.map((r, i) => <li key={`r${i}`} className="text-danger">− {r.text}</li>)}
            {diff.planRules.modified.map((r, i) => <li key={`m${i}`}>~ <span className="line-through opacity-70">{r.before}</span> → {r.after}</li>)}
          </ul>
        </details>
      )}
      {diff.sections.modified.map((s) => (
        <details key={s.title}><summary className="cursor-pointer">{t("gss.diff.section")}: {s.title}</summary>
          <div className="mt-1 grid gap-1 sm:grid-cols-2"><p className={`${pre} line-through opacity-70`}>{s.before}</p><p className={pre}>{s.after}</p></div>
        </details>
      ))}
      {diff.negative && (
        <p>{t("gss.diff.negative")}: +[{diff.negative.added.join(", ")}] −[{diff.negative.removed.join(", ")}]</p>
      )}
    </div>
  );
}

/* ══ Testy ════════════════════════════════════════════════════════════════*/

type Reply = { ok: boolean; error?: string; runId?: string; run?: ShotRunView; runs?: ShotRunView[] };
async function api(init?: { body: unknown } | { run: string } | { list: true }): Promise<Reply> {
  try {
    const res = init && "run" in init ? await fetch(`/api/admin/grovshot-shot/test?run=${encodeURIComponent(init.run)}`, { cache: "no-store" })
      : init && "list" in init ? await fetch("/api/admin/grovshot-shot/test?list=1", { cache: "no-store" })
        : await fetch("/api/admin/grovshot-shot/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init?.body ?? {}) });
    return (await res.json()) as Reply;
  } catch {
    return { ok: false, error: "generic" };
  }
}

type PlanRow = { numer: number; typ: string; referencje: string; opis: string };

export function ShotTestsPanel({ settings, settingsErrors, model, versions, testProducts, workspaceId, queue }: {
  settings: ShotSettings; settingsErrors: string[]; model: { ratios: string[]; resolutions: string[]; pricing: Record<string, number> } | null;
  versions: KbVersionRow[]; testProducts: TestProduct[]; workspaceId: string | null;
  queue: { slots: Record<string, number>; open: Record<string, unknown>[] } | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState<ShotSettings>(settings);
  const ratios = model?.ratios ?? [];
  const resolutions = model?.resolutions ?? [];
  const [photos, setPhotos] = useState<{ path: string; url: string | null }[]>([]);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [shots, setShots] = useState(3);
  const [ratio, setRatio] = useState(ratios.includes("4:5") ? "4:5" : ratios[0] ?? "");
  const [resolution, setResolution] = useState(resolutions.includes("2K") ? "2K" : resolutions[0] ?? "");
  const [kbVersionId, setKbVersionId] = useState(versions.find((v) => v.active)?.id ?? versions[0]?.id ?? "");
  const [mode, setMode] = useState<"prompts" | "full">("prompts");
  const [confirmed, setConfirmed] = useState(false);
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [productTitle, setProductTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ShotRunView | null>(null);
  const [recent, setRecent] = useState<ShotRunView[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folder = useRef(`gss-test-input/${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => { void api({ list: true }).then((r) => { if (r.ok && r.runs) setRecent(r.runs); }); }, [run?.status]);
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      const res = await api({ run: runId });
      if (stop) return;
      if (res.ok && res.run) {
        setRun(res.run);
        if (res.run.status === "queued" || res.run.status === "running") timer.current = setTimeout(tick, 4000);
      } else timer.current = setTimeout(tick, 8000);
    };
    void tick();
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [runId]);

  async function upload(files: FileList | null) {
    if (!files?.length || !workspaceId) return;
    setUploading(true);
    try {
      const supabase = createClient();
      for (const file of Array.from(files).slice(0, 10 - photos.length)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) { toast.error(t("gss.test.badType")); continue; }
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${workspaceId}/${folder.current}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("common.error")); continue; }
        setPhotos((p) => [...p, { path, url: URL.createObjectURL(file) }]);
      }
    } finally { setUploading(false); }
  }
  function useProduct(p: TestProduct) {
    setPhotos(p.photos); setDescription(p.description); setNotes(p.notes); setProductId(p.id); setProductTitle(p.title);
  }
  function saveProduct() {
    start(async () => {
      const r = await saveTestProductAction({ id: productId, title: productTitle, photos: photos.map((p) => p.path), description, notes });
      if (!r.ok) { toast.error(t(`gss.err.${r.error}`)); return; }
      setProductId(r.id); toast.success(t("gss.test.productSaved")); router.refresh();
    });
  }
  function removeProduct(id: string) {
    start(async () => {
      const r = await deleteTestProductAction(id);
      if (!r.ok) { toast.error(t(`gss.err.${r.error}`)); return; }
      if (productId === id) setProductId(null);
      router.refresh();
    });
  }
  function saveSettings() {
    start(async () => {
      const r = await saveShotSettingsAction(s);
      if (!r.ok) { toast.error(t("gss.err.settings", { e: r.error })); return; }
      toast.success(t("gss.settings.saved")); router.refresh();
    });
  }
  function startTest() {
    start(async () => {
      const userPlan = plan.filter((p) => p.opis.trim() || p.referencje.trim() || p.typ).map((p) => ({
        numer: p.numer, ...(p.typ ? { typ: p.typ } : {}), ...(p.opis.trim() ? { opis: p.opis.trim() } : {}),
        ...(p.referencje.trim() ? { referencje: p.referencje.split(/[\s,;]+/).filter(Boolean) } : {}),
      }));
      const res = await api({ body: {
        photos: photos.map((p) => p.path), description, notes, shots, aspectRatio: ratio, resolution, kbVersionId, mode,
        confirmed: mode === "full" && confirmed, userPlan, testProductId: productId,
      } });
      if (res.ok && res.runId) { setRun(null); setRunId(res.runId); return; }
      toast.error(t(`gss.err.${res.error ?? "generic"}`));
    });
  }
  const unitCredits = model?.pricing?.[resolution] ?? null;
  const active = run ? run.status === "queued" || run.status === "running" : Boolean(runId);

  return (
    <div className="space-y-6" data-gss-tests>
      <section className="space-y-3" data-gss-settings>
        <h3 className="text-sm font-semibold">{t("gss.settings.title")}</h3>
        {settingsErrors.length > 0 && <p className="text-xs text-danger">{t("gss.settings.invalid", { e: settingsErrors.join(", ") })}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {SHOT_STEPS.map((step) => (
            <div key={step} className="space-y-1">
              <Label htmlFor={`gss-m-${step}`}>{t(`gss.step.${step}`)}</Label>
              <Select id={`gss-m-${step}`} value={s.models[step].model} onChange={(e) => setS({ ...s, models: { ...s.models, [step]: { ...s.models[step], model: e.target.value } } })}>
                {CLAUDE_STAGE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Select aria-label={t("gss.settings.effort")} value={s.models[step].effort ?? ""} onChange={(e) => setS({ ...s, models: { ...s.models, [step]: { ...s.models[step], effort: (e.target.value || undefined) as never } } })}>
                <option value="">{t("gss.settings.effortDefault")}</option>
                {ANTHROPIC_EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><Label htmlFor="gss-tc">{t("gss.settings.textConcurrency")}</Label>
            <Input id="gss-tc" type="number" min={1} max={20} value={s.limits.text_concurrency} onChange={(e) => setS({ ...s, limits: { ...s.limits, text_concurrency: Number(e.target.value) } })} /></div>
          <div><Label htmlFor="gss-ic">{t("gss.settings.imageConcurrency")}</Label>
            <Input id="gss-ic" type="number" min={1} max={20} value={s.limits.image_concurrency} onChange={(e) => setS({ ...s, limits: { ...s.limits, image_concurrency: Number(e.target.value) } })} /></div>
          <div><Label htmlFor="gss-tb">{t("gss.settings.textBudget")}</Label>
            <Input id="gss-tb" type="number" step="0.1" min={0.1} max={20} value={s.text_budget_usd} onChange={(e) => setS({ ...s, text_budget_usd: Number(e.target.value) })} /></div>
          <div><Label htmlFor="gss-dm">{t("gss.settings.descMin")}</Label>
            <Input id="gss-dm" type="number" min={0} max={5000} value={s.description_min_chars} onChange={(e) => setS({ ...s, description_min_chars: Number(e.target.value) })} /></div>
          <div><Label htmlFor="gss-pv">{t("gss.settings.promptVariant")}</Label>
            <Select id="gss-pv" value={s.prompt.variant} onChange={(e) => setS({ ...s, prompt: { ...s.prompt, variant: e.target.value as ShotSettings["prompt"]["variant"] } })}>
              <option value="a">{t("gss.settings.promptVariantA")}</option>
              <option value="b_admin">{t("gss.settings.promptVariantBAdmin")}</option>
              <option value="b">{t("gss.settings.promptVariantB")}</option>
            </Select></div>
        </div>
        <p className="text-xs text-muted">{t("gss.settings.help")}</p>
        <Button size="sm" onClick={saveSettings} disabled={pending}>{t("gss.settings.save")}</Button>
      </section>

      <section className="space-y-2" data-gss-queue>
        <h3 className="text-sm font-semibold">{t("gss.queue.title")}</h3>
        <p className="text-xs text-muted">{t("gss.queue.slots", { text: queue?.slots?.text ?? 0, tl: s.limits.text_concurrency, image: queue?.slots?.image ?? 0, il: s.limits.image_concurrency, open: queue?.open?.length ?? 0 })}</p>
        <Button size="sm" variant="ghost" onClick={() => router.refresh()}>{t("gss.queue.refresh")}</Button>
      </section>

      <section className="space-y-3" data-gss-products>
        <h3 className="text-sm font-semibold">{t("gss.test.products", { n: testProducts.length })}</h3>
        <div className="flex flex-wrap gap-2">
          {testProducts.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs">
              <button type="button" className="font-semibold hover:underline" onClick={() => useProduct(p)}>{p.title} ({p.photos.length})</button>
              <button type="button" aria-label={t("gss.test.removeProduct")} onClick={() => removeProduct(p.id)}><X size={12} aria-hidden /></button>
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-3" data-gss-test-form>
        <h3 className="text-sm font-semibold">{t("gss.test.title")}</h3>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">{t("gss.test.photos")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((p, i) => (
              <span key={p.path} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url ? <img src={p.url} alt="" className="size-16 rounded-lg object-cover ring-1 ring-line" /> : <span className="flex size-16 items-center justify-center rounded-lg bg-raised text-[10px]">Z{i + 1}</span>}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">Z{i + 1}</span>
                <button type="button" className="absolute right-1 top-1 rounded bg-black/60 text-white" aria-label={t("gss.test.removePhoto")} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}><X size={10} aria-hidden /></button>
              </span>
            ))}
            {photos.length < 10 && (
              <label className="inline-flex h-16 min-w-16 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-xs text-muted">
                {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}{t("gss.test.add")}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} />
              </label>
            )}
          </div>
        </div>
        <div><Label htmlFor="gss-desc">{t("gss.test.description")}</Label>
          <Textarea id="gss-desc" rows={5} value={description} maxLength={20_000} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><Label htmlFor="gss-notes">{t("gss.test.notes")}</Label>
          <Input id="gss-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1"><Label htmlFor="gss-pt">{t("gss.test.productTitle")}</Label>
            <Input id="gss-pt" value={productTitle} maxLength={200} onChange={(e) => setProductTitle(e.target.value)} /></div>
          <Button size="sm" variant="secondary" onClick={saveProduct} disabled={pending || !productTitle.trim() || photos.length === 0}>{productId ? t("gss.test.updateProduct") : t("gss.test.saveProduct")}</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><Label htmlFor="gss-shots">{t("gss.test.shots")}</Label>
            <Select id="gss-shots" value={String(shots)} onChange={(e) => { setShots(Number(e.target.value)); setConfirmed(false); }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </Select></div>
          <div><Label htmlFor="gss-ratio">{t("gss.test.ratio")}</Label>
            <Select id="gss-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>{ratios.map((r) => <option key={r} value={r}>{r}</option>)}</Select></div>
          <div><Label htmlFor="gss-res">{t("gss.test.resolution")}</Label>
            <Select id="gss-res" value={resolution} onChange={(e) => { setResolution(e.target.value); setConfirmed(false); }}>{resolutions.map((r) => <option key={r} value={r}>{r}</option>)}</Select></div>
          <div><Label htmlFor="gss-kbv">{t("gss.test.kbVersion")}</Label>
            <Select id="gss-kbv" value={kbVersionId} onChange={(e) => setKbVersionId(e.target.value)}>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} · {t(`gss.kb.status.${v.status}`)}</option>)}
            </Select></div>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-semibold">{t("gss.test.plan", { n: plan.length })}</summary>
          <div className="mt-2 space-y-2">
            {plan.map((row, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[4rem_7rem_8rem_1fr_auto]">
                <Select aria-label={t("gss.test.planNumber")} value={String(row.numer)} onChange={(e) => setPlan(plan.map((r, j) => (j === i ? { ...r, numer: Number(e.target.value) } : r)))}>
                  {Array.from({ length: shots }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
                <Select aria-label={t("gss.test.planType")} value={row.typ} onChange={(e) => setPlan(plan.map((r, j) => (j === i ? { ...r, typ: e.target.value } : r)))}>
                  <option value="">—</option><option value="hero">hero</option><option value="uzycie">użycie</option><option value="detal">detal</option>
                </Select>
                <Input aria-label={t("gss.test.planRefs")} placeholder="Z1, Z3" value={row.referencje} onChange={(e) => setPlan(plan.map((r, j) => (j === i ? { ...r, referencje: e.target.value } : r)))} />
                <Input aria-label={t("gss.test.planScene")} placeholder={t("gss.test.planScene")} value={row.opis} maxLength={600} onChange={(e) => setPlan(plan.map((r, j) => (j === i ? { ...r, opis: e.target.value } : r)))} />
                <Button size="sm" variant="ghost" onClick={() => setPlan(plan.filter((_, j) => j !== i))}><X size={12} aria-hidden /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPlan([...plan, { numer: Math.min(shots, plan.length + 1), typ: "", referencje: "", opis: "" }])}>{t("gss.test.planAdd")}</Button>
          </div>
        </details>
        <div className="space-y-1.5">
          <Label htmlFor="gss-mode">{t("gss.test.mode")}</Label>
          <Select id="gss-mode" value={mode} onChange={(e) => { setMode(e.target.value === "full" ? "full" : "prompts"); setConfirmed(false); }}>
            <option value="prompts">{t("gss.test.modePrompts")}</option>
            <option value="full">{t("gss.test.modeFull")}</option>
          </Select>
          {mode === "full" && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{t("gss.test.confirm", { n: shots, max: shots * 3, res: resolution, credits: unitCredits ?? "—" })}</span>
            </label>
          )}
        </div>
        <Button onClick={startTest} disabled={pending || active || photos.length === 0 || !kbVersionId || (mode === "full" && !confirmed)}>
          {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t("gss.test.start")}
        </Button>
      </section>

      {run && <RunView run={run} t={t} locale={locale} />}

      <section className="space-y-2" data-gss-recent>
        <h3 className="text-sm font-semibold">{t("gss.test.recent")}</h3>
        <ul className="space-y-1 text-xs">
          {recent.map((r) => (
            <li key={r.id}>
              <button type="button" className="hover:underline" onClick={() => { setRun(null); setRunId(r.id); }}>
                {formatDate(r.createdAt, locale)} · {r.kind === "grovshot_test" ? t("gss.test.kindTest") : t("gss.test.kindOrder")} · {t(`gss.status.${r.orderStatus}`)} · v{r.input.kbVersion ?? "?"} · {r.input.shots} · {usd(r.apiCostMicros)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function RunView({ run, t, locale }: { run: ShotRunView; t: T; locale: string }) {
  const steps = ["card", "plan", "product", "scenes", "image"] as const;
  const byStep = (st: string) => run.calls.filter((c) => c.step === st);
  const sum = (xs: { costMicros: number | null }[]) => xs.reduce((a, c) => a + (c.costMicros ?? 0), 0);
  return (
    <section className="space-y-4 rounded-xl border border-border p-4 text-xs" data-gss-run={run.id} data-status={run.orderStatus}>
      <p className="text-sm font-semibold">
        {t("gss.run.title")} <code>{run.id.slice(0, 8)}</code> · <Badge tone={run.orderStatus === "gotowe" ? "success" : run.orderStatus === "nieudane" ? "danger" : run.orderStatus === "czesciowo_gotowe" ? "warning" : "info"} dot>{t(`gss.status.${run.orderStatus}`)}</Badge>
      </p>
      <p className="text-muted">{formatDate(run.createdAt, locale)} · {t("gss.run.meta", { kb: run.input.kbVersion ?? "?", engine: run.input.engineVersion ?? "?", mode: run.input.testMode ?? "—", cost: usd(run.apiCostMicros), unknown: run.costUnknown })}{run.error ? ` · ${t("gss.run.error")}: ${run.error}` : ""}</p>

      <details open><summary className="cursor-pointer font-semibold">1. {t("gss.run.input")}</summary>
        <div className="mt-2 flex flex-wrap gap-2">{run.input.photos.map((p) => (
          <span key={p.n} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.url ? <img src={p.url} alt="" className="size-16 rounded-lg object-cover" /> : null}
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">Z{p.n}</span>
          </span>))}</div>
        <p className="mt-2">{run.input.shots} × {run.input.aspectRatio} · {run.input.resolution}</p>
        <p className={pre}>{run.input.description}</p>
        {run.input.notes && <p className={pre}>{run.input.notes}</p>}
        {run.input.userPlan ? <pre className={pre}>{JSON.stringify(run.input.userPlan, null, 2)}</pre> : null}
      </details>
      <details><summary className="cursor-pointer font-semibold">2. {t("gss.run.card")}{run.card.errors.length ? ` (${run.card.errors.length} ⚠)` : ""}</summary>
        {run.card.errors.length > 0 && <ul className="list-disc pl-5 text-warning">{run.card.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <pre className={pre}>{JSON.stringify(run.card.value, null, 2)}</pre>
      </details>
      <details><summary className="cursor-pointer font-semibold">3. {t("gss.run.plan")}{run.plan.errors.length ? ` (${run.plan.errors.length} ⚠)` : ""}</summary>
        {run.plan.errors.length > 0 && <ul className="list-disc pl-5 text-warning">{run.plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        {run.plan.conflicts ? <pre className={pre}>{JSON.stringify(run.plan.conflicts, null, 2)}</pre> : null}
        <pre className={pre}>{JSON.stringify(run.plan.shots, null, 2)}</pre>
      </details>
      <details><summary className="cursor-pointer font-semibold">4. {t("gss.run.modules")}</summary>
        <pre className={pre}>{JSON.stringify(run.product, null, 2)}</pre>
        <pre className={pre}>{JSON.stringify(run.scenes, null, 2)}</pre>
      </details>
      <details open><summary className="cursor-pointer font-semibold">5. {t("gss.run.prompts", { n: run.prompts.length })}</summary>
        {run.prompts.map((p) => (
          <div key={p.numer} className="mt-2">
            <p className="font-semibold">#{p.numer} · {p.pattern} · {t("gss.run.footer")}: {p.footer} · {t("gss.run.refs")}: {p.references.map((n, i) => `${i + 1}=Z${n}`).join(", ")} · <code>{p.sha256.slice(0, 10)}</code></p>
            <p className={pre}>{p.text}</p>
          </div>
        ))}
      </details>
      <details><summary className="cursor-pointer font-semibold">6. {t("gss.run.calls", { n: run.calls.length })}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead><tr className="text-muted"><th>{t("gss.run.c.step")}</th><th>{t("gss.run.c.model")}</th><th>{t("gss.run.c.tokens")}</th><th>{t("gss.run.c.cache")}</th><th>{t("gss.run.c.ms")}</th><th>{t("gss.run.c.cost")}</th><th>{t("gss.run.c.status")}</th><th>{t("gss.run.c.limits")}</th></tr></thead>
            <tbody>{run.calls.map((c, i) => (
              <tr key={i} className="border-t border-border">
                <td>{c.step}#{c.item}{c.feedback ? " ↻" : ""}</td><td>{c.model}</td><td>{c.inTokens ?? "—"}/{c.outTokens ?? "—"}</td>
                <td>{c.cached ?? 0}/{c.cacheWrite ?? 0}</td><td>{c.ms ?? "—"}</td><td>{c.costBasis === "unknown" ? "UNKNOWN" : usd(c.costMicros)}</td>
                <td>{c.error ?? c.status}</td><td>{c.rateLimits ? Object.entries(c.rateLimits).map(([k, v]) => `${k}:${v}`).join(" ") : ""}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </details>
      <details open><summary className="cursor-pointer font-semibold">7. {t("gss.run.images")}</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">{run.shots.map((sh) => (
          <div key={sh.numer} className="space-y-1">
            <p className="font-semibold">#{sh.numer} · {sh.state ? t(`gss.shot.${sh.state}`) : t("gss.shot.waiting")}{sh.reason ? ` (${sh.reason})` : ""}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {sh.imageUrl ? <a href={sh.imageUrl} target="_blank" rel="noreferrer"><img src={sh.imageUrl} alt="" className="w-full rounded-lg" /></a> : null}
            {sh.rounds.map((r, i) => <p key={i} className="text-muted">{t("gss.run.attempt", { n: i + 1 })}: {String(r.ok ? "ok" : r.error ?? r.error_code ?? r.status)} · {String(r.width ?? "?")}×{String(r.height ?? "?")} · {usd(Number(r.cost_usd_micros) || 0)} · {String(r.ms ?? r.duration_ms ?? "—")} ms</p>)}
          </div>))}</div>
      </details>
      <details><summary className="cursor-pointer font-semibold">8. {t("gss.run.queue")}</summary>
        <pre className={pre}>{JSON.stringify(run.progress, null, 2)}</pre>
      </details>
      <details open><summary className="cursor-pointer font-semibold">9. {t("gss.run.costs")}</summary>
        <ul className="mt-2 space-y-1">{steps.map((st) => {
          const cs = byStep(st);
          return <li key={st}>{t(`gss.run.step.${st}`)}: {cs.length} · {usd(sum(cs))} · {cs.reduce((a, c) => a + (c.ms ?? 0), 0)} ms</li>;
        })}</ul>
      </details>
    </section>
  );
}
