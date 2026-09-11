"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import {
  AlertTriangle, ArrowRight, Download, FileArchive, ImagePlus,
  Link2, Loader2, Maximize2, RotateCcw, Trash2, Unlink,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/input";
import {
  ACCEPTED_MIME, DEFAULT_SETTINGS, MAX_UPLOAD_BYTES,
  type OutputFormatOption, type ToolSettings, type ToolSlug,
} from "@/lib/images/tools";
import { CostIsland, GroupLabel, RadioRows } from "@/components/tools/panel-parts";
import {
  BatchGalleryToolbar, BatchGrid, DEFAULT_BATCH_FILTER, DEFAULT_ZOOM,
  applyBatchFilter, type BatchFilter, type BatchItem,
} from "@/components/tools/batch-gallery";
import { createZip, outputName } from "@/lib/images/zip";
import { cn, formatBytes } from "@/lib/utils";
import { acceptFiles, type IntakeLimits } from "@/lib/images/file-intake";
import { FileDropOverlay, useFileDrop } from "@/components/ui/file-drop";

/**
 * RESIZE — the batch screen.
 *
 * Deliberately separate from the editor: one dial (how big), two hundred
 * photos, no per-photo decisions. Everything under it is the machinery the
 * generic workbench already uses — the same `/api/tools/run` contract, one
 * request per photo, three in flight, the same ZIP writer — pointed at the
 * existing "format" tool instead of a second backend.
 *
 * The engine below is a copy of the workbench's queue rather than a shared
 * import: that queue lives inline inside `components/tools/workbench.tsx` and
 * pulling it out into a hook means editing the file every other tool runs on.
 * Shapes and names are kept identical so the extraction stays mechanical.
 */

/** Resize IS the "format" tool — it already resizes and converts, and it
 *  already has a pricing row in service_catalog. A second slug for the same
 *  sharp call would be a parallel system with its own price. */
const TOOL: ToolSlug = "format";

/** This screen is built for a whole shoot at once, so it queues more than the
 *  generic workbench's hundred. Nothing on the server knows about batches —
 *  it is one request per photo either way — so the cap is only about what the
 *  browser can hold. */
const MAX_FILES = 200;

/** sharp will not emit a side longer than this: `MAX_DIMENSION` in
 *  lib/images/local.ts, re-clamped in parseSettings. That module is
 *  server-only, so the number is mirrored here the way MAX_UPLOAD_BYTES
 *  already is — a bigger target would come back quietly shrunk, and the panel
 *  refuses it instead of promising a size it cannot deliver. */
const MAX_SIDE = 8000;
const MIN_SIDE = 16;

/** Three at a time keeps the phone responsive and the function warm. */
const CONCURRENCY = 3;

/** Previews are re-encoded at this size instead of pointing an <img> at the
 *  original file: two hundred full-resolution decodes is what actually melts
 *  a phone, not two hundred rows. */
const THUMB_SIDE = 256;

const PRESETS = [
  { key: "2k", label: "2K", side: 2048 },
  { key: "4k", label: "4K", side: 4096 },
  // 8K is 8192 px, which is past MAX_SIDE. Shown and disabled: delivering
  // 8000 px under an "8K" label would be a quiet lie about the output.
  { key: "8k", label: "8K", side: 8192 },
] as const;

/** The accept attribute is a hint the file picker may ignore and a drop event
 *  never honours at all, so the extension is checked next to the MIME type.
 *  The route validates both again — this only saves the seller the upload. */
const ACCEPTED_EXT = ["jpg", "jpeg", "png", "webp", "avif"];

/** What this tool takes — one object, used by the picker, the drop and
 *  the validator, so the three can never disagree. */
const RESIZE_LIMITS: IntakeLimits = {
  mime: ACCEPTED_MIME,
  ext: ACCEPTED_EXT,
  maxBytes: MAX_UPLOAD_BYTES,
  maxFiles: MAX_FILES,
};

type ItemStatus = "queued" | "running" | "done" | "error";

type Item = {
  id: string;
  file: File;
  /** Downscaled preview, not the original. Absent until the decode finishes. */
  thumbUrl?: string;
  /** Real pixel size, EXIF orientation already applied. */
  source?: { width: number; height: number };
  status: ItemStatus;
  resultBlob?: Blob;
  after?: { width: number; height: number; bytes: number };
  error?: string;
};

type Target = { width: number | null; height: number | null };

export function ResizeWorkbench({ available, credits, reason, balance }: {
  available: boolean;
  /** Credits per photo, from the service catalogue — never a constant. */
  credits: number;
  reason: string;
  balance: number;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [presetKey, setPresetKey] = useState<string>(PRESETS[0].key);
  const [custom, setCustom] = useState(false);
  const [customWidth, setCustomWidth] = useState("2048");
  const [customHeight, setCustomHeight] = useState("");
  const [lockRatio, setLockRatio] = useState(true);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  /* The workspace's own state: how the queue is shown, not what is done to it.
     Favourites and the selection live here because they belong to this batch —
     both disappear with the tab, which is exactly their lifetime. */
  const [view, setView] = useState<"grid" | "list">("grid");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [filter, setFilter] = useState<BatchFilter>(DEFAULT_BATCH_FILTER);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  /**
   * Object URLs, one per queued photo, released the moment that photo leaves
   * the queue and again when the screen goes away. `live` is the same set of
   * ids read synchronously: two drops in the same tick would both see a stale
   * `items` and overshoot the two-hundred cap.
   */
  const urls = useRef(new Map<string, string>());
  const live = useRef(new Set<string>());

  const track = useCallback((id: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.set(id, url);
    return url;
  }, []);

  const release = useCallback((id: string) => {
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
    live.current.delete(id);
  }, []);

  useEffect(() => () => {
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    live.current.clear();
  }, []);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /** The queue as the shared gallery sees it: a name, a state, a preview. */
  const cards: BatchItem[] = useMemo(() => items.map((i) => ({
    id: i.id, name: i.file.name, thumbUrl: i.thumbUrl, status: i.status,
    bytes: i.file.size, canDownload: i.status === "done",
    errorText: i.status === "error" ? t(`tools.err.${errorKey(i.error)}`) : undefined,
  })), [items, t]);

  const visible = useMemo(
    () => applyBatchFilter(cards, filter, favourites, selected),
    [cards, filter, favourites, selected],
  );
  const selectedDone = useMemo(
    () => items.filter((i) => selected.has(i.id) && i.status === "done"),
    [items, selected],
  );

  const done = items.filter((i) => i.status === "done");
  const failed = items.filter((i) => i.status === "error");
  const pending = items.filter((i) => i.status === "queued");
  const totalCredits = credits * pending.length;
  const notEnough = totalCredits > balance;

  const target = useMemo<Target>(() => {
    if (!custom) {
      const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
      return { width: preset.side, height: preset.side };
    }
    // Locked means "scale by the width and let every photo keep its own
    // proportions": one fixed height across two hundred different photos
    // would either crop or squash most of them.
    return { width: side(customWidth), height: lockRatio ? null : side(customHeight) };
  }, [custom, presetKey, customWidth, customHeight, lockRatio]);

  const hasTarget = target.width !== null || target.height !== null;

  /**
   * WHY THE BUTTON IS OFF — one line, in the card where the decision is made.
   *
   * A disabled CTA with nothing next to it is a dead end: the seller cannot
   * tell whether they forgot the photos, typed a size the encoder refuses, or
   * ran out of credits. Null when there is nothing to explain, so the card
   * stays quiet once everything is ready.
   */
  const status = items.length === 0 ? t("resize.needPhotos")
    : !hasTarget ? t("resize.needSize", { min: MIN_SIDE, max: MAX_SIDE })
      : notEnough ? t("tools.err.insufficient_credits")
        : pending.length === 0 ? t("resize.nothingQueued")
          : null;

  const targetLabel = hasTarget
    ? `≤ ${[target.width, target.height].filter((v): v is number => v !== null).join(" × ")} px`
    : null;

  /* ── queue ───────────────────────────────────────────────────────────── */

  const thumbnails = useCallback(async (queue: Item[]) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        const thumb = await readThumb(item.file);
        // Removed while its decode was still running: drop the result rather
        // than mint an object URL nothing will ever revoke.
        if (!thumb || !live.current.has(item.id)) continue;
        const url = thumb.blob ? track(item.id, thumb.blob) : undefined;
        setItems((prev) => prev.map((i) => (i.id === item.id
          ? { ...i, thumbUrl: url, source: { width: thumb.width, height: thumb.height } }
          : i)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }, [track]);

  const addFiles = useCallback((files: FileList | File[]) => {
    // ONE GATE. The picker and a drop anywhere on the page both land here, so
    // a file the dialog accepts is exactly a file the drop accepts.
    const room = Math.max(0, MAX_FILES - live.current.size);
    const sorted = acceptFiles(files, RESIZE_LIMITS, room);
    const rejected = sorted.badType + sorted.tooLarge;
    if (rejected > 0) toast.error(t("tools.rejected", { n: rejected }));
    if (sorted.overflow > 0) toast.error(t("tools.batchFull", { n: MAX_FILES }));
    if (sorted.accepted.length === 0) return;

    const taken: Item[] = sorted.accepted.map((file, i) => ({
      id: `${file.name}-${file.size}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      file, status: "queued",
    }));

    for (const item of taken) live.current.add(item.id);
    setItems((prev) => [...prev, ...taken]);
    void thumbnails(taken);
  }, [t, thumbnails]);

  /**
   * THE WHOLE PAGE IS THE DROP TARGET.
   *
   * Photos released anywhere over this tool go straight to `addFiles`, which
   * is the same function the file dialog calls — so the validation, the batch
   * ceiling and the error toasts are identical either way. The hook only fires
   * for drags that genuinely carry files, so reordering a thumbnail or
   * dragging a slider never raises the overlay.
   */
  const dragging = useFileDrop({ onFiles: (files) => { if (files) addFiles(files); } });

  function removeItem(id: string) {
    release(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clearAll() {
    for (const id of Array.from(live.current)) release(id);
    setItems([]);
  }

  /* ── run ─────────────────────────────────────────────────────────────── */

  async function runOne(item: Item): Promise<Partial<Item>> {
    const form = new FormData();
    form.append("tool", TOOL);
    form.append("settings", JSON.stringify(settingsFor(item.file, target)));
    form.append("file", item.file);
    // No idempotency key is sent: the route derives one from the tool, the
    // settings and the file bytes itself.

    const res = await fetch("/api/tools/run", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "processing_failed" }));
      return { status: "error", error: String(body.error ?? "processing_failed") };
    }
    const meta = JSON.parse(atob(res.headers.get("X-Tool-Meta") ?? btoa("{}"))) as {
      after?: Item["after"];
    };
    return { status: "done", resultBlob: await res.blob(), after: meta.after, error: undefined };
  }

  async function run(only?: Item[]) {
    if (running || !hasTarget) return;
    const queue = only ?? items.filter((i) => i.status === "queued");
    if (queue.length === 0) return;

    cancelled.current = false;
    setRunning(true);
    setItems((prev) => prev.map((i) => (queue.some((q) => q.id === i.id)
      ? { ...i, status: "running", error: undefined } : i)));

    let cursor = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && !cancelled.current) {
        const index = cursor++;
        if (index >= queue.length) return;
        const item = queue[index];
        let patch: Partial<Item>;
        try { patch = await runOne(item); }
        catch { patch = { status: "error", error: "network_error" }; }
        // A wallet that has run dry fails every remaining photo the same way,
        // so the batch stops instead of raising two hundred toasts.
        if (patch.error === "insufficient_credits") stop = true;
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    if (stop) {
      setItems((prev) => prev.map((i) => (i.status === "running" ? { ...i, status: "queued" } : i)));
      toast.error(t("tools.err.insufficient_credits"));
    }
    setRunning(false);
  }

  /* ── output ──────────────────────────────────────────────────────────── */

  function download(item: Item, index: number) {
    if (!item.resultBlob) return;
    const url = URL.createObjectURL(item.resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputName(item.file.name, t(`tools.${TOOL}.suffix`), item.resultBlob.type, index);
    a.click();
    // Revoking in the same tick can cancel the download the click just began.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** One file goes straight down; several become a ZIP. Used by "pobierz
   *  wszystkie" and by the selection bar, so the two cannot behave differently. */
  async function downloadMany(chosen: Item[]) {
    if (chosen.length === 0) return;
    if (chosen.length === 1) { download(chosen[0], 0); return; }
    const entries = await Promise.all(chosen.map(async (item, index) => ({
      name: outputName(item.file.name, t(`tools.${TOOL}.suffix`), item.resultBlob!.type, index),
      data: new Uint8Array(await item.resultBlob!.arrayBuffer()),
    })));
    const url = URL.createObjectURL(createZip(entries));
    const a = document.createElement("a");
    a.href = url;
    a.download = "grovbase-resize.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const downloadAll = () => downloadMany(done);

  if (!available) {
    return (
      <Panel className="rounded-2xl p-6 text-center">
        <span aria-hidden className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent2-soft text-accent2">
          <AlertTriangle size={22} />
        </span>
        <p className="font-display text-base font-semibold">{t("tools.unavailableTitle")}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {t(`tools.unavailable.${reason}`)}
        </p>
      </Panel>
    );
  }

  return (
    // The action bar floats above the app dock on phones, so the gallery keeps
    // its own room underneath; on desktop the bar returns to the flow.
    <div className={cn(
      // THE ENGINE'S FRAME, not a document. `gen-shell-body` makes this the one
      // growing child of the page shell, so on a desktop the height is whatever
      // the viewport has left under the topbar and each column scrolls inside
      // itself — the same arrangement, and the same column widths, the
      // generator uses. Below `lg` none of it applies and the page scrolls
      // normally, with the island floating above the app dock.
      "gen-shell-body relative grid min-w-0 items-start gap-4 pb-36 [&>*]:min-w-0",
      "lg:grid-cols-[clamp(420px,29vw,470px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )}>
      {/* The tool's whole page is the target — the dashed tile below is a
          convenience, not the only way in. */}
      <FileDropOverlay
        show={dragging}
        fullscreen
        title={t("tools.dropManyTitle")}
        sub={t("tools.dropHint", { n: MAX_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })}
      />
      {/* LEFT COLUMN — a bounded scrolling body and an island that is its
          SIBLING, so the cost and the CTA never scroll away. */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <input ref={inputRef} type="file" multiple accept={ACCEPTED_MIME.join(",")} className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {/* The import box wears its own heading, so the cap is a stated rule
            rather than something discovered on the 201st file. */}
        {/* ONE CARD: what goes in, and how big it comes out. The import tile
            and the resolution rows were two panels with a gap between them,
            which read as two unrelated decisions — they are one. */}
        <Panel className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          <div className="min-w-0">
          <GroupLabel>{t("tools.addPhotos", { n: MAX_FILES })}</GroupLabel>
          {/* THE IMPORT TILE — a word, a count, and the rule underneath.
              It used to lead with "Przeciągnij zdjęcia albo kliknij" over a
              full line of formats, which is a paragraph where a button should
              be. Both ways in still work: this is a real <button> that opens
              the picker, and the whole page is a drop target. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-5 transition-colors",
              dragging
                ? "border-[rgb(var(--accent)/0.7)] bg-accent-soft/30 text-accent"
                : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/60 text-muted hover:border-[rgb(var(--accent)/0.55)] hover:text-accent"
            )}
          >
            <ImagePlus size={20} aria-hidden />
            <span className="text-[13px] font-semibold text-ink">{t("tools.import")}</span>
            <span className="text-[11.5px] font-medium tabular-nums text-muted">
              {items.length} / {MAX_FILES} {t("common.photos")}
            </span>
            {/* The rule stays visible — a file the picker refuses should be
                refused on the card, not discovered in a toast. */}
            <span className="text-center text-[10.5px] leading-tight text-faint">
              {t("tools.dropHint", { n: MAX_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })}
            </span>
          </button>
          </div>

          <div className="min-w-0">
            <GroupLabel>{t("resize.resolution")}</GroupLabel>
            {/* NAMES ONLY. 2K, 4K and 8K are the whole vocabulary a seller
                needs here; "≤ 2048 × 2048 px" under each of them, a pixel
                ceiling on the group label and a sentence of apology under 8K
                turned four controls into six lines of small print.

                8K is still OFF — it is a real 8192 px and sharp stops at
                8000, so offering it would be a quiet lie about the output —
                but it is off the way a disabled control normally is, with the
                reason in `title` for whoever wants it, not as a permanent
                paragraph in the rail. */}
            <RadioRows
              name="resize-resolution"
              value={custom ? null : presetKey}
              onChange={setPresetKey}
              disabled={custom}
              rows={PRESETS.map((p) => ({
                value: p.key,
                label: p.label,
                disabled: p.side > MAX_SIDE,
                title: p.side > MAX_SIDE
                  ? t("resize.overMax", { n: MAX_SIDE })
                  : `≤ ${p.side} × ${p.side} px`,
              }))}
            />
          </div>

          <CheckRow checked={custom} onChange={setCustom} label={t("resize.custom")} />

          {custom && (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* No "16–8000" over the field. The range is enforced where it
                    matters — `min`/`max` on the input, and `clampInput` on
                    blur, which CORRECTS an out-of-range number in front of the
                    seller instead of leaving them to read a rule first. */}
                <Label htmlFor="resize-w">{t("editor.f.width")}</Label>
                <Input id="resize-w" type="number" inputMode="numeric" min={MIN_SIDE} max={MAX_SIDE}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  onBlur={() => setCustomWidth(clampInput(customWidth))} />
              </div>
              {/* The ratio lock lives BETWEEN the two fields, where the thing
                  it links is visible. It was a checkbox on its own line. */}
              <button type="button" onClick={() => setLockRatio((locked) => !locked)}
                aria-pressed={lockRatio} title={t("editor.f.lock")} aria-label={t("editor.f.lock")}
                className={cn("mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                  lockRatio ? "is-selected text-accent" : "border-line text-faint hover:bg-raised hover:text-ink")}>
                {lockRatio ? <Link2 size={15} aria-hidden /> : <Unlink size={15} aria-hidden />}
              </button>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="resize-h">{t("editor.f.height")}</Label>
                <Input id="resize-h" type="number" inputMode="numeric" min={MIN_SIDE} max={MAX_SIDE}
                  value={lockRatio ? "" : customHeight}
                  disabled={lockRatio}
                  placeholder={t("tools.opt.auto")}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  onBlur={() => setCustomHeight(clampInput(customHeight))} />
              </div>
            </div>
          )}
        </Panel>

        {/* COST + ACTION — the island, in the shape the generator's uses. */}
        <CostIsland perImage={credits} count={pending.length} enough={!notEnough} status={status}>
          <button type="button" onClick={() => run()}
            disabled={running || pending.length === 0 || notEnough || !hasTarget}
            className={cn("cta flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
              (running || pending.length === 0 || notEnough || !hasTarget) && "cursor-not-allowed opacity-55")}>
            {running ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Maximize2 size={14} aria-hidden />}
            {running ? t("tools.progress", { done: done.length + failed.length, total: items.length }) : t("resize.run")}
          </button>
        </CostIsland>
      </div>

      {/* THE WORKSPACE — the toolbar sits ABOVE the gallery, on the page
          ground, and is there from the first paint. It used to appear only
          once a photo had been added, so the screen a seller meets was a bare
          box: the controls that shape the gallery belong to the workspace,
          not to its contents. With an empty queue they are disabled, not
          hidden — a control that moves nothing is worse than one that says
          so. */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        <BatchGalleryToolbar
          items={cards} view={view} onView={setView} zoom={zoom} onZoom={setZoom}
          filter={filter} onFilter={setFilter}
          disabled={items.length === 0}
          selecting={selecting}
          onSelecting={(on) => {
            setSelecting(on);
            // Leaving selection mode drops both the picks and the filter
            // that depends on them — a hidden "tylko zaznaczone" over an
            // empty selection is an empty gallery nobody asked for.
            if (!on) { setSelected(new Set()); setFilter((f) => ({ ...f, selectedOnly: false })); }
          }}
        />

        {items.length === 0 ? (
          <EmptyState icon={ImagePlus} title={t("resize.emptyTitle")} body={t("resize.emptyBody")} />
        ) : (
        <Panel className="min-w-0 rounded-2xl p-3 sm:p-4">
          {/* The batch's own actions, on the row above the grid: what is
              queued, what failed, and what can be taken away. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="overline">{t("tools.queue", { n: items.length })}</p>
              {targetLabel && (
                <p className="mt-0.5 truncate text-[11px] tabular-nums text-faint">
                  {t("resize.newSize")} · {targetLabel}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {running && (
                <span className="text-xs font-semibold tabular-nums text-accent">
                  {t("tools.progress", { done: done.length + failed.length, total: items.length })}
                </span>
              )}
              {failed.length > 0 && !running && (
                <Button variant="ghost" size="sm"
                  onClick={() => run(failed.map((i) => ({ ...i, status: "queued" as const })))}>
                  <RotateCcw size={14} aria-hidden /> {t("tools.retryFailed", { n: failed.length })}
                </Button>
              )}
              {done.length > 0 && (
                <Button variant="secondary" size="sm" onClick={downloadAll}>
                  {done.length > 1 ? <FileArchive size={14} aria-hidden /> : <Download size={14} aria-hidden />}
                  {done.length > 1 ? t("tools.downloadZip", { n: done.length }) : t("common.download")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={clearAll} disabled={running}>
                <Trash2 size={14} aria-hidden /> {t("common.clear")}
              </Button>
            </div>
          </div>

          {/* SELECTION BAR — mounted by the selection, so an empty strip never
              sits above the grid. */}
          {selecting && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-accent-soft/25 px-2.5 py-2 text-[12.5px]">
              <span className="font-semibold tabular-nums text-accent">
                {t("batch.selected", { n: selected.size })}
              </span>
              <Button variant="ghost" size="sm"
                onClick={() => setSelected(new Set(visible.map((i) => i.id)))}>
                {t("batch.selectAll")}
              </Button>
              <Button variant="ghost" size="sm" disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}>
                {t("batch.clearSelection")}
              </Button>
              <span className="flex-1" />
              <Button variant="secondary" size="sm"
                disabled={selectedDone.length === 0}
                onClick={() => downloadMany(selectedDone)}>
                <Download size={14} aria-hidden /> {t("batch.downloadSelected")}
              </Button>
              <Button variant="ghost" size="sm" disabled={selected.size === 0 || running}
                onClick={() => {
                  for (const id of selected) release(id);
                  setItems((prev) => prev.filter((i) => !selected.has(i.id)));
                  setSelected(new Set());
                }}>
                <Trash2 size={14} aria-hidden /> {t("batch.removeSelected")}
              </Button>
            </div>
          )}

          {running && (
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="brand-gradient h-full rounded-full transition-[width] duration-200"
                style={{ width: `${Math.round(((done.length + failed.length) / items.length) * 100)}%` }} />
            </div>
          )}

          <BatchGrid
            items={visible} view={view} zoom={zoom} running={running}
            selecting={selecting} selected={selected} favourites={favourites}
            meta={(id) => {
              const item = byId.get(id);
              if (!item) return null;
              return <SizeRow item={item} target={target} hasTarget={hasTarget}
                original={t("tools.preset.original")} />;
            }}
            onDownload={(id) => {
              const item = byId.get(id);
              if (item) download(item, items.indexOf(item));
            }}
            onRemove={removeItem}
            onToggleFavourite={(id) => setFavourites((prev) => toggleIn(prev, id))}
            onToggleSelected={(id) => setSelected((prev) => toggleIn(prev, id))}
          />
        </Panel>
        )}
      </div>
    </div>
  );
}

/* ── pieces ────────────────────────────────────────────────────────────── */

/** Current size → what comes back. Before a run that is the prediction; after
 *  one it is the size the server actually reported, so a target changed
 *  afterwards can never make a finished row lie about its own file. */
function SizeRow({ item, target, hasTarget, original }: {
  item: Item;
  target: Target;
  hasTarget: boolean;
  original: string;
}) {
  if (!item.source) {
    return <p className="truncate text-[11px] tabular-nums text-faint">{formatBytes(item.file.size)}</p>;
  }
  const next = item.after ?? (hasTarget ? predict(item.source, target) : null);
  const unchanged = next !== null && next.width === item.source.width && next.height === item.source.height;
  return (
    <p className="flex min-w-0 items-center gap-1 truncate text-[11px] tabular-nums text-faint">
      <span>{item.source.width} × {item.source.height}</span>
      {next && (
        <>
          <ArrowRight size={11} className="shrink-0" aria-hidden />
          {/* A photo already smaller than the target comes back untouched —
              sharp never enlarges here, and saying "original size" is the
              honest version of an arrow pointing at the same numbers. */}
          <span className={unchanged ? "truncate" : "font-semibold text-ink"}>
            {unchanged ? original : `${next.width} × ${next.height}`}
          </span>
        </>
      )}
      {item.after && <span className="shrink-0">· {formatBytes(item.after.bytes)}</span>}
    </p>
  );
}

function CheckRow({ checked, onChange, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[rgb(var(--accent))]" />
      {label}
    </label>
  );
}

/* ── maths ─────────────────────────────────────────────────────────────── */

/**
 * What sharp will genuinely produce: `fit: "inside"` with
 * `withoutEnlargement`, so the target is a CEILING. A photo smaller than it
 * comes back at its own size instead of blown up — adding pixels that were
 * never photographed is the paid upscaler's job, not this one's.
 */
function predict(source: { width: number; height: number }, target: Target) {
  const byWidth = target.width ? target.width / source.width : Number.POSITIVE_INFINITY;
  const byHeight = target.height ? target.height / source.height : Number.POSITIVE_INFINITY;
  const scale = Math.min(byWidth, byHeight, 1);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/** Only a value the server will honour verbatim; anything else is no target
 *  at all, which disables the run rather than silently resizing to something
 *  the seller did not ask for. */
function side(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= MIN_SIDE && n <= MAX_SIDE ? n : null;
}

/** Snap a typed number into range when the field loses focus, so the seller
 *  SEES 9000 become 8000 instead of discovering it in the download. */
function clampInput(raw: string): string {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return "";
  return String(Math.min(MAX_SIDE, Math.max(MIN_SIDE, n)));
}

/**
 * Keep the file in the family it arrived in. A PNG cutout stays a PNG so its
 * transparency survives the resize, and AVIF becomes WebP because that is the
 * only format sharp encodes here that still carries an alpha channel.
 * Flattening a cutout onto white is not a resize, so it never happens by
 * default — the editor and the format tool are where a seller changes format
 * on purpose.
 */
function outputFormatFor(mime: string): OutputFormatOption {
  if (mime === "image/png") return "png";
  if (mime === "image/webp" || mime === "image/avif") return "webp";
  return "jpeg";
}

function settingsFor(file: File, target: Target): ToolSettings["format"] {
  return {
    ...DEFAULT_SETTINGS.format,
    format: outputFormatFor(file.type),
    width: target.width,
    height: target.height,
    // A resize must never crop: "inside" fits the whole photo in the box.
    fit: "inside",
  };
}

/**
 * One decode per photo, and the full-resolution bitmap is closed as soon as
 * the 256 px preview exists — the page then holds two hundred small blobs
 * instead of two hundred decoded photos. The same pass reports the real pixel
 * size: EXIF orientation is applied here for the reason sharp calls
 * `.rotate()` server-side, otherwise a portrait phone photo would advertise
 * landscape dimensions.
 */
async function readThumb(file: File): Promise<{ blob: Blob | null; width: number; height: number } | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { return null; }

  const { width, height } = bitmap;
  const scale = Math.min(THUMB_SIDE / width, THUMB_SIDE / height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); return { blob: null, width, height }; }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // A browser without WebP encoding falls back to PNG on its own; at 256 px
  // the difference is a few kilobytes either way.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.72));
  return { blob, width, height };
}

/** Codes we have a translation for; anything else becomes the generic failure
 *  rather than a raw key on screen. */
const KNOWN_ERRORS = new Set([
  "insufficient_credits", "image_too_large", "unsupported_format", "unreadable_image",
  "network_error", "tool_unavailable", "no_provider",
]);
const errorKey = (error?: string) => (error && KNOWN_ERRORS.has(error) ? error : "processing_failed");
