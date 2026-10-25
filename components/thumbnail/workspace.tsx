"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { useHomeHandoff } from "@/lib/home-handoff";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { GenerationGallery } from "@/components/genv3/gallery";
import { Switch } from "@/components/ui/record";
import { cn } from "@/lib/utils";
import { humanizeKey } from "@/lib/i18n/t";
import { THUMBNAIL_OPERATION, THUMBNAIL_UPLOAD_MAX_BYTES, quoteTotal } from "@/lib/thumbnail/config";
import type { ThumbnailRuntimeData } from "@/components/category/workflow-runtime";
import type { GalleryItem, UploadedRef } from "@/components/genv3/types";
import { refSource, useToolSession } from "@/components/public-tools/use-tool-session";
import { BalanceLine, ToolDraftBanner, ToolNotice } from "@/components/public-tools/tool-notice";
import { useToolViewer } from "@/components/public-tools/tool-viewer";
import { frozenSnapshot, submitTracked } from "@/lib/inflight/store";
import { LimitNote, useInflightGate } from "@/components/inflight/use-inflight-gate";
import { limitText } from "@/components/inflight/inflight-tile";
import { reorder } from "@/components/genv3/sortable-photos";
import { useReorderHint } from "@/components/tool-guide/use-reorder-hint";

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
 * The run lives on the server (lib/server/thumbnail/run.ts), and since
 * Generacje w toku V2 the server also DRIVES it: the click that starts it
 * keeps it moving after its answer, and any status read picks it up again.
 * This screen only starts runs — each one a tile in the gallery with its
 * real stage ("Retusz zdjęć · etap 1/3") and clock, here and in the library —
 * and is free again at once: photos, their order and the Retusz choice stay
 * as they were for the next one. The click's own id makes a double submit
 * the same run.
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
  /** The click's POST, until the server answers (a second or two). */
  const [sending, setSending] = useState(false);
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);
  const knownAssets = useRef(new Set<string>(data.initialItems.map((i) => i.assetId)));
  const folder = useRef(`thumbnail-${Math.random().toString(36).slice(2, 10)}`);
  const reserved = useRef(0);
  const inFlight = useRef(0);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const gate = useInflightGate();
  const reorderHint = useReorderHint("ecommerce_thumbnail");
  useEffect(() => { if (gate.balance !== null) setBalance(gate.balance); }, [gate.balance, gate.balanceAt]);

  const retouchOn = retouch && data.retouch.available;
  const quote = useMemo(() => quoteTotal({
    photos: photos.length, retouch: retouchOn, retouchUnit: data.retouch.unit, thumbnailCredits: data.thumbnailCredits ?? 0,
  }), [photos.length, retouchOn, data.retouch.unit, data.thumbnailCredits]);
  const missing = Math.max(0, quote.total - balance);

  /*
    PUBLIC TOOLS V1. A visitor's photos (their order included) stay in the
    browser — no Storage, no run — and Generate opens the sign-in dialog. Back
    signed in, the same files go through `upload` in the same order.
  */
  const viewer = useToolViewer();
  const session = useToolSession({
    settings: { retouch },
    sources: photos.map(refSource),
    apply: (saved: { retouch?: boolean }, files: File[]) => {
      if (typeof saved.retouch === "boolean") setRetouch(saved.retouch);
      if (files.length > 0) void uploadRef.current(files);
    },
  });
  // `upload` is declared below and depends on the session; the restore calls
  // whichever version is current.
  const uploadRef = useRef<(files: File[]) => Promise<void>>(async () => undefined);

  // ── A · upload: one file after another, so the order is the order chosen ──
  const upload = useCallback(async (files: File[]) => {
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
        if (session.guest) {
          // A visitor's photo is a local stand-in: no request of any kind.
          const ref = session.localRef(file);
          setPhotos((prev) => prev.length >= data.maxPhotos ? prev : [...prev, ref]);
          session.added(1);
          continue;
        }
        const supabase = createClient();
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
  }, [data.maxPhotos, photos.length, t, workspaceId, session]);
  uploadRef.current = upload;

  // The photo handed over from /home ("Miniaturka" is its default tool).
  useHomeHandoff((file) => { void upload([file]); });

  const dragging = useFileDrop({
    enabled: true,
    onDrop: (files) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      void upload(files);
    },
  });

  // Drag & drop zdjęć V2: the order the photos are sent to the composition.
  const move = (from: number, to: number) => setPhotos((prev) => reorder(prev, from, to));

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

  useEffect(() => { setBalance(credits); }, [credits]);

  // ── D · start a run: the server takes it from here ──────────────────────
  const start = useCallback(async () => {
    if (sending) return;
    const paths = photos.map((p) => p.path);
    if (paths.length === 0) return;
    session.ran();
    setSending(true);
    try {
      const out = await submitTracked({
        // The run is these photos, in THIS order, with THIS Retusz choice —
        // frozen: a retry repeats exactly them.
        snapshot: frozenSnapshot({
          endpoint: "/api/thumbnail", credits: quote.total,
          body: { photos: paths, retouch: retouchOn, quotedTotal: quote.total },
        }),
        tool: "ecommerce_thumbnail", operation: THUMBNAIL_OPERATION, expected: 1, ratio: "1:1",
        preview: photos[0]?.url ?? null,
      });
      if (out.ok) {
        gate.flash();
        return;
      }
      if (out.error === "price_changed") { toast.error(t("thumb.priceChanged")); router.refresh(); }
      else if (out.error === "insufficient_credits") toast.error(t("studio.missing", { n: out.missingCredits ?? 0 }));
      else if (out.error === "concurrency_limit") toast.error(limitText(t, locale, out.limit ?? gate.limit?.max ?? 1));
      else toast.error(errText(out.error));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSending(false);
    }
  }, [sending, photos, retouchOn, quote.total, errText, router, t, locale, session, gate]);

  // A visitor's Generate is the sign-in dialog: their (absent) balance never greys it out.
  const canRun = data.ready && !sending && !gate.added && !gate.atLimit && !uploading && photos.length > 0
    && (session.guest || missing === 0) && (!retouch || data.retouch.available);

  return (
    <div className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0",
      "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )} data-thumbnail-tool>
      <DropOverlay show={dragging} title={t("thumb.dropTitle")} sub={t("thumb.dropSub")} />

      {/* ── LEFT: photos, Retusz, the price, the button ─────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          <ToolDraftBanner session={session} />
          {/* A */}
          <PhotoUploader
            preview
            items={photos}
            max={data.maxPhotos}
            uploading={uploading}
            capturePaste
            compact
            zone
            onFiles={(files) => { void upload(files); }}
            onRemove={(i) => { setPhotos((prev) => prev.filter((_, j) => j !== i)); }}
            onMove={move}
            reorderHint={reorderHint}
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
                disabled={!data.retouch.available} />
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
          {gate.atLimit && gate.limit && !session.guest ? (
            <LimitNote max={gate.limit.max} plan={gate.limit.plan} className="text-center text-[11px] leading-snug text-muted" />
          ) : viewer ? (
            // The status card below the button says what is missing and what
            // to do (Public Tools V1); here only the empty state and the balance.
            photos.length === 0 ? (
              <p className="text-center text-[11px] text-muted">{t("thumb.needPhotos")}</p>
            ) : (
              <p className="text-center text-[10.5px]"><BalanceLine balance={balance} /></p>
            )
          ) : missing > 0 ? (
            <p className="text-center text-[11px] font-medium text-danger">
              {t("studio.missing", { n: missing })}{" · "}
              <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
            </p>
          ) : photos.length === 0 ? (
            <p className="text-center text-[11px] text-muted">{t("thumb.needPhotos")}</p>
          ) : (
            <p className="text-center text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</p>
          )}
          <button type="button" disabled={!canRun} onClick={() => void session.gate(() => start())} data-thumbnail-cta
            aria-label={gate.added ? t("inflight.added") : `${t("thumb.cta")} · ${n(quote.total)} ${t("genv3.credits")}`}
            className={cn(
              "cta mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
              !canRun && "cursor-not-allowed opacity-55",
            )}>
            {gate.added ? <Check size={14} aria-hidden /> : sending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            {gate.added ? <span data-generate-added>{t("inflight.added")}</span> : (
              <>
                <span>{t("thumb.cta")}</span>
                {quote.total > 0 && photos.length > 0 && <><span aria-hidden className="opacity-60">•</span><span className="tabular-nums">{n(quote.total)}</span></>}
              </>
            )}
          </button>
          {viewer && photos.length > 0 && (
            <ToolNotice cost={quote.total} balance={balance} session={session} className="mt-2.5" />
          )}
        </div>
      </div>

      {/* ── RIGHT: runs in progress (tiles), then every Miniaturka made ─── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
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
          inflight={{ tools: ["ecommerce_thumbnail"] }}
          emptyTitle={t("thumb.emptyTitle")}
          emptyBody={t("thumb.emptyBody")}
        />
      </div>

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
