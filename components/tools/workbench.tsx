"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Download, FileArchive, ImagePlus,
  Loader2, Package, RotateCcw, Save, Trash2, X, Zap,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { ActionBar } from "@/components/ui/action-bar";
import { ProductPicker, type PickableProduct } from "@/components/products/product-picker";
import { ToolSettingsPanel } from "@/components/tools/settings";
import { Compare } from "@/components/tools/compare";
import { WatermarkPreview } from "@/components/tools/watermark-preview";
import {
  ACCEPTED_MIME, DEFAULT_SETTINGS, MAX_BATCH_FILES, MAX_UPLOAD_BYTES, type ToolSlug,
} from "@/lib/images/tools";
import { createZip, outputName } from "@/lib/images/zip";
import { cn, formatBytes } from "@/lib/utils";

type ItemStatus = "queued" | "running" | "done" | "error";

type Item = {
  id: string;
  file: File;
  sourceUrl: string;
  status: ItemStatus;
  resultUrl?: string;
  resultBlob?: Blob;
  error?: string;
  credits?: number;
  before?: { width: number; height: number; bytes: number };
  after?: { width: number; height: number; bytes: number };
  saved?: boolean;
};

/** Three at a time keeps the phone responsive and the function warm without
 *  hammering a provider's rate limit on a hundred-photo batch. */
const CONCURRENCY = 3;

/**
 * TOOL WORKBENCH — upload, configure, run, compare, keep.
 *
 * One request per photo, three in flight, so a batch reports a real
 * "17 / 82" and one failed image never sinks the rest. Results live in the
 * browser as blobs until the seller explicitly saves them, which keeps
 * storage (and its bill) proportional to what people actually want to keep.
 */
export function ToolWorkbench({ tool, available, credits, providerLabel, reason, balance, products }: {
  tool: ToolSlug;
  available: boolean;
  credits: number;
  providerLabel: string | null;
  reason: string;
  balance: number;
  products: PickableProduct[];
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({ ...DEFAULT_SETTINGS[tool] });
  const [logo, setLogo] = useState<{ file: File; url: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [product, setProduct] = useState<PickableProduct | null>(null);
  const cancelled = useRef(false);

  /**
   * Object URLs are the only thing here that leaks, and they must outlive
   * every render: revoking them when `items` changes would kill thumbnails
   * that are still on screen. So they are tracked in a ref and released once,
   * when the panel actually goes away.
   */
  const urls = useRef<string[]>([]);
  const trackUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  }, []);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); urls.current = []; }, []);

  const done = items.filter((i) => i.status === "done");
  const failed = items.filter((i) => i.status === "error");
  const pending = items.filter((i) => i.status === "queued");
  const totalCredits = credits * pending.length;
  const notEnough = totalCredits > balance;

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    const accepted: Item[] = [];
    let rejected = 0;
    for (const file of incoming) {
      if (!ACCEPTED_MIME.includes(file.type) || file.size > MAX_UPLOAD_BYTES) { rejected++; continue; }
      accepted.push({
        id: `${file.name}-${file.size}-${accepted.length}-${Math.random().toString(36).slice(2, 8)}`,
        file, sourceUrl: trackUrl(file), status: "queued",
      });
    }
    if (rejected > 0) toast.error(t("tools.rejected", { n: rejected }));
    setItems((prev) => {
      const room = MAX_BATCH_FILES - prev.length;
      if (room <= 0) { toast.error(t("tools.batchFull", { n: MAX_BATCH_FILES })); return prev; }
      if (accepted.length > room) toast.error(t("tools.batchFull", { n: MAX_BATCH_FILES }));
      return [...prev, ...accepted.slice(0, room)];
    });
  }, [t, trackUrl]);

  async function runOne(item: Item): Promise<Partial<Item>> {
    const form = new FormData();
    form.append("tool", tool);
    form.append("settings", JSON.stringify(settings));
    form.append("file", item.file);
    if (logo) form.append("logo", logo.file);
    // Stable per-item key: a refresh mid-batch re-sends the same key and the
    // ledger recognises the run instead of charging for it twice.
    form.append("idempotencyKey", item.id);

    const res = await fetch("/api/tools/run", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "processing_failed" }));
      return { status: "error", error: String(body.error ?? "processing_failed") };
    }
    const meta = JSON.parse(atob(res.headers.get("X-Tool-Meta") ?? btoa("{}"))) as {
      credits?: number; before?: Item["before"]; after?: Item["after"];
    };
    const blob = await res.blob();
    return {
      status: "done", resultBlob: blob, resultUrl: trackUrl(blob),
      credits: meta.credits ?? 0, before: meta.before, after: meta.after, error: undefined,
    };
  }

  async function run(only?: Item[]) {
    if (running) return;
    const queue = only ?? items.filter((i) => i.status === "queued");
    if (queue.length === 0) return;
    if (tool === "watermark" && !logo) { toast.error(t("tools.needLogo")); return; }

    cancelled.current = false;
    setRunning(true);
    setItems((prev) => prev.map((i) => queue.some((q) => q.id === i.id) ? { ...i, status: "running", error: undefined } : i));

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
        // A wallet that has run dry will fail every remaining image the same
        // way, so the batch stops instead of generating eighty toasts.
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

  function download(item: Item, index: number) {
    if (!item.resultBlob) return;
    const url = URL.createObjectURL(item.resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputName(item.file.name, t(`tools.${tool}.suffix`), item.resultBlob.type, index);
    a.click();
    // Revoking in the same tick can cancel the download the click just began.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function downloadAll() {
    if (done.length === 0) return;
    if (done.length === 1) { download(done[0], 0); return; }
    const entries = await Promise.all(done.map(async (item, index) => ({
      name: outputName(item.file.name, t(`tools.${tool}.suffix`), item.resultBlob!.type, index),
      data: new Uint8Array(await item.resultBlob!.arrayBuffer()),
    })));
    const url = URL.createObjectURL(createZip(entries));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ecomstudio-${tool}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function saveAll() {
    const savable = done.filter((i) => !i.saved);
    if (savable.length === 0) return;
    let saved = 0;
    for (const item of savable) {
      const form = new FormData();
      form.append("tool", tool);
      form.append("file", new File([item.resultBlob!], item.file.name, { type: item.resultBlob!.type }));
      if (product) form.append("productId", product.id);
      const res = await fetch("/api/tools/save", { method: "POST", body: form });
      if (res.ok) {
        saved++;
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, saved: true } : i)));
      }
    }
    if (saved > 0) toast.success(t(product ? "tools.savedProduct" : "tools.savedLibrary", { n: saved }));
    else toast.error(t("tools.saveFailed"));
  }

  const savings = useMemo(() => {
    const before = done.reduce((sum, i) => sum + (i.before?.bytes ?? 0), 0);
    const after = done.reduce((sum, i) => sum + (i.after?.bytes ?? 0), 0);
    return before > 0 ? { before, after, percent: Math.round(((before - after) / before) * 100) } : null;
  }, [done]);

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
    <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        {/* UPLOAD */}
        <input ref={inputRef} type="file" multiple accept={ACCEPTED_MIME.join(",")} className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
          className={cn(
            "flex w-full flex-col items-center gap-1.5 rounded-2xl border border-dashed px-4 py-8 transition-colors",
            dragging
              ? "border-[rgb(var(--accent)/0.7)] bg-accent-soft/40 text-accent"
              : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/50 text-faint hover:border-[rgb(var(--accent)/0.55)] hover:text-accent"
          )}
        >
          <ImagePlus size={24} aria-hidden />
          <span className="text-sm font-semibold">{t("tools.drop")}</span>
          <span className="text-[11px]">{t("tools.dropHint", { n: MAX_BATCH_FILES, size: formatBytes(MAX_UPLOAD_BYTES) })}</span>
        </button>

        {/* QUEUE */}
        {items.length > 0 && (
          <Panel className="rounded-2xl p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="overline">{t("tools.queue", { n: items.length })}</p>
              <div className="flex items-center gap-2">
                {running && (
                  <span className="text-xs font-semibold tabular-nums text-accent">
                    {t("tools.progress", { done: done.length + failed.length, total: items.length })}
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => setItems([])} disabled={running}>
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

            <ul className="thin-scroll max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {items.map((item, index) => (
                <li key={item.id} className="plate flex items-center gap-3 rounded-xl p-2">
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-checker">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.resultUrl ?? item.sourceUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{item.file.name}</p>
                    <p className="truncate text-[11px] text-faint">
                      {item.status === "done" && item.after
                        ? `${item.after.width}×${item.after.height} · ${formatBytes(item.after.bytes)}`
                        : item.status === "error"
                          ? t(`tools.err.${errorKey(item.error)}`)
                          : formatBytes(item.file.size)}
                    </p>
                  </div>
                  <StatusMark status={item.status} />
                  {item.status === "done" && (
                    <button type="button" onClick={() => download(item, index)} aria-label={t("common.download")}
                      className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink">
                      <Download size={15} aria-hidden />
                    </button>
                  )}
                  {!running && item.status !== "running" && (
                    <button type="button" aria-label={t("common.remove")}
                      onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-sunken hover:text-danger">
                      <X size={15} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* RESULT */}
        {done.length > 0 && (
          <Panel className="rounded-2xl p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="overline">{t("tools.result")}</p>
              {savings && savings.percent > 0 && (
                <Badge tone="green">
                  {t("tools.saved", { percent: savings.percent, before: formatBytes(savings.before), after: formatBytes(savings.after) })}
                </Badge>
              )}
            </div>
            <Compare before={done[0].sourceUrl} after={done[0].resultUrl!} alt={done[0].file.name} />

            <div className="mt-4 space-y-2.5">
              {products.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                    <Package size={14} aria-hidden />
                    {product ? product.name : t("tools.linkProduct")}
                  </Button>
                  {product && (
                    <button type="button" onClick={() => setProduct(null)}
                      className="text-xs font-medium text-faint underline-offset-2 hover:text-ink hover:underline">
                      {t("common.clear")}
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="flex-1" onClick={downloadAll}>
                  {done.length > 1 ? <FileArchive size={15} aria-hidden /> : <Download size={15} aria-hidden />}
                  {done.length > 1 ? t("tools.downloadZip", { n: done.length }) : t("common.download")}
                </Button>
                <Button variant="secondary" className="flex-1" onClick={saveAll}
                  disabled={done.every((i) => i.saved)}>
                  <Save size={15} aria-hidden />
                  {done.every((i) => i.saved) ? t("tools.allSaved") : t("tools.save")}
                </Button>
              </div>
              {failed.length > 0 && (
                <Button variant="ghost" className="w-full" onClick={() => run(failed.map((i) => ({ ...i, status: "queued" as const })))}>
                  <RotateCcw size={14} aria-hidden /> {t("tools.retryFailed", { n: failed.length })}
                </Button>
              )}
            </div>
          </Panel>
        )}
      </div>

      {/* SETTINGS RAIL */}
      <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Panel className="space-y-4 rounded-2xl p-4">
          <p className="overline">{t("tools.settings")}</p>

          {tool === "watermark" && (
            <div className="space-y-2">
              <input ref={logoRef} type="file" accept="image/png,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setLogo({ file, url: trackUrl(file) });
                  e.target.value = "";
                }} />
              <Button variant={logo ? "secondary" : "primary"} size="sm" className="w-full"
                onClick={() => logoRef.current?.click()}>
                <ImagePlus size={14} aria-hidden /> {logo ? t("tools.changeLogo") : t("tools.pickLogo")}
              </Button>
              {logo && items[0] && (
                <WatermarkPreview base={items[0].sourceUrl} logo={logo.url} settings={settings} />
              )}
            </div>
          )}

          <ToolSettingsPanel tool={tool} settings={settings} onChange={setSettings} />
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
          note={providerLabel && credits > 0 ? <span className="text-faint">{providerLabel}</span> : undefined}
        >
          <Button className="w-full" size="lg" onClick={() => run()}
            disabled={running || pending.length === 0 || notEnough}>
            {running ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Zap size={16} aria-hidden />}
            {running
              ? t("tools.progress", { done: done.length + failed.length, total: items.length })
              : t("tools.run", { n: pending.length })}
          </Button>
        </ActionBar>
      </div>

      <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} products={products}
        selectedId={product?.id} onSelect={(p) => { setProduct(p); setPickerOpen(false); }} />
    </div>
  );
}

/** Provider and validation codes we have a translation for; anything else
 *  becomes the generic failure rather than a raw key on screen. */
const KNOWN_ERRORS = new Set([
  "insufficient_credits", "no_provider", "needs_transparency", "already_that_ratio",
  "image_too_large", "unsupported_format", "unreadable_image", "missing_logo",
  "provider_auth_failed", "provider_out_of_credit", "provider_rate_limited",
  "provider_timeout", "provider_unreachable", "network_error", "tool_unavailable",
]);
const errorKey = (error?: string) => (error && KNOWN_ERRORS.has(error) ? error : "processing_failed");

function StatusMark({ status }: { status: ItemStatus }) {
  if (status === "running") return <Loader2 size={16} className="shrink-0 animate-spin text-accent" aria-hidden />;
  if (status === "done") return <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />;
  if (status === "error") return <AlertTriangle size={16} className="shrink-0 text-danger" aria-hidden />;
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--hairline)/0.5)]" />;
}
