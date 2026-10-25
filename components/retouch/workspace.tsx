"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import { Sparkles, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { GenerationGallery } from "@/components/genv3/gallery";
import { InfoHint } from "@/components/ui/hint";
import { ratioName } from "@/components/genv3/ratio-options";
import { Segmented } from "@/components/ui/segmented";
import { FormatTiles, PanelSection, fmtDefault, useDeltaMeta } from "@/components/genv3/controls";
import { cn } from "@/lib/utils";
import type { GalleryItem, UploadedRef } from "@/components/genv3/types";
import { refSource, useToolSession } from "@/components/public-tools/use-tool-session";
import { ToolDraftBanner } from "@/components/public-tools/tool-notice";
import { frozenSnapshot } from "@/lib/inflight/store";
import { enqueueBatch } from "@/lib/inflight/queue";
import { useInflightGate } from "@/components/inflight/use-inflight-gate";
import { limitText } from "@/components/inflight/inflight-tile";
import { reorder } from "@/components/genv3/sortable-photos";
import { useFormatUses, useReorderHint } from "@/components/tool-guide/use-reorder-hint";
import { ToolColumns, ToolFrame, useToolFrameController } from "@/components/tool-frame/frame";
import { GenerateBar, useBarLine } from "@/components/generate/generate-bar";

/** Photos one batch may carry. */
const MAX_PHOTOS = 10;
/** Retouches running at once: enough to feel like a batch, few enough that a
 *  provider does not see ten simultaneous requests from one seller. */
const CONCURRENCY = 2;

/**
 * RETUSZ ZDJĘĆ — the tool's screen.
 *
 * Deliberately simpler than the generator: photos, two settings, the price
 * and the button. No prompt (GrovBase writes it, server-side), no engine
 * picker (the customer bought a retouch, not a provider), no session type.
 *
 * Every photo is its own request, so six photos are six independent jobs:
 * one provider failure refunds and reports itself and leaves the other five
 * results alone, and its tile offers a retry for that one image.
 *
 * GENERACJE W TOKU V2: a click queues its photos (two at a time, as before)
 * and the panel is free at once — each photo shows as a tile in the gallery
 * from the moment the server accepts it, with its real status and clock,
 * here and in the library.
 */
export function RetouchWorkspace({
  workspaceId, credits, available, resolutions, ratios, pricing, outputsPerRun = 1, initialItems, initialCursor,
}: {
  workspaceId: string;
  credits: number;
  /** False when no engine is configured — the panel says so instead of
   *  offering a button that cannot work. */
  available: boolean;
  resolutions: string[];
  ratios: string[];
  /** Size → credits per image, already carrying the admin's own override. */
  pricing: Record<string, number>;
  /** Results ONE run delivers: 1, or the published workflow's count when the
   *  tool runs a workflow — the price below is per run, like the charge. */
  outputsPerRun?: number;
  initialItems: GalleryItem[];
  initialCursor: string | null;
}) {
  const { t, locale } = useI18n();
  const frame = useToolFrameController();
  const formatUses = useFormatUses("retouch");
  const delta = useDeltaMeta();
  const [photos, setPhotos] = useState<UploadedRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [resolution, setResolution] = useState(() => (resolutions.includes("2K") ? "2K" : resolutions[0] ?? "1K"));
  const [format, setFormat] = useState("original");
  const [balance, setBalance] = useState(credits);
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);
  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));
  const folder = useRef(`retouch-${Math.random().toString(36).slice(2, 10)}`);
  const reserved = useRef(0);
  const inFlight = useRef(0);
  const running = useRef(false);
  const gate = useInflightGate();
  const reorderHint = useReorderHint("retouch");
  useEffect(() => { if (gate.balance !== null) setBalance(gate.balance); }, [gate.balance, gate.balanceAt]);

  const perImage = (pricing[resolution] ?? Object.values(pricing)[0] ?? 0) * Math.max(1, outputsPerRun);
  const total = perImage * photos.length;
  const missing = Math.max(0, total - balance);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  /*
    PUBLIC TOOLS V1. A visitor prepares the retouch exactly as a member does —
    the photos stay in the browser (never Storage), Generate opens the sign-in
    dialog — and once signed in the same photos go through `upload` below like
    any picked by hand. Without a viewer (no provider) nothing changes.
  */
  const session = useToolSession({
    settings: { resolution, format },
    sources: photos.map(refSource),
    apply: (saved: { resolution?: string; format?: string }, files: File[]) => {
      if (saved.resolution && resolutions.includes(saved.resolution)) setResolution(saved.resolution);
      if (saved.format && (saved.format === "original" || ratios.includes(saved.format))) setFormat(saved.format);
      if (files.length > 0) void upload(files);
    },
  });

  // ── Upload: the same three ways in as everywhere else ──────────────────
  async function upload(files: File[]) {
    const room = Math.max(0, MAX_PHOTOS - photos.length - reserved.current);
    if (files.length > room) toast.error(t("genv3.capReached", { max: MAX_PHOTOS }));
    if (room === 0) return;
    const batch = files.slice(0, room);
    reserved.current += batch.length;
    inFlight.current += 1;
    setUploading(true);
    try {
      for (const file of batch) {
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) { toast.error(t("products.invalidType")); continue; }
        if (file.size > 10 * 1024 * 1024) { toast.error(t("products.tooLarge")); continue; }
        if (session.guest) {
          // A visitor's photo is a local stand-in: no request of any kind.
          const ref = session.localRef(file);
          setPhotos((prev) => prev.length >= MAX_PHOTOS ? prev : [...prev, ref]);
          session.added(1);
          continue;
        }
        const supabase = createClient();
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${workspaceId}/${folder.current}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { toast.error(t("retouch.uploadFailed")); continue; }
        setPhotos((prev) => prev.length >= MAX_PHOTOS ? prev : [...prev, { key: path, path, url: URL.createObjectURL(file) }]);
      }
    } finally {
      reserved.current -= batch.length;
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }

  const dragging = useFileDrop({
    enabled: true,
    onDrop: (files) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      void upload(files);
    },
  });

  /** Pull the freshly stored results into the gallery the moment they exist. */
  const absorb = useCallback(async (expect: number) => {
    try {
      const res = await fetch(`/api/generations?op=image_retouch&limit=${Math.min(expect + 2, 24)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[] };
      if (!json.ok || !json.items) return;
      const fresh = json.items.filter((i) => !knownAssets.current.has(i.assetId));
      if (fresh.length === 0) return;
      fresh.forEach((i) => { i.fresh = true; knownAssets.current.add(i.assetId); });
      setFreshItems((prev) => [...fresh, ...prev]);
    } catch { /* the card appears on the next page load */ }
  }, []);

  const errText = useCallback((code?: string) => {
    const known = code ? t(`studio.err.${code}`, {}) : "";
    return known && known !== `studio.err.${code}` ? known : t("common.error");
  }, [t]);

  /**
   * ONE CLICK: every photo becomes its own job, queued two at a time. The
   * request of each photo is frozen here — the size, format and photo of
   * THIS click — so a later change in the panel never reaches it, and a
   * tile's "Spróbuj ponownie" repeats exactly that photo.
   */
  function retouchAll() {
    // Guarded against the double click that would otherwise pay twice.
    if (running.current || photos.length === 0) return;
    running.current = true;
    session.ran();
    let refused = false;
    let shown = false;
    enqueueBatch({
      maxInFlight: CONCURRENCY,
      items: photos.map((p) => ({
        snapshot: frozenSnapshot({
          endpoint: "/api/retouch", credits: perImage,
          body: { sourcePath: p.path, resolution, format, expectedOutputs: outputsPerRun },
        }),
        tool: "retouch", operation: "image_retouch", expected: Math.max(1, outputsPerRun),
        ratio: format === "original" ? null : format, preview: p.url,
      })),
      onAccepted: (out) => {
        setBalance((b) => Math.max(0, b - (out.credits || perImage)));
        if (!shown) { shown = true; frame.accepted(); }
      },
      onRefused: (out) => {
        if (refused) return;
        refused = true;
        toast.error(out.error === "concurrency_limit"
          ? limitText(t, locale, out.limit ?? gate.limit?.max ?? 1)
          : errText(out.error));
      },
    });
    gate.flash();
    // A short lock, not a wait: the next click is possible a moment later.
    setTimeout(() => { running.current = false; }, 600);
  }

  // A visitor's Generate is always the sign-in dialog, so their balance (none)
  // does not grey it out; a member's is the server-checked wallet, as before.
  const canRun = available && !gate.atLimit && !uploading && photos.length > 0 && (session.guest || missing === 0);
  const line = useBarLine({
    unavailable: !available ? t("retouch.unavailable") : null,
    invalid: photos.length === 0 ? t("retouch.needPhotos") : uploading ? t("bar.uploading") : null,
    limit: gate.atLimit && gate.limit && !session.guest ? gate.limit : null,
    cost: total, balance, session,
  });
  const recommendedRes = resolutions.includes("2K") ? "2K" : resolutions[0] ?? "";
  const priceAt = (r: string) => (pricing[r] ?? 0) * Math.max(1, outputsPerRun);

  return (
    <ToolFrame frame={frame} tools={["retouch"]} back={{ href: "/tools", label: t("nav.allTools") }}
      title={<h1 className="truncate text-[15px] font-semibold tracking-tight">{t("retouch.title")}</h1>}>
      <ToolColumns
        cols="lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)]"
        overlay={<DropOverlay show={dragging} title={t("retouch.dropTitle")} sub={t("retouch.dropSub")} />}
        panel={(
          <>
            <ToolDraftBanner session={session} />
            <PhotoUploader
              preview
              items={photos}
              max={MAX_PHOTOS}
              uploading={uploading}
              capturePaste
              compact
              zone
              onFiles={upload}
              onRemove={(i) => setPhotos((prev) => prev.filter((_, j) => j !== i))}
              // The order the batch is sent in (and the guest draft keeps).
              onMove={(from, to) => setPhotos((prev) => reorder(prev, from, to))}
              reorderHint={reorderHint}
              label={t("retouch.photos", { n: MAX_PHOTOS })}
            />

            {/* ── What the tool does: one line of copy, no card. ─────────── */}
            <section data-retouch-what>
              <p className="flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
                <Sparkles size={14} aria-hidden className="text-accent" />
                {t("retouch.cardTitle")}
                <InfoHint text={t("retouch.cardHint")} />
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{t("retouch.cardBody")}</p>
            </section>

            {/* The two settings, as they are offered — the delivered file's
                size and shape only (lib/server/retouch-delivery.ts); nothing
                here reaches the request sent to the model. */}
            <PanelSection title={t("genv3.resolution")} data="resolution">
              <Segmented label={t("genv3.resolution")} value={resolution}
                onChange={(v) => { setResolution(v); session.touched(); }}
                options={resolutions.map((r) => ({ value: r, label: r, meta: delta(priceAt(r), priceAt(recommendedRes), r === recommendedRes) }))} />
            </PanelSection>
            <PanelSection title={t("genv3.format")} data="format">
              <FormatTiles label={t("genv3.format")} value={format}
                onChange={(v) => { setFormat(v); session.touched(); }}
                options={[
                  { value: "original", label: t("retouch.formatOriginal"), icon: <Wand2 size={16} aria-hidden />,
                    use: formatUses?.original ?? fmtDefault(t, "original") ?? t("retouch.formatOriginalSub") },
                  ...ratios.map((r) => ({ value: r, ratio: r, label: ratioName(t, r), use: formatUses?.[r] ?? fmtDefault(t, r) })),
                ]} />
            </PanelSection>
          </>
        )}
        bar={(
          <GenerateBar
            label={t("retouch.cta")}
            total={total}
            breakdown={[t("bar.photos", { n: n(photos.length), p: n(perImage) })]}
            state={gate.added ? "added" : "idle"}
            blocked={!canRun}
            onGenerate={() => void session.gate(retouchAll)}
            line={line}
            ctaAttrs={{ "data-retouch-cta": true }}
          />
        )}
        gallery={(
          <GenerationGallery
            initialItems={initialItems}
            initialCursor={initialCursor}
            freshItems={freshItems}
            onFresh={setFreshItems}
            pendingCount={0}
            pendingRatio="1:1"
            models={[]}
            balance={balance}
            onBalance={setBalance}
            onAbsorb={absorb}
            operation="image_retouch"
            inflight={{ tools: ["retouch"] }}
            emptyTitle={t("retouch.emptyTitle")}
            emptyBody={t("retouch.emptyBody")}
          />
        )}
      />
    </ToolFrame>
  );
}
