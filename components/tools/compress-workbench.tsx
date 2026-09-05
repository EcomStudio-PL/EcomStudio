"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowRight, CheckCircle2, Download, FileArchive, FileImage,
  Gauge, ImagePlus, Loader2, RotateCcw, Trash2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { ActionBar } from "@/components/ui/action-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  ACCEPTED_MIME, DEFAULT_SETTINGS, MAX_UPLOAD_BYTES,
  type CompressionLevel, type ToolSettings, type ToolSlug,
} from "@/lib/images/tools";
import { createZip, outputName } from "@/lib/images/zip";
import { cn, formatBytes } from "@/lib/utils";

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
  const [dragging, setDragging] = useState(false);
  const cancelled = useRef(false);

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

  const done = items.filter((i) => i.status === "done");
  const failed = items.filter((i) => i.status === "error");
  const pending = items.filter((i) => i.status === "queued");
  const totalCredits = credits * pending.length;
  const notEnough = totalCredits > balance;

  const level = LEVELS.find((l) => l.key === levelKey) ?? LEVELS[1];

  /**
   * The batch total, over finished photos only. "Before" is the file the
   * seller picked, straight from `File.size`, so the number on screen is the
   * one their disk shows; "after" is what the server encoded and sent back.
   */
  const totals = useMemo(() => {
    const before = done.reduce((sum, i) => sum + i.file.size, 0);
    const after = done.reduce((sum, i) => sum + (i.after?.bytes ?? i.file.size), 0);
    return { before, after, delta: before - after, percent: reduction(before, after) };
  }, [done]);

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
    const accepted: Item[] = [];
    let rejected = 0;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const ok = ACCEPTED_MIME.includes(file.type) && ACCEPTED_EXT.includes(ext)
        && file.size > 0 && file.size <= MAX_UPLOAD_BYTES;
      if (!ok) { rejected++; continue; }
      accepted.push({
        id: `${file.name}-${file.size}-${accepted.length}-${Math.random().toString(36).slice(2, 8)}`,
        file, status: "queued",
      });
    }
    if (rejected > 0) toast.error(t("tools.rejected", { n: rejected }));
    if (accepted.length === 0) return;

    const room = Math.max(0, MAX_FILES - live.current.size);
    const taken = accepted.slice(0, room);
    if (taken.length < accepted.length) toast.error(t("tools.batchFull", { n: MAX_FILES }));
    if (taken.length === 0) return;

    for (const item of taken) live.current.add(item.id);
    setItems((prev) => [...prev, ...taken]);
    void thumbnails(taken);
  }, [t, thumbnails]);

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

  async function downloadAll() {
    if (done.length === 0) return;
    if (done.length === 1) { download(done[0], 0); return; }
    const entries = await Promise.all(done.map(async (item, index) => ({
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
    <div className="grid gap-4 pb-36 [&>*]:min-w-0 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-5 lg:pb-0">
      {/* SETTINGS — first in the DOM, so a phone gets the dials before the
          gallery and a desktop gets a rail that stays put while it scrolls. */}
      <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        <input ref={inputRef} type="file" multiple accept={ACCEPTED_MIME.join(",")} className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
          className={cn(
            "flex w-full flex-col items-center gap-1.5 rounded-2xl border border-dashed px-4 py-7 transition-colors",
            dragging
              ? "border-[rgb(var(--accent)/0.7)] bg-accent-soft/40 text-accent"
              : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/50 text-faint hover:border-[rgb(var(--accent)/0.55)] hover:text-accent"
          )}
        >
          <ImagePlus size={24} aria-hidden />
          <span className="text-sm font-semibold">{t("tools.drop")}</span>
          <span className="text-[11px]">{t("tools.dropHint", { n: MAX_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })}</span>
          <span className="mt-1 text-[11px] font-semibold tabular-nums text-muted">
            {items.length} / {MAX_FILES} {t("common.photos")}
          </span>
        </button>

        <Panel className="space-y-4 rounded-2xl p-4">
          <div className="min-w-0 space-y-1.5">
            {/* The encoder quality the chosen strength really uses, on the
                label — so "Mocna" is a number, not a promise. */}
            <Label hint={`${t("tools.opt.quality")} ${level.quality}`}>{t("compress.strength")}</Label>
            <Segmented
              value={levelKey}
              onChange={setLevelKey}
              label={t("compress.strength")}
              options={LEVELS.map((l) => ({ value: l.key, label: t(`compress.${l.key}`) }))}
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label>{t("tools.opt.format")}</Label>
            {/* Full size, not "sm": four chips at 29px are under the comfortable
                tap height on a phone, and this row sits directly under the
                strength row, which is full size. */}
            <Segmented
              value={format}
              onChange={pickFormat}
              label={t("tools.opt.format")}
              options={FORMATS.map((f) => ({ value: f.value, label: f.label ?? t("tools.opt.keep") }))}
            />
            <p className="text-[11px] leading-relaxed text-faint">{t("tools.opt.alphaHint")}</p>
          </div>
        </Panel>

        <ActionBar
          summary={
            <>
              <span className="min-w-0 truncate text-muted">
                {pending.length > 0 ? t("tools.pendingCount", { n: pending.length }) : t("tools.noQueue")}
              </span>
              <span className={cn("shrink-0 font-semibold tabular-nums", notEnough ? "text-danger" : "text-ink")}>
                {credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: totalCredits })}
              </span>
            </>
          }
          note={credits > 0
            ? <span className="text-faint tabular-nums">{t("tools.creditsTotal", { n: credits })} × {pending.length}</span>
            : undefined}
        >
          <Button className="w-full" size="lg" onClick={() => run()}
            disabled={running || pending.length === 0 || notEnough}>
            {running ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Gauge size={16} aria-hidden />}
            {running ? t("tools.progress", { done: done.length + failed.length, total: items.length }) : t("compress.run")}
          </Button>
        </ActionBar>
      </div>

      {/* GALLERY */}
      {items.length === 0 ? (
        <EmptyState icon={ImagePlus} title={t("tools.noQueue")}
          body={t("tools.dropHint", { n: MAX_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })} />
      ) : (
        <div className="min-w-0 space-y-4">
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

            {running && (
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div className="brand-gradient h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${Math.round(((done.length + failed.length) / items.length) * 100)}%` }} />
              </div>
            )}

            <ul className="grid gap-2 [&>*]:min-w-0 sm:grid-cols-2 2xl:grid-cols-3">
              {items.map((item, index) => (
                // content-visibility lets the browser skip laying out the rows
                // that are off screen — two hundred cards, a handful rendered.
                <li key={item.id} className="plate flex items-center gap-3 rounded-xl p-2"
                  style={{ contentVisibility: "auto", containIntrinsicSize: "auto 4rem" }}>
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-checker">
                    {item.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumbUrl} alt="" loading="lazy" decoding="async"
                        className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden className="block h-full w-full animate-pulse bg-sunken" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{item.file.name}</p>
                    {item.status === "error"
                      ? <p className="truncate text-[11px] text-danger">{t(`tools.err.${errorKey(item.error)}`)}</p>
                      : <WeightRow item={item} untouched={t("editor.original")} />}
                  </div>
                  <StatusMark status={item.status} />
                  {item.status === "done" && (
                    <button type="button" onClick={() => download(item, index)} aria-label={t("common.download")}
                      className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink">
                      <Download size={15} aria-hidden />
                    </button>
                  )}
                  {!running && item.status !== "running" && (
                    <button type="button" aria-label={t("common.remove")} onClick={() => removeItem(item.id)}
                      className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-sunken hover:text-danger">
                      <X size={15} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
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
                <Stat label={t("compress.saved")} value={signedBytes(totals.delta)} icon={ArrowDown}
                  tone={totals.delta > 0 ? "success" : totals.delta < 0 ? "accent2" : "default"} />
                <Stat label={t("compress.reduction")} value={signedPercent(totals.percent)} icon={Gauge}
                  tone={totals.percent > 0 ? "success" : totals.percent < 0 ? "accent2" : "default"}
                  meter={Math.max(0, Math.min(1, totals.percent / 100))}
                  hint={`${done.length} ${t("common.photos")}`} />
              </div>
            </Panel>
          )}
        </div>
      )}
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
        : <Badge tone={grew ? "amber" : "green"} className="px-1.5 py-0">{signedPercent(percent)}</Badge>}
    </p>
  );
}

function StatusMark({ status }: { status: ItemStatus }) {
  if (status === "running") return <Loader2 size={16} className="shrink-0 animate-spin text-accent" aria-hidden />;
  if (status === "done") return <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />;
  if (status === "error") return <AlertTriangle size={16} className="shrink-0 text-danger" aria-hidden />;
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--hairline)/0.5)]" />;
}

/* ── numbers ───────────────────────────────────────────────────────────── */

/** The share of the file that went away, as a whole percent. Negative when a
 *  file grew — a lie in the seller's favour is still a lie. */
function reduction(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}

/** `formatBytes` speaks only in magnitudes, so the sign is carried outside it:
 *  a batch that grew must say so rather than print a negative byte count. */
function signedBytes(delta: number): string {
  return delta < 0 ? `−${formatBytes(-delta)}` : formatBytes(delta);
}

function signedPercent(percent: number): string {
  return percent < 0 ? `−${-percent}%` : `${percent}%`;
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
