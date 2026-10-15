"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, Loader2, Maximize2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { useHomeHandoff } from "@/lib/home-handoff";
import { saveImageFrom } from "@/lib/save-image";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { GenerationGallery } from "@/components/genv3/gallery";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Switch } from "@/components/ui/record";
import { cn } from "@/lib/utils";
import { humanizeKey } from "@/lib/i18n/t";
import { THUMBNAIL_OPERATION, THUMBNAIL_UPLOAD_MAX_BYTES, quoteTotal } from "@/lib/thumbnail/config";
import type { ThumbnailRuntimeData } from "@/components/category/workflow-runtime";
import type { GalleryItem, UploadedRef } from "@/components/genv3/types";
import type { ThumbnailRunView } from "@/lib/server/thumbnail/status";

const POLL_MS = 2500;
const TERMINAL = new Set(["ok", "failed"]);

/**
 * MINIATURKA — the tool's screen.
 *
 *   A  the photos, in the order they will be sent (reorder, remove, preview;
 *      the same file twice is two photos)
 *   B  Retusz AI per photo — off by default, priced at Retusz's own price
 *   C  what it will cost, from the live prices (the server re-checks)
 *   D  one button; then one calm "working" state — how the thumbnail is
 *      made (its steps, models, intermediate files) is never shown here
 *   E  the finished 2560×2560 file: preview, zoom, download, in the library
 *
 * The run lives on the server (lib/server/thumbnail/run.ts): this screen
 * drives it one request at a time and can be closed and reopened — the run
 * still in progress is picked up again on load. One click is one run: the
 * button locks, and the click's own id makes a double submit the same run.
 */
export function ThumbnailWorkspace({ workspaceId, credits, data }: {
  workspaceId: string;
  credits: number;
  data: ThumbnailRuntimeData;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [photos, setPhotos] = useState<UploadedRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [retouch, setRetouch] = useState(false);
  const [balance, setBalance] = useState(credits);
  const [run, setRun] = useState<ThumbnailRunView | null>(null);
  // The run whose driving stopped before it finished (connection lost):
  // shown with a way to resume, never as a silent spinner.
  const [stalled, setStalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);
  const [view, setView] = useState<{ images: { key: string; src: string }[]; index: number } | null>(null);
  const knownAssets = useRef(new Set<string>(data.initialItems.map((i) => i.assetId)));
  const folder = useRef(`thumbnail-${Math.random().toString(36).slice(2, 10)}`);
  const reserved = useRef(0);
  const inFlight = useRef(0);
  const driving = useRef<string | null>(null);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  const retouchOn = retouch && data.retouch.available;
  const quote = useMemo(() => quoteTotal({
    photos: photos.length, retouch: retouchOn, retouchUnit: data.retouch.unit, thumbnailCredits: data.thumbnailCredits ?? 0,
  }), [photos.length, retouchOn, data.retouch.unit, data.thumbnailCredits]);
  const missing = Math.max(0, quote.total - balance);
  const active = run !== null && !TERMINAL.has(run.status);

  // ── A · upload: one file after another, so the order is the order chosen ──
  const upload = useCallback(async (files: File[]) => {
    const supabase = createClient();
    const room = Math.max(0, data.maxPhotos - photos.length - reserved.current);
    if (files.length > room) toast.error(t("genv3.capReached", { max: data.maxPhotos }));
    if (room === 0) return;
    const batch = files.slice(0, room);
    reserved.current += batch.length;
    inFlight.current += 1;
    setUploading(true);
    try {
      for (const file of batch) {
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) { toast.error(t("products.invalidType")); continue; }
        if (file.size > THUMBNAIL_UPLOAD_MAX_BYTES) { toast.error(t("products.tooLarge")); continue; }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${workspaceId}/${folder.current}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("retouch.uploadFailed")); continue; }
        setPhotos((prev) => prev.length >= data.maxPhotos ? prev : [...prev, { key: path, path, url: URL.createObjectURL(file) }]);
      }
    } finally {
      reserved.current -= batch.length;
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }, [data.maxPhotos, photos.length, t, workspaceId]);

  // The photo handed over from /home ("Miniaturka" is its default tool).
  useHomeHandoff((file) => { void upload([file]); });

  const dragging = useFileDrop({
    enabled: !busy && !active,
    onDrop: (files) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      void upload(files);
    },
  });

  const move = (from: number, to: number) => setPhotos((prev) => {
    if (to < 0 || to >= prev.length) return prev;
    const next = [...prev];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  // ── results into the gallery the moment they exist ─────────────────────
  const absorb = useCallback(async (expect: number) => {
    try {
      const res = await fetch(`/api/generations?op=${THUMBNAIL_OPERATION}&limit=${Math.min(expect + 2, 24)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[] };
      if (!json.ok || !json.items) return;
      const fresh = json.items.filter((i) => !knownAssets.current.has(i.assetId));
      if (fresh.length === 0) return;
      fresh.forEach((i) => { i.fresh = true; knownAssets.current.add(i.assetId); });
      setFreshItems((prev) => [...fresh, ...prev]);
    } catch { /* the card appears on the next page load */ }
  }, []);

  const errText = useCallback((code?: string | null) => {
    if (!code) return t("common.error");
    const base = code.includes(":") ? code.split(":").pop()! : code;
    // makeT never echoes a missing key — it humanises it — so "is there a
    // translation" is asked against that fallback, not against the key.
    for (const key of [`thumb.err.${code}`, `thumb.err.${base}`, `studio.err.${base}`]) {
      const v = t(key);
      if (v && v !== key && v !== humanizeKey(key)) return v;
    }
    return t("common.error");
  }, [t]);

  // ── D · drive the run: one request at a time, a cheap poll for the view ──
  const drive = useCallback(async (runId: string) => {
    if (driving.current === runId) return;
    driving.current = runId;
    setBusy(true);
    setStalled(null);
    let stop = false;
    const poll = setInterval(async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/thumbnail/runs/${runId}`, { cache: "no-store" });
        const json = await res.json() as { ok: boolean; run?: ThumbnailRunView };
        if (json.ok && json.run && !stop) setRun(json.run);
      } catch { /* the advance call reports too */ }
    }, POLL_MS);
    let last: ThumbnailRunView | null = null;
    let misses = 0;
    try {
      for (let i = 0; i < 400; i++) {
        let json: { ok: boolean; run?: ThumbnailRunView; advanced?: string; error?: string } | null = null;
        try {
          const res = await fetch(`/api/thumbnail/runs/${runId}`, { method: "POST", cache: "no-store" });
          json = await res.json();
        } catch {
          json = null;
        }
        if (!json?.ok || !json.run) {
          if (json?.error === "not_found" || ++misses >= 8) break;
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        misses = 0;
        last = json.run;
        setRun(json.run);
        if (TERMINAL.has(json.run.status)) break;
        // Another tab drives it, or the run waits for its next slot.
        if (json.advanced === "busy" || json.advanced === "yield") await new Promise((r) => setTimeout(r, json?.advanced === "busy" ? 3000 : 600));
      }
    } finally {
      stop = true;
      clearInterval(poll);
      driving.current = null;
      setBusy(false);
    }
    if (!last) { toast.error(t("common.error")); return; }
    if (!TERMINAL.has(last.status)) { setStalled(runId); return; }
    if (last.status === "ok") {
      toast.success(t("thumb.done"));
      await absorb(1);
    } else if (last.status === "failed") {
      if (last.error === "cancelled") toast.message(t("thumb.cancelled"));
      else toast.error(errText(last.error));
    }
    // Charges happened server-side, step by step: the wallet is re-read.
    router.refresh();
  }, [absorb, errText, router, t]);

  // A run still in progress when the page was opened is picked up again.
  useEffect(() => {
    if (data.openRunId) void drive(data.openRunId);
  }, [data.openRunId, drive]);
  useEffect(() => { setBalance(credits); }, [credits]);

  const start = useCallback(async (opts?: { reuseFrom: ThumbnailRunView }) => {
    if (busy || driving.current) return;
    const source = opts?.reuseFrom;
    const paths = source ? source.photos : photos.map((p) => p.path);
    const withRetouch = source ? source.retouch : retouchOn;
    if (paths.length === 0) return;
    const reused = source && source.retouch ? source.retouchedCount : 0;
    const total = quoteTotal({
      photos: paths.length, retouch: withRetouch, retouchUnit: data.retouch.unit,
      thumbnailCredits: data.thumbnailCredits ?? 0, reused,
    }).total;
    setBusy(true);
    try {
      const res = await fetch("/api/thumbnail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: paths, retouch: withRetouch, quotedTotal: total, attempt: crypto.randomUUID(),
          ...(source ? { reuseFrom: source.id } : {}),
        }),
      });
      const json = await res.json() as { ok: boolean; runId?: string; error?: string; missingCredits?: number };
      if (!json.ok || !json.runId) {
        if (json.error === "price_changed") { toast.error(t("thumb.priceChanged")); router.refresh(); }
        else if (json.error === "insufficient_credits") toast.error(t("studio.missing", { n: json.missingCredits ?? 0 }));
        else toast.error(errText(json.error));
        setBusy(false);
        return;
      }
      setBusy(false);
      void drive(json.runId);
    } catch {
      toast.error(t("common.error"));
      setBusy(false);
    }
  }, [busy, photos, retouchOn, data.retouch.unit, data.thumbnailCredits, drive, errText, router, t]);

  async function cancel() {
    if (!run) return;
    try {
      const res = await fetch(`/api/thumbnail/runs/${run.id}/cancel`, { method: "POST" });
      const json = await res.json() as { ok: boolean; state?: string };
      if (json.ok && json.state === "requested") setRun((r) => r ? { ...r, cancelling: true } : r);
      // Closed at once (nobody was driving it): show its final state now.
      if (json.ok && (json.state === "cancelled" || json.state === "finished")) {
        const fresh = await fetch(`/api/thumbnail/runs/${run.id}`, { cache: "no-store" });
        const view = await fresh.json() as { ok: boolean; run?: ThumbnailRunView };
        if (view.ok && view.run) setRun(view.run);
        setStalled(null);
        router.refresh();
      }
    } catch { /* the next poll shows the state */ }
  }

  function reset() {
    setRun(null);
    setPhotos([]);
    folder.current = `thumbnail-${Math.random().toString(36).slice(2, 10)}`;
  }

  const canRun = data.ready && !busy && !active && !uploading && photos.length > 0 && missing === 0
    && (!retouch || data.retouch.available);
  const reusedCredits = run && run.status === "failed" && run.error !== "cancelled"
    ? quoteTotal({
        photos: run.photos.length, retouch: run.retouch, retouchUnit: data.retouch.unit,
        thumbnailCredits: data.thumbnailCredits ?? 0, reused: run.retouch ? run.retouchedCount : 0,
      }).total
    : null;

  return (
    <div className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0",
      "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )} data-thumbnail-tool>
      <DropOverlay show={dragging} title={t("thumb.dropTitle")} sub={t("thumb.dropSub")} />

      {/* ── LEFT: photos, Retusz, the price, the button ─────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          {/* A */}
          <PhotoUploader
            preview
            items={photos}
            max={data.maxPhotos}
            uploading={uploading}
            capturePaste
            compact
            zone
            onFiles={(files) => { if (!active) void upload(files); }}
            onRemove={(i) => { if (!active) setPhotos((prev) => prev.filter((_, j) => j !== i)); }}
            onMove={active ? undefined : move}
            label={t("thumb.photos", { n: data.maxPhotos })}
          />

          {/* B */}
          <section data-thumbnail-retouch className={cn(
            "rounded-xl border p-3 transition-colors",
            retouchOn ? "border-[rgb(var(--accent)/0.45)] bg-accent-soft/25" : "border-line bg-sunken/50",
          )}>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-snug tracking-tight">
                  <Wand2 size={14} aria-hidden className="shrink-0 text-accent" />
                  {t("thumb.retouchTitle")}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">{t("thumb.retouchBody")}</span>
                <span className="mt-1.5 block text-[11.5px] font-semibold tabular-nums text-accent">
                  {data.retouch.available
                    ? t("thumb.retouchPrice", { n: n(data.retouch.unit) })
                    : t("thumb.retouchUnavailable")}
                </span>
              </span>
              <Switch checked={retouchOn} onChange={setRetouch} label={t("thumb.retouchTitle")}
                disabled={!data.retouch.available || active || busy} />
            </div>
          </section>

          {/* C */}
          <section data-thumbnail-summary>
            <p className="mb-2 text-[13.5px] font-semibold tracking-tight">{t("thumb.summary.title")}</p>
            <dl className="divide-y divide-line rounded-xl bg-raised text-[12.5px]">
              <Row label={t("thumb.summary.photos")} value={n(photos.length)} />
              <Row label={t("thumb.summary.retouch")} value={retouchOn ? t("thumb.summary.on") : t("thumb.summary.off")} />
              {retouchOn && (
                <Row label={t("thumb.summary.retouchCost", { n: photos.length, unit: n(data.retouch.unit ?? 0) })}
                  value={`${n(quote.retouchCredits)} ${t("genv3.credits")}`} />
              )}
              <Row label={t("thumb.summary.thumbnailCost")}
                value={data.thumbnailCredits !== null ? `${n(data.thumbnailCredits)} ${t("genv3.credits")}` : "—"} />
              <Row strong label={t("thumb.summary.total")} value={`${n(quote.total)} ${t("genv3.credits")}`} />
            </dl>
          </section>

          {!data.ready && (
            <div className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted" data-thumbnail-unavailable>
              <p>{t("thumb.unavailable")}</p>
              {data.blockers.length > 0 && (
                <p className="mt-1.5 text-[11.5px]">
                  {t("thumb.adminBlockers")}{" "}
                  {data.blockers.map((b) => t(`thumb.blocker.${b}`)).join(" · ")}{" · "}
                  <Link href="/admin/ai/ecommerce_thumbnail" className="font-semibold text-accent hover:opacity-75">{t("thumb.configure")}</Link>
                </p>
              )}
            </div>
          )}
        </div>

        {/* D — the footer: price, balance, the one button */}
        <div className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3">
          {missing > 0 ? (
            <p className="text-center text-[11px] font-medium text-danger">
              {t("studio.missing", { n: missing })}{" · "}
              <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
            </p>
          ) : photos.length === 0 && !active ? (
            <p className="text-center text-[11px] text-muted">{t("thumb.needPhotos")}</p>
          ) : (
            <p className="text-center text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</p>
          )}
          <button type="button" disabled={!canRun} onClick={() => void start()} data-thumbnail-cta
            aria-label={`${t("thumb.cta")} · ${n(quote.total)} ${t("genv3.credits")}`}
            className={cn(
              "cta mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
              !canRun && "cursor-not-allowed opacity-55",
            )}>
            {busy || active ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            <span>{t("thumb.cta")}</span>
            {quote.total > 0 && photos.length > 0 && <><span aria-hidden className="opacity-60">•</span><span className="tabular-nums">{n(quote.total)}</span></>}
          </button>
        </div>
      </div>

      {/* ── RIGHT: the run, the result, then every Miniaturka made before ── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        {run && (
          <section className="panel mb-3 rounded-2xl p-4 sm:p-5" data-thumbnail-run={run.status}>
            {/* Working: one calm state — never how the thumbnail is made. */}
            {!TERMINAL.has(run.status) && (
              <div className="flex flex-wrap items-center gap-3" data-thumbnail-working>
                <Loader2 size={18} className="shrink-0 animate-spin text-accent" aria-hidden />
                <p className="min-w-0 flex-1 text-[14px] font-semibold tracking-tight" role="status" aria-live="polite">
                  {t("thumb.working")}
                </p>
                <button type="button" onClick={() => void cancel()} disabled={run.cancelling} data-thumbnail-cancel
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-60">
                  {run.cancelling ? t("thumb.cancelling") : t("thumb.cancel")}
                </button>
              </div>
            )}

            {stalled === run.id && !TERMINAL.has(run.status) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-[12.5px]" data-thumbnail-stalled>
                <span className="min-w-0 flex-1 text-muted">{t("thumb.connectionLost")}</span>
                <button type="button" onClick={() => void drive(run.id)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold transition-colors hover:bg-surface">
                  {t("thumb.resume")}
                </button>
              </div>
            )}

            {run.status === "ok" && run.result && (
              <div data-thumbnail-result>
                <button type="button" onClick={() => setView({ images: [{ key: "result", src: run.result!.url }], index: 0 })}
                  className="group relative block w-full max-w-[560px] overflow-hidden rounded-xl bg-white ring-1 ring-line"
                  aria-label={t("thumb.zoom")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={run.result.url} alt="" className="aspect-square h-auto w-full object-contain" />
                  <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-80 group-hover:opacity-100">
                    <Maximize2 size={14} aria-hidden />
                  </span>
                </button>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span className="font-semibold tabular-nums text-ink">
                    {t("thumb.resultSize", { w: run.result.width ?? data.target, h: run.result.height ?? data.target })}
                  </span>
                  <Link href="/library" className="inline-flex items-center gap-1 font-semibold text-accent hover:opacity-75">
                    <ImageIcon size={12} aria-hidden />{t("thumb.saved")}
                  </Link>
                </p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("thumb.qcNote")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" data-thumbnail-download
                    onClick={() => { void saveImageFrom(run.result!.url, { filename: `miniaturka-${run.result!.width ?? data.target}.png` }).catch(() => toast.error(t("common.error"))); }}
                    className="cta flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold">
                    <Download size={14} aria-hidden />{t("thumb.download")}
                  </button>
                  <button type="button" onClick={() => setView({ images: [{ key: "result", src: run.result!.url }], index: 0 })}
                    className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3.5 text-[12.5px] font-semibold text-muted hover:bg-raised hover:text-ink">
                    <Maximize2 size={14} aria-hidden />{t("thumb.zoom")}
                  </button>
                  <button type="button" onClick={reset} data-thumbnail-again
                    className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3.5 text-[12.5px] font-semibold text-muted hover:bg-raised hover:text-ink">
                    <RefreshCw size={14} aria-hidden />{t("thumb.again")}
                  </button>
                </div>
              </div>
            )}

            {run.status === "failed" && (
              <div className="rounded-xl bg-[rgb(var(--danger)/0.06)] px-3.5 py-3" data-thumbnail-error>
                <p className="text-[12.5px] font-semibold text-danger">
                  {run.error === "cancelled" ? t("thumb.cancelled") : errText(run.error)}
                </p>
                {run.retouch && run.retouchedCount > 0 && (
                  <p className="mt-1 text-[11.5px] text-muted">{t("thumb.retouchKept", { n: run.retouchedCount })}</p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {reusedCredits !== null && data.ready && (
                    <button type="button" disabled={busy} onClick={() => void start({ reuseFrom: run })} data-thumbnail-retry
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                      <RefreshCw size={12} aria-hidden />{t("thumb.retry", { n: n(reusedCredits) })}
                    </button>
                  )}
                  <button type="button" onClick={reset}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted hover:bg-raised hover:text-ink">
                    {t("thumb.again")}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <GenerationGallery
          initialItems={data.initialItems}
          initialCursor={data.initialCursor}
          freshItems={freshItems}
          onFresh={setFreshItems}
          pendingCount={0}
          pendingRatio="1:1"
          models={[]}
          balance={balance}
          onBalance={setBalance}
          onAbsorb={absorb}
          operation={THUMBNAIL_OPERATION}
          emptyTitle={t("thumb.emptyTitle")}
          emptyBody={t("thumb.emptyBody")}
        />
      </div>

      <ImageLightbox images={view?.images ?? []} index={view ? view.index : null}
        onIndex={(i) => setView((v) => v ? { ...v, index: i } : v)} onClose={() => setView(null)} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2">
      <dt className={cn("min-w-0 text-muted", strong && "font-semibold text-ink")}>{label}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "text-[13.5px] font-semibold text-accent" : "font-medium")}>{value}</dd>
    </div>
  );
}
