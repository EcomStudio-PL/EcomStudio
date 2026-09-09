"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowRight, Download, FileArchive, FileImage,
  FileType, Gauge, ImagePlus, Info, Loader2, RotateCcw, Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import {
  ACCEPTED_MIME, DEFAULT_SETTINGS, MAX_UPLOAD_BYTES,
  type CompressionLevel, type ToolSettings, type ToolSlug,
} from "@/lib/images/tools";
import { CostIsland, GroupLabel, RadioRows } from "@/components/tools/panel-parts";
import {
  BatchGalleryToolbar, BatchGrid, DEFAULT_BATCH_FILTER, DEFAULT_ZOOM,
  applyBatchFilter, type BatchFilter, type BatchItem,
} from "@/components/tools/batch-gallery";
import { createZip, outputName } from "@/lib/images/zip";
import { cn, formatBytes } from "@/lib/utils";
import { batchTotals, reduction, signedPercent, sizeDelta, signedBytes as withSign } from "@/lib/images/weight";
import { acceptFiles, type IntakeLimits } from "@/lib/images/file-intake";
import { FileDropOverlay, useFileDrop } from "@/components/ui/file-drop";

/**
 * COMPRESS — the batch screen, and the only screen in the app whose subject is
 * WEIGHT rather than pixels.
 *
 * Everything underneath is the machinery the generic workbench already uses:
 * the same `/api/tools/run` contract, one request per photo, three in flight,
 * the same ZIP writer, the same catalogue price. The queue is copied rather
 * than imported for the reason the resize screen states — that loop lives
 * inline inside `components/tools/workbench.tsx`, and pulling it into a hook
 * means editing the file every other tool runs on. Shapes and names are kept
 * identical to both so the eventual extraction stays mechanical.
 *
 * What this screen adds is the number nobody else reports: how many bytes the
 * seller actually got back. Every card carries before → after → the share
 * saved, and the batch totals sit under the gallery. A file that did not
 * shrink says so.
 */

const TOOL: ToolSlug = "compress";

/** Built for a whole shoot at once, like the resize screen. Nothing on the
 *  server knows about batches — it is one request per photo either way — so
 *  the cap is only about what the browser can hold. */
const MAX_FILES = 200;

/** Three at a time keeps the phone responsive and the function warm. */
const CONCURRENCY = 3;

/** Previews are re-encoded at this size instead of pointing an <img> at the
 *  original file: two hundred full-resolution decodes is what actually melts
 *  a phone, not two hundred rows. */
const THUMB_SIDE = 256;

/**
 * The three strengths, in the order a seller reads them: least aggressive
 * first. Each maps onto one of the `CompressionLevel` values that
 * `lib/images/local.ts` already implements, and the encoder quality it will
 * genuinely use is mirrored here — that module is server-only, so the number
 * is copied the way `MAX_UPLOAD_BYTES` already is. Naming it on the label
 * turns three vague adjectives into the setting they actually are.
 *
 * The catalogue's fourth level, "auto", is deliberately not offered here: it
 * walks the quality down on its own, so its result cannot be stated before
 * the run — which is exactly what this screen exists to do.
 */
const LEVELS: { key: string; level: CompressionLevel; quality: number }[] = [
  { key: "low", level: "light", quality: 88 },
  { key: "mid", level: "balanced", quality: 78 },
  { key: "high", level: "strong", quality: 62 },
];

/**
 * Output formats this tool can genuinely deliver: the three sharp encodes with
 * a real quality dial, plus "keep the one it arrived in".
 *
 * TIFF is missing on purpose even though the settings type allows it — sharp
 * writes it lossless (LZW), so the strength control above would do nothing and
 * a photo would come back BIGGER than it went in. SVG and GIF are missing
 * because there is no encoder for them here at all: SVG is vector text, not
 * pixels, and nothing in this pipeline writes an animated GIF.
 */
/** One tint per format, for the little file icon on its row. Deliberately the
 *  tokens this design system already has rather than four new colours. */
const FORMAT_TINT: Record<string, string> = {
  keep: "text-faint",
  jpeg: "text-warning",
  png: "text-info",
  webp: "text-success",
};

const FORMATS: { value: ToolSettings["compress"]["format"]; label?: string }[] = [
  // "Keep" is the only one whose label is a phrase, so it is the only one that
  // comes from the dictionary — the other three are format names and read the
  // same in all three languages.
  { value: "keep" },
  { value: "jpeg", label: "JPG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WEBP" },
];

/** The accept attribute is a hint the file picker may ignore and a drop event
 *  never honours at all, so the extension is checked next to the MIME type.
 *  The route validates both again — this only saves the seller the upload. */
const ACCEPTED_EXT = ["jpg", "jpeg", "png", "webp", "avif"];

/** What this tool takes — one object, used by the picker, the drop and
 *  the validator, so the three can never disagree. */
const COMPRESS_LIMITS: IntakeLimits = {
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
  status: ItemStatus;
  resultBlob?: Blob;
  /** Real size of what came back, reported by the server that encoded it. */
  after?: { width: number; height: number; bytes: number };
  error?: string;
};

export function CompressWorkbench({ available, credits, reason, balance }: {
  available: boolean;
  /** Credits per photo, from the service catalogue — never a constant. */
  credits: number;
  reason: string;
  balance: number;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [levelKey, setLevelKey] = useState(LEVELS[1].key);
  const [format, setFormat] = useState<ToolSettings["compress"]["format"]>("keep");
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  /* The same workspace state the resize screen keeps, for the same reason:
     it describes how this batch is being looked at, and it lives as long as
     the batch does. */
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

  /** The queue as the shared gallery sees it. */
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

  const level = LEVELS.find((l) => l.key === levelKey) ?? LEVELS[1];

  /** The footnote the strength control used to print in full: what lossy means,
   *  plus the encoder quality this strength genuinely uses. */
  const strengthNote = `${t("compress.lossyNote")} ${t("tools.opt.quality")}: ${level.quality}.`;

  /**
   * WHY THE BUTTON IS OFF — one line, in the card where the decision is made,
   * and silent once there is nothing left to explain.
   */
  const status = items.length === 0 ? t("compress.needPhotos")
    : notEnough ? t("tools.err.insufficient_credits")
      : pending.length === 0 ? t("compress.nothingQueued")
        : null;

  /**
   * The batch total, over finished photos only. "Before" is the file the
   * seller picked, straight from `File.size`, so the number on screen is the
   * one their disk shows; "after" is what the server encoded and sent back.
   */
  const totals = useMemo(
    () => batchTotals(done.map((i) => ({ before: i.file.size, after: i.after?.bytes ?? null }))),
    [done],
  );

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
        const url = track(item.id, thumb);
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, thumbUrl: url } : i)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }, [track]);

  const addFiles = useCallback((files: FileList | File[]) => {
    // ONE GATE. The picker and a drop anywhere on the page both land here, so
    // a file the dialog accepts is exactly a file the drop accepts.
    const room = Math.max(0, MAX_FILES - live.current.size);
    const sorted = acceptFiles(files, COMPRESS_LIMITS, room);
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

  /** Narrow the segmented control's plain string back onto the settings union
   *  by looking it up, rather than asserting the cast. */
  function pickFormat(raw: string) {
    const found = FORMATS.find((f) => f.value === raw);
    if (found) setFormat(found.value);
  }

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
    form.append("settings", JSON.stringify(settingsFor(level.level, format)));
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
    if (running) return;
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

  /** One file goes straight down; several become a ZIP. Shared by "pobierz
   *  wszystkie" and the selection bar. */
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
    a.download = "grovbase-compress.zip";
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
        title={t("tools.dropCompressTitle")}
        sub={t("tools.dropHint", { n: MAX_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })}
      />
      {/* LEFT COLUMN — a bounded scrolling body and an island that is its
          SIBLING, so the cost and the CTA never scroll away. */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <input ref={inputRef} type="file" multiple accept={ACCEPTED_MIME.join(",")} className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {/* ONE CARD: what goes in, and how hard it is squeezed. */}
        <Panel className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          <div className="min-w-0">
          <GroupLabel>{t("tools.addPhotos", { n: MAX_FILES })}</GroupLabel>
          {/* A word, a count, and the rule underneath — the same tile the
              resize screen uses, because it is the same job. Both ways in
              still work: this is a real <button> that opens the picker, and
              the whole page is a drop target (see useFileDrop below). */}
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
            <span className="text-center text-[10.5px] leading-tight text-faint">
              {t("tools.dropHint", { n: MAX_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })}
            </span>
          </button>
          </div>

          <div className="min-w-0">
            {/* THREE BUTTONS, NOTHING UNDER THEM. The encoder quality the
                chosen strength really uses is still available — it moved onto
                the info icon together with the lossy warning, because a
                settings rail is not the place for a paragraph and a number
                nobody asked for. */}
            <GroupLabel>
              <span className="inline-flex items-center gap-1.5">
                {t("compress.strength")}
                <Info size={13} aria-hidden className="text-faint" tabIndex={0}
                  role="img" aria-label={strengthNote}>
                  <title>{strengthNote}</title>
                </Info>
              </span>
            </GroupLabel>
            <Segmented
              value={levelKey}
              onChange={setLevelKey}
              label={t("compress.strength")}
              options={LEVELS.map((l) => ({ value: l.key, label: t(`compress.${l.key}`) }))}
            />
            {/* Lossy is lossy — but the sentence saying so was three lines of
                grey text under a three-button control, which is a wall where a
                footnote belongs. It is on the info icon now, and the real
                answer is on the cards: every photo reports what it actually
                lost. */}
          </div>

          <div className="min-w-0">
            <GroupLabel>
              <span className="inline-flex items-center gap-1.5">
                {t("tools.opt.format")}
                {/* The transparency rule was a grey line under the rows. It is
                    a footnote about two of the four formats, so it lives on
                    the icon and the rows stay a clean list of names. */}
                <Info size={13} aria-hidden className="text-faint" tabIndex={0}
                  role="img" aria-label={t("tools.opt.alphaHint")}>
                  <title>{t("tools.opt.alphaHint")}</title>
                </Info>
              </span>
            </GroupLabel>
            {/* Rows, not chips: four options in a 21rem rail turned
                "Bez zmiany formatu" into "Bez z…", which is a control that
                has stopped saying what it does. Only formats this pipeline
                genuinely encodes are listed — no SVG, no GIF, no TIFF. */}
            <RadioRows
              name="compress-format"
              value={format}
              onChange={pickFormat}
              rows={FORMATS.map((f) => ({
                value: f.value,
                label: f.label ?? t("tools.opt.keep"),
                icon: FileType,
                // A different tint per format, on the ICON only — enough to
                // tell four near-identical rows apart at a glance without
                // repainting the card behind them.
                iconClass: FORMAT_TINT[f.value],
                meta: f.value === "keep" ? t("tools.opt.keepHint") : undefined,
              }))}
            />
          </div>
        </Panel>

        {/* COST + ACTION — the island, in the shape the generator's uses. */}
        <CostIsland perImage={credits} count={pending.length} enough={!notEnough} status={status}>
          <button type="button" onClick={() => run()}
            disabled={running || pending.length === 0 || notEnough}
            className={cn("cta flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
              (running || pending.length === 0 || notEnough) && "cursor-not-allowed opacity-55")}>
            {running ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Gauge size={14} aria-hidden />}
            {running ? t("tools.progress", { done: done.length + failed.length, total: items.length }) : t("compress.run")}
          </button>
        </CostIsland>
      </div>

      {/* THE WORKSPACE — the toolbar sits ABOVE the gallery and is there from
          the first paint: it belongs to the workspace, not to its contents.
          With an empty queue the controls that act ON photos are disabled
          rather than hidden. */}
      <div className="thin-scroll min-w-0 space-y-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        <BatchGalleryToolbar
          items={cards} view={view} onView={setView} zoom={zoom} onZoom={setZoom}
          filter={filter} onFilter={setFilter}
          disabled={items.length === 0}
          selecting={selecting}
          onSelecting={(on) => {
            setSelecting(on);
            if (!on) { setSelected(new Set()); setFilter((f) => ({ ...f, selectedOnly: false })); }
          }}
        />

        {items.length === 0 ? (
          <EmptyState icon={Gauge} title={t("compress.emptyTitle")} body={t("compress.emptyBody")} />
        ) : (
        <>
          <Panel className="min-w-0 rounded-2xl p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="overline">{t("tools.queue", { n: items.length })}</p>
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
                <Button variant="secondary" size="sm" disabled={selectedDone.length === 0}
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
                return <WeightRow item={item} untouched={t("editor.original")} />;
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

          {/* THE POINT OF THE SCREEN — what the batch weighed, and what it
              weighs now. Shown the moment the first photo lands, so the
              numbers grow while the rest of the queue runs. */}
          {done.length > 0 && (
            <Panel className="min-w-0 rounded-2xl p-3 sm:p-4">
              <p className="mb-3 overline">{t("compress.summary")}</p>
              <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0 xl:grid-cols-4">
                <Stat label={t("compress.sizeBefore")} value={formatBytes(totals.before)} icon={FileImage} />
                <Stat label={t("compress.sizeAfter")} value={formatBytes(totals.after)} icon={FileArchive} tone="accent" />
                <Stat label={t("compress.saved")} value={withSign(totals.delta, formatBytes)} icon={ArrowDown}
                  tone={totals.delta > 0 ? "success" : totals.delta < 0 ? "accent2" : "default"} />
                <Stat label={t("compress.reduction")} value={signedPercent(totals.percent)} icon={Gauge}
                  tone={totals.percent > 0 ? "success" : totals.percent < 0 ? "accent2" : "default"}
                  meter={Math.max(0, Math.min(1, totals.percent / 100))}
                  hint={`${done.length} ${t("common.photos")}`} />
              </div>
            </Panel>
          )}
        </>
        )}
      </div>
    </div>
  );
}

/* ── pieces ────────────────────────────────────────────────────────────── */

/**
 * What the file weighed, and what came back.
 *
 * "Before" is `File.size` — the number the seller's own file manager shows —
 * and "after" is the server's count of the bytes it sent. The two are
 * compared in BYTES, not in the rounded percentage: a photo that came back
 * byte-identical is one `compress()` refused to make worse, and saying so is
 * more honest than a green "0%".
 */
function WeightRow({ item, untouched }: { item: Item; untouched: string }) {
  if (item.status !== "done" || !item.after) {
    return <p className="truncate text-[11px] tabular-nums text-faint">{formatBytes(item.file.size)}</p>;
  }
  const percent = reduction(item.file.size, item.after.bytes);
  const grew = item.after.bytes > item.file.size;
  const same = item.after.bytes === item.file.size;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums text-faint">
      <span className="truncate">{formatBytes(item.file.size)}</span>
      <ArrowRight size={11} className="shrink-0" aria-hidden />
      <span className={cn("truncate font-semibold", grew ? "text-accent2" : "text-ink")}>
        {formatBytes(item.after.bytes)}
      </span>
      {same
        ? <Badge tone="neutral" className="px-1.5 py-0">{untouched}</Badge>
        : <Badge tone={grew ? "accent" : "success"} className="px-1.5 py-0">{sizeDelta(percent)}</Badge>}
    </p>
  );
}

/**
 * Compression keeps the pixel dimensions and only re-encodes, so the whole
 * settings payload is the two dials on the rail. Spread over the catalogue
 * default so a field added to the tool later still arrives complete.
 */
function settingsFor(level: CompressionLevel, format: ToolSettings["compress"]["format"]): ToolSettings["compress"] {
  return { ...DEFAULT_SETTINGS.compress, level, format };
}

/**
 * One decode per photo, and the full-resolution bitmap is closed as soon as
 * the 256 px preview exists — the page then holds two hundred small blobs
 * instead of two hundred decoded photos. EXIF orientation is applied for the
 * reason sharp calls `.rotate()` server-side: a portrait phone photo would
 * otherwise preview on its side.
 */
async function readThumb(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { return null; }

  const scale = Math.min(THUMB_SIDE / bitmap.width, THUMB_SIDE / bitmap.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); return null; }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // A browser without WebP encoding falls back to PNG on its own; at 256 px
  // the difference is a few kilobytes either way.
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.72));
}

/** Codes we have a translation for; anything else becomes the generic failure
 *  rather than a raw key on screen. */
const KNOWN_ERRORS = new Set([
  "insufficient_credits", "image_too_large", "unsupported_format", "unreadable_image",
  "network_error", "tool_unavailable", "no_provider",
]);
const errorKey = (error?: string) => (error && KNOWN_ERRORS.has(error) ? error : "processing_failed");
