"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, AlignCenter, Download, History, ImagePlus, Link2, Loader2,
  Maximize, Redo2, Save, Undo2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/surface";
import { BottomSheet } from "@/components/mobile/sheet";
import { EditorCanvas } from "@/components/editor/canvas";
import { HistoryList } from "@/components/editor/history";
import {
  SECTIONS, SectionBody, SectionShell, type CutoutState, type PatchFn,
} from "@/components/editor/panels";
import {
  EDITOR_DEFAULTS, ENTRY_SECTION, applyPatch, pushHistory,
  type EditorEntry, type EditorSection, type EditorState, type HistoryEntry,
} from "@/lib/images/editor-state";
import { DEFAULT_SETTINGS, MAX_UPLOAD_BYTES } from "@/lib/images/tools";
import { outputName } from "@/lib/images/zip";
import { cn, formatBytes } from "@/lib/utils";

/**
 * IMAGE EDITOR — the toolbox as one screen.
 *
 * Three facts shape everything below:
 *
 *   1. The edit is a STATE, not a stack of bitmaps. Every control patches the
 *      shared model from lib/images/editor-state.ts, so undo costs a few
 *      hundred bytes, history can jump anywhere, and the preview and the
 *      export are provably describing the same edit.
 *   2. The preview is drawn in the browser and is APPROXIMATE; the file the
 *      customer downloads is baked by sharp at full resolution through
 *      /api/tools/run (tool "editor"). `editor.previewNote` says so on screen.
 *   3. Exactly one step costs credits — the cutout — and it is the same paid
 *      remove_bg run the workbench makes, priced from the same catalogue and
 *      charged through the same ledger. Its price is on the button before it
 *      is pressed.
 */

/**
 * A step is named after the SECTION it changed — the six step names the
 * dictionaries carry — so the list reads as a sequence of edits in every
 * language without the state module owning a dictionary of its own.
 */
const STEP_LABEL: Record<EditorSection, string> = {
  background: "editor.h.background",
  shadow: "editor.h.shadow",
  format: "editor.h.format",
  adjust: "editor.h.adjust",
  transform: "editor.h.transform",
};

/** The three the copy promises. A subset of the API's own allowlist. */
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/** Codes we have a sentence for; anything else becomes the generic failure
 *  rather than a raw key on screen. Mirrors the workbench's vocabulary. */
const KNOWN_ERRORS = new Set([
  "insufficient_credits", "no_provider", "needs_transparency", "image_too_large",
  "unsupported_format", "unreadable_image", "background_unavailable",
  "provider_auth_failed", "provider_out_of_credit", "provider_rate_limited",
  "provider_timeout", "provider_unreachable", "network_error", "tool_unavailable",
]);
const errorKey = (error?: string) => (error && KNOWN_ERRORS.has(error) ? error : "processing_failed");

type Working = {
  /** The bytes the server bakes. A cutout replaces this file wholesale. */
  file: File;
  url: string;
  image: HTMLImageElement;
  hasAlpha: boolean;
  /** Bumped whenever the bytes change, so the bake cache cannot go stale. */
  version: number;
};

type Timeline = { entries: HistoryEntry[]; cursor: number };
type Sheet = EditorSection | "history" | null;

export function ImageEditor({ entry, initialImage, available, reason, cutout, balance: initialBalance }: {
  entry: EditorEntry | null;
  /** A photo handed over by the library: a signed URL and its file name. */
  initialImage: { url: string; name: string } | null;
  /** The editor service itself — an operator can switch it off. */
  available: boolean;
  reason: string;
  /** Live availability and price of the one paid step. */
  cutout: { available: boolean; credits: number; reason: string };
  balance: number;
}) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);

  const [working, setWorking] = useState<Working | null>(null);
  const [state, setState] = useState<EditorState>(() => startState(entry));
  const [timeline, setTimeline] = useState<Timeline>(() => startTimeline(entry));
  const [busy, setBusy] = useState<null | "cutout" | "export">(null);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(initialBalance);
  /** The library copy, keyed by the exact bake it came from. */
  const [saved, setSaved] = useState<{ key: string; path: string } | null>(null);
  const [open, setOpen] = useState<EditorSection | null>(entry ? ENTRY_SECTION[entry] : "background");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [zoom, setZoom] = useState(100);
  const [resetKey, setResetKey] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Mirrors for the async paths: a fetch that resolves two seconds later must
  // read the state as it is NOW, not as it was when the closure was made.
  const stateRef = useRef(state);
  const workingRef = useRef<Working | null>(null);
  const balanceRef = useRef(initialBalance);
  const busyRef = useRef(false);
  const version = useRef(0);
  const baked = useRef<{ key: string; blob: Blob } | null>(null);
  const bootstrapped = useRef(false);

  /**
   * Object URLs are the only thing here that leaks. A replaced source is
   * still on screen while the next one decodes, so they are released once,
   * when the editor goes away — never on a state change.
   */
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); urls.current = []; }, []);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { busyRef.current = busy !== null; }, [busy]);

  /* ── history ─────────────────────────────────────────────────────────── */

  const commitState = useCallback((next: EditorState, label: string) => {
    setTimeline((prev) => {
      // Editing after an undo drops the redo tail: the future the customer
      // walked away from is not a future any more.
      const base = prev.entries.slice(0, prev.cursor + 1);
      const entries = pushHistory(base, next, label);
      return entries === base ? prev : { entries, cursor: entries.length - 1 };
    });
  }, []);

  const applyEdit = useCallback<PatchFn>((section, patch, commit) => {
    const next = applyPatch(stateRef.current, section, patch);
    stateRef.current = next;
    setState(next);
    if (commit) commitState(next, STEP_LABEL[section]);
  }, [commitState]);

  /** A slider reports every pixel of the drag but only the RELEASE is a step. */
  const commitSection = useCallback((section: EditorSection) => {
    commitState(stateRef.current, STEP_LABEL[section]);
  }, [commitState]);

  const goTo = useCallback((index: number) => {
    const target = timeline.entries[index];
    if (!target || index === timeline.cursor) return;
    stateRef.current = target.state;
    setState(target.state);
    setTimeline({ entries: timeline.entries, cursor: index });
  }, [timeline]);

  const undo = useCallback(() => goTo(timeline.cursor - 1), [goTo, timeline.cursor]);
  const redo = useCallback(() => goTo(timeline.cursor + 1), [goTo, timeline.cursor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      // Typing a size or a HEX code keeps the browser's own undo — but ONLY
      // where the browser actually has one. A slider has no native undo, and
      // it still holds focus the instant after it was dragged, which is
      // precisely when Ctrl+Z gets pressed; suppressing the shortcut for every
      // focused control made it dead exactly where it was needed most.
      const target = event.target as HTMLElement | null;
      const typing = !!target && (
        target.isContentEditable
        || /^(textarea|select)$/i.test(target.tagName)
        || (target.tagName === "INPUT"
          && !/^(range|checkbox|radio|button|submit|color|file)$/i.test((target as HTMLInputElement).type))
      );
      if (typing) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ── the working image ───────────────────────────────────────────────── */

  const adopt = useCallback(async (file: File, keepEdits: boolean): Promise<Working | null> => {
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    let image: HTMLImageElement;
    try { image = await decode(url); }
    catch { toast.error(t("tools.err.unreadable_image")); return null; }

    version.current += 1;
    const next: Working = { file, url, image, hasAlpha: hasAlpha(image), version: version.current };
    workingRef.current = next;
    setWorking(next);
    baked.current = null;
    setSaved(null);
    if (!keepEdits) {
      // A different photo is a different job: the dials the previous one
      // needed mean nothing here, and neither does its history.
      const fresh = startState(entry);
      stateRef.current = fresh;
      setState(fresh);
      setTimeline(startTimeline(entry));
      setZoom(100);
      setResetKey((k) => k + 1);
    }
    return next;
  }, [entry, t]);

  const pick = useCallback((files: FileList | File[] | null) => {
    const file = Array.from(files ?? [])[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type) || file.size > MAX_UPLOAD_BYTES) {
      toast.error(t("tools.rejected", { n: 1 }));
      return;
    }
    void adopt(file, false);
  }, [adopt, t]);

  /* ── the one paid step ───────────────────────────────────────────────── */

  const runCutout = useCallback(async () => {
    const current = workingRef.current;
    if (!current || busyRef.current) return;
    if (!cutout.available) { toast.error(t(`tools.unavailable.${cutout.reason}`)); return; }
    if (cutout.credits > balanceRef.current) { toast.error(t("tools.err.insufficient_credits")); return; }

    // The guard is set here, not by the render that follows: this is the one
    // action that spends credits, and a double tap must not become two runs.
    busyRef.current = true;
    setBusy("cutout");
    try {
      const form = new FormData();
      form.append("tool", "remove_bg");
      form.append("settings", JSON.stringify({ format: "png" }));
      form.append("file", current.file);
      const res = await fetch("/api/tools/run", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "processing_failed" })) as { error?: string };
        toast.error(t(`tools.err.${errorKey(body.error)}`));
        return;
      }
      const charged = readCredits(res);
      const blob = await res.blob();
      const cut = await adopt(
        new File([blob], withExtension(current.file.name, "png"), { type: blob.type || "image/png" }),
        true,
      );
      if (!cut) return;
      setBalance((value) => Math.max(0, value - charged));
      // The cutout is a new SOURCE rather than a state change, so it is
      // recorded as its own named step and the edits made so far survive it.
      const next = applyPatch(stateRef.current, "background", { mode: "transparent" });
      stateRef.current = next;
      setState(next);
      commitState(next, "editor.h.removedBackground");
    } catch {
      toast.error(t("tools.err.network_error"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [adopt, commitState, cutout.available, cutout.credits, cutout.reason, t]);

  /* ── the export: one bake, reused by all three actions ───────────────── */

  const bake = useCallback(async (): Promise<Blob | null> => {
    const current = workingRef.current;
    if (!current) return null;
    const format = exportFormat(stateRef.current, current.hasAlpha);
    const key = bakeKey(current, stateRef.current);
    // Download → save → copy is three actions on ONE file: the bake is done
    // once and reused until the source or a single dial actually changes.
    if (baked.current?.key === key) return baked.current.blob;

    setBusy("export");
    try {
      const form = new FormData();
      form.append("tool", "editor");
      form.append("settings", JSON.stringify({
        state: stateRef.current, format, quality: DEFAULT_SETTINGS.editor.quality,
      }));
      form.append("file", current.file);
      const res = await fetch("/api/tools/run", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "processing_failed" })) as { error?: string };
        toast.error(t(`tools.err.${errorKey(body.error)}`));
        return null;
      }
      const blob = await res.blob();
      baked.current = { key, blob };
      return blob;
    } catch {
      toast.error(t("tools.err.network_error"));
      return null;
    } finally {
      setBusy(null);
    }
  }, [t]);

  const download = useCallback(async () => {
    const current = workingRef.current;
    const blob = await bake();
    if (!blob || !current) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // A neutral suffix, not a translated one: a file name travels between
    // machines and marketplaces long after the interface language is forgotten.
    link.download = outputName(current.file.name, "grovbase", blob.type, 0);
    link.click();
    // Revoking in the same tick can cancel the download the click just began.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [bake]);

  const saveToLibrary = useCallback(async (): Promise<string | null> => {
    const current = workingRef.current;
    if (!current) return null;
    // A stored file belongs to the EXACT edit that produced it. Once any dial
    // moves, "already saved" would be a claim about a file nobody has — so the
    // saved path is keyed by the bake and a changed edit saves again.
    const key = bakeKey(current, stateRef.current);
    if (saved?.key === key) return saved.path;

    const blob = await bake();
    if (!blob) return null;
    const form = new FormData();
    form.append("tool", "editor");
    form.append("file", new File([blob], current.file.name, { type: blob.type }));
    const res = await fetch("/api/tools/save", { method: "POST", body: form });
    const json = await res.json().catch(() => ({ ok: false })) as { ok?: boolean; path?: string };
    if (!res.ok || !json.ok || !json.path) {
      toast.error(t("tools.saveFailed"));
      return null;
    }
    setSaved({ key, path: json.path });
    toast.success(t("tools.savedLibrary", { n: 1 }));
    return json.path;
  }, [bake, saved, t]);

  const copyUrl = useCallback(async () => {
    // A URL can only point at a file that exists, so this saves first — the
    // same save the button next to it makes, never a second copy.
    const path = await saveToLibrary();
    if (!path) return;
    const supabase = createClient();
    // The same private bucket /api/tools/save wrote to; the link is signed for
    // the caller and expires, so nothing here makes the asset public.
    const { data } = await supabase.storage.from("generation-assets").createSignedUrl(path, 60 * 60 * 24 * 7);
    if (!data?.signedUrl) { toast.error(t("common.error")); return; }
    try {
      await navigator.clipboard.writeText(data.signedUrl);
      toast.success(t("genv3.copiedUrl"));
    } catch {
      toast.error(t("common.error"));
    }
  }, [saveToLibrary, t]);

  /* ── entry from the library ──────────────────────────────────────────── */

  const bootstrap = useCallback(async (source: { url: string; name: string }) => {
    setLoading(true);
    try {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error("unreachable");
      const blob = await res.blob();
      const loaded = await adopt(new File([blob], source.name, { type: blob.type || "image/png" }), false);
      // The caller handed over BOTH the photo and the intent, so the cutout
      // is what they asked for. A later manual upload never auto-charges:
      // that intent is stale and a surprise charge is not a feature.
      if (loaded && entry === "remove-background") await runCutout();
    } catch {
      toast.error(t("tools.err.unreadable_image"));
    } finally {
      setLoading(false);
    }
  }, [adopt, entry, runCutout, t]);

  useEffect(() => {
    if (bootstrapped.current || !initialImage) return;
    bootstrapped.current = true;
    void bootstrap(initialImage);
  }, [bootstrap, initialImage]);

  /* ── render ──────────────────────────────────────────────────────────── */

  if (!available) {
    return (
      <div className="gen-shell-body">
        <Panel className="rounded-2xl p-6 text-center">
          <span aria-hidden className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent2-soft text-accent2">
            <AlertTriangle size={22} />
          </span>
          <p className="font-display text-base font-semibold">{t("tools.unavailableTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            {t(`tools.unavailable.${reason}`)}
          </p>
        </Panel>
      </div>
    );
  }

  const cutoutState: CutoutState = {
    available: cutout.available,
    reason: cutout.reason,
    credits: cutout.credits,
    enough: cutout.credits <= balance,
    busy: busy === "cutout",
    done: working?.hasAlpha ?? false,
    onRun: () => void runCutout(),
  };
  const panelProps = {
    state,
    patch: applyEdit,
    commit: commitSection,
    cutout: cutoutState,
    hasAlpha: working?.hasAlpha ?? false,
  };

  const picker = (
    <input ref={fileInput} type="file" accept={ACCEPTED.join(",")} className="hidden"
      onChange={(event) => { pick(event.target.files); event.target.value = ""; }} />
  );

  if (!working) {
    return (
      <div className="gen-shell-body flex min-w-0 flex-col">
        {picker}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files); }}
          className={cn(
            "flex min-h-[20rem] w-full flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-10 text-center transition-colors",
            dragging
              ? "border-[rgb(var(--accent)/0.7)] bg-accent-soft/40 text-accent"
              : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/40 text-faint hover:border-[rgb(var(--accent)/0.55)] hover:text-accent",
          )}
        >
          {loading ? <Loader2 size={26} className="animate-spin" aria-hidden /> : <ImagePlus size={26} aria-hidden />}
          <span className="font-display text-[15px] font-semibold text-ink">
            {loading ? t("editor.working") : t("editor.drop")}
          </span>
          <span className="text-[12px] text-muted">
            {t("editor.formats")} · {formatBytes(MAX_UPLOAD_BYTES)}
          </span>
          {!loading && (
            <span aria-hidden className="cta mt-3 rounded-xl px-4 py-2.5 text-[13px] font-semibold">
              {t("editor.pick")}
            </span>
          )}
        </button>
      </div>
    );
  }

  const canUndo = timeline.cursor > 0;
  const canRedo = timeline.cursor < timeline.entries.length - 1;
  const exporting = busy === "export";
  /** Is THIS edit the one sitting in the library? Any change makes it false. */
  const storedNow = saved?.key === bakeKey(working, state);

  return (
    <div className={cn(
      // Same viewport-locked shell the generator uses: both columns scroll
      // inside themselves and the desktop page does not scroll at all.
      "gen-shell-body relative grid min-w-0 items-start gap-4 pb-[var(--gen-page-bottom)] [&>*]:min-w-0",
      "lg:grid-cols-[clamp(292px,22vw,340px)_minmax(0,1fr)] lg:items-stretch lg:gap-5 lg:overflow-hidden lg:pb-0",
    )}>
      {picker}

      {/* ── LEFT: the five sections (desktop only; phones use the sheets) ── */}
      <div className="hidden min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
        <Panel className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4">
          {SECTIONS.map((section, index) => (
            <SectionShell key={section} index={index + 1} section={section}
              open={open === section} onToggle={() => setOpen(open === section ? null : section)}>
              <SectionBody section={section} {...panelProps} />
            </SectionShell>
          ))}
        </Panel>
      </div>

      {/* ── RIGHT: toolbar, canvas, exports ─────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0">
        {/* Wrapping is what keeps a 360px phone free of a sideways scroll: the
            zoom group drops to its own line instead of pushing the strip wide. */}
        <div className="panel flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-2xl px-2 py-1.5 sm:gap-x-2 sm:px-2.5">
          <ToolButton icon={AlignCenter} label={t("editor.center")} onClick={() => setResetKey((k) => k + 1)} />
          <ToolButton icon={Maximize} label={t("editor.fit")}
            onClick={() => { setZoom(100); setResetKey((k) => k + 1); }} />
          <span aria-hidden className="hidden h-5 w-px bg-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))] sm:block" />
          <div className="flex min-w-[8rem] flex-1 items-center gap-2">
            <input type="range" min={25} max={400} step={5} value={zoom} aria-label={t("editor.zoom")}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="min-w-[3.5rem] max-w-[13rem] flex-1 accent-[rgb(var(--accent))]" />
            <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-muted">{zoom}%</span>
          </div>
          <ToolButton icon={Undo2} label={t("editor.undo")} onClick={undo} disabled={!canUndo} />
          <ToolButton icon={Redo2} label={t("editor.redo")} onClick={redo} disabled={!canRedo} />
          <ToolButton icon={History} label={t("editor.history")} onClick={() => setSheet("history")} />
        </div>

        <div className="flex h-[min(56vh,28rem)] flex-col lg:h-auto lg:min-h-0 lg:flex-1">
          <EditorCanvas image={working.image} state={state} hasAlpha={working.hasAlpha}
            zoom={zoom} resetKey={resetKey} busy={busy !== null} />
        </div>

        <div className="space-y-2">
          {/* Below lg these three live in the dock, within thumb reach. */}
          <div className="hidden gap-2 lg:flex">
            <Button onClick={() => void download()} disabled={busy !== null}>
              {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
              {t("editor.download")}
            </Button>
            <Button variant="secondary" onClick={() => void saveToLibrary()} disabled={busy !== null || storedNow}>
              <Save size={15} aria-hidden />
              {storedNow ? t("tools.allSaved") : t("editor.saveLibrary")}
            </Button>
            <Button variant="ghost" onClick={() => void copyUrl()} disabled={busy !== null}>
              <Link2 size={15} aria-hidden />
              {t("editor.copyUrl")}
            </Button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-faint">{t("editor.previewNote")}</p>
        </div>
      </div>

      {/* ── PHONES: the canvas stays visible, the tools come up as sheets ── */}
      <div className="fixed inset-x-0 z-30 px-[var(--page-x)] lg:hidden"
        style={{ bottom: "calc(var(--dock-h) + env(safe-area-inset-bottom))" }}>
        <div className="dock mx-auto w-full max-w-[var(--content-max)] rounded-2xl p-2 shadow-e4">
          <div className="thin-scroll -mx-1 mb-1.5 flex items-stretch gap-1.5 overflow-x-auto px-1 pb-1">
            {SECTIONS.map((section, index) => (
              <button key={section} type="button" onClick={() => setSheet(section)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-2.5 py-1.5 text-left transition-colors hover:bg-raised">
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft text-[10px] font-bold tabular-nums text-accent">
                  {index + 1}
                </span>
                <span className="truncate text-[12px] font-semibold">{t(`editor.s.${section}`)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-stretch gap-1.5">
            <button type="button" onClick={() => void download()} disabled={busy !== null}
              className={cn("cta flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
                busy !== null && "cursor-not-allowed opacity-55")}>
              {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
              {t("editor.download")}
            </button>
            <button type="button" onClick={() => void saveToLibrary()} disabled={busy !== null || storedNow}
              aria-label={t("editor.saveLibrary")}
              className="plate flex min-h-[2.75rem] w-11 items-center justify-center rounded-xl text-ink disabled:opacity-50">
              <Save size={16} aria-hidden />
            </button>
            <button type="button" onClick={() => void copyUrl()} disabled={busy !== null}
              aria-label={t("editor.copyUrl")}
              className="plate flex min-h-[2.75rem] w-11 items-center justify-center rounded-xl text-ink disabled:opacity-50">
              <Link2 size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <BottomSheet
        open={sheet !== null && sheet !== "history"}
        onClose={() => setSheet(null)}
        title={sheet && sheet !== "history" ? t(`editor.s.${sheet}`) : ""}
      >
        {sheet && sheet !== "history" && (
          <div className="space-y-4 px-1 pb-2">
            <SectionBody section={sheet} {...panelProps} />
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "history"} onClose={() => setSheet(null)} title={t("editor.history")}>
        <HistoryList entries={timeline.entries} cursor={timeline.cursor}
          onRestore={(index) => { goTo(index); setSheet(null); }} />
      </BottomSheet>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function ToolButton({ icon: Icon, label, onClick, disabled }: {
  icon: typeof Undo2; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-35">
      <Icon size={16} aria-hidden />
    </button>
  );
}

/** The entry link may pre-select a look; the untouched photo stays step zero. */
function startState(entry: EditorEntry | null): EditorState {
  return entry === "white-background"
    ? applyPatch(EDITOR_DEFAULTS, "background", { mode: "color", color: "#FFFFFF" })
    : EDITOR_DEFAULTS;
}

function startTimeline(entry: EditorEntry | null): Timeline {
  const original: HistoryEntry = { id: "original", label: "editor.original", state: EDITOR_DEFAULTS };
  const first = startState(entry);
  if (first === EDITOR_DEFAULTS) return { entries: [original], cursor: 0 };
  const entries = pushHistory([original], first, STEP_LABEL.background);
  return { entries, cursor: entries.length - 1 };
}

/** One identity for one exported file: the source bytes, the container and
 *  every dial. Two actions that produce the same key produce the same file. */
function bakeKey(working: Working, state: EditorState): string {
  return `${working.version}|${exportFormat(state, working.hasAlpha)}|${JSON.stringify(state)}`;
}

/** PNG only where transparency has to survive; JPEG otherwise, because a
 *  flattened photo has no reason to cost three times the bytes. */
function exportFormat(state: EditorState, alpha: boolean): "png" | "jpeg" {
  const keeps = state.background.mode === "transparent"
    || (state.background.mode === "keep" && alpha);
  return keeps ? "png" : "jpeg";
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable_image"));
    image.src = url;
  });
}

/**
 * Does this photo carry a real cutout? The file extension is not an answer —
 * a PNG is usually opaque — and the shadow step genuinely needs to know,
 * because sharp refuses to invent a silhouette that was never photographed.
 * One downscaled read of the alpha channel settles it; the source is always a
 * blob URL, so the canvas is never tainted.
 */
function hasAlpha(image: HTMLImageElement): boolean {
  const width = Math.max(1, Math.min(160, image.naturalWidth));
  const height = Math.max(1, Math.round((image.naturalHeight / Math.max(1, image.naturalWidth)) * width));
  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(image, 0, 0, width, height);
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** What the run actually charged — the header the tools API already sends. */
function readCredits(response: Response): number {
  try {
    const raw = response.headers.get("X-Tool-Meta");
    if (!raw) return 0;
    const meta = JSON.parse(atob(raw)) as { credits?: number };
    return typeof meta.credits === "number" ? meta.credits : 0;
  } catch {
    return 0;
  }
}

function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.${extension}`;
}
