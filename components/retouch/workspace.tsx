"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { GenerationGallery } from "@/components/genv3/gallery";
import { Dropdown } from "@/components/ui/dropdown";
import { InfoHint } from "@/components/ui/hint";
import { RatioValue, ratioIcon, ratioName } from "@/components/genv3/ratio-options";
import { cn } from "@/lib/utils";
import type { GalleryItem, UploadedRef } from "@/components/genv3/types";

/** Photos one batch may carry. */
const MAX_PHOTOS = 10;
/** Retouches running at once: enough to feel like a batch, few enough that a
 *  provider does not see ten simultaneous requests from one seller. */
const CONCURRENCY = 2;

type JobState = {
  key: string;
  path: string;
  /** Local preview of the SOURCE, so a card can show what is being worked on. */
  url: string;
  status: "queued" | "processing" | "completed" | "failed";
  error?: string;
};

/**
 * RETUSZ ZDJĘĆ — the tool's screen.
 *
 * Deliberately simpler than the generator: photos, two settings, the price
 * and the button. No prompt (GrovBase writes it, server-side), no engine
 * picker (the customer bought a retouch, not a provider), no session type.
 *
 * Every photo is its own request, so six photos are six independent jobs:
 * one provider failure refunds and reports itself and leaves the other five
 * results alone, and its card offers a retry for that one image.
 */
export function RetouchWorkspace({
  workspaceId, credits, available, resolutions, ratios, pricing, initialItems, initialCursor,
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
  initialItems: GalleryItem[];
  initialCursor: string | null;
}) {
  const { t, locale } = useI18n();
  const [photos, setPhotos] = useState<UploadedRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [resolution, setResolution] = useState(() => (resolutions.includes("2K") ? "2K" : resolutions[0] ?? "1K"));
  const [format, setFormat] = useState("original");
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(credits);
  const [freshItems, setFreshItems] = useState<GalleryItem[]>([]);
  const knownAssets = useRef(new Set<string>(initialItems.map((i) => i.assetId)));
  const folder = useRef(`retouch-${Math.random().toString(36).slice(2, 10)}`);
  const reserved = useRef(0);
  const inFlight = useRef(0);
  const running = useRef(false);

  const perImage = pricing[resolution] ?? Object.values(pricing)[0] ?? 0;
  const total = perImage * photos.length;
  const missing = Math.max(0, total - balance);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  // ── Upload: the same three ways in as everywhere else ──────────────────
  async function upload(files: File[]) {
    const supabase = createClient();
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
    enabled: !busy,
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

  /** Retouch ONE photo. Used by the batch and by a card's own retry. */
  const retouchOne = useCallback(async (job: JobState) => {
    setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "processing", error: undefined } : j));
    try {
      const res = await fetch("/api/retouch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: job.path, resolution, format }),
      });
      const json = await res.json() as { ok: boolean; error?: string; credits?: number };
      if (json.ok) {
        setBalance((b) => Math.max(0, b - (json.credits ?? perImage)));
        await absorb(1);
        setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "completed" } : j));
        return true;
      }
      setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "failed", error: errText(json.error) } : j));
      return false;
    } catch {
      setJobs((prev) => prev.map((j) => j.key === job.key ? { ...j, status: "failed", error: t("common.error") } : j));
      return false;
    }
  }, [resolution, format, perImage, absorb, errText, t]);

  async function retouchAll() {
    // Guarded against the double click that would otherwise pay twice.
    if (running.current || photos.length === 0) return;
    running.current = true;
    setBusy(true);
    const batch: JobState[] = photos.map((p) => ({ key: `${p.path}-${Date.now()}`, path: p.path, url: p.url, status: "queued" }));
    setJobs(batch);
    let done = 0, failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < batch.length) {
        const job = batch[cursor++];
        const ok = await retouchOne(job);
        if (ok) done++; else failed++;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      if (failed > 0 && done === 0) toast.error(t("retouch.allFailed"));
      else if (failed > 0) toast.warning(t("retouch.someFailed", { n: failed }));
      else toast.success(t("retouch.done", { n: done }));
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function retry(job: JobState) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await retouchOne(job); } finally { setBusy(false); running.current = false; }
  }

  const canRun = available && !busy && !uploading && photos.length > 0 && missing === 0;
  const pending = jobs.filter((j) => j.status !== "completed");

  return (
    <div className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 pb-[var(--gen-page-bottom)] [&>*]:min-w-0",
      "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )}>
      <DropOverlay show={dragging} title={t("retouch.dropTitle")} sub={t("retouch.dropSub")} />

      {/* ── LEFT: the whole tool, in six rows ───────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          <PhotoUploader
            items={photos}
            max={MAX_PHOTOS}
            uploading={uploading}
            capturePaste
            compact
            onFiles={upload}
            onRemove={(i) => setPhotos((prev) => prev.filter((_, j) => j !== i))}
            label={t("retouch.photos", { n: MAX_PHOTOS })}
          />

          <section>
            <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
              <div className="rounded-xl border border-line bg-sunken/50 p-2">
                <Dropdown
                  testId="resolution"
                  label={t("genv3.resolution")}
                  value={resolution}
                  options={resolutions.map((r) => ({
                    value: r, label: r, meta: t("genv3.creditsShort", { n: pricing[r] ?? 0 }),
                  }))}
                  onChange={setResolution}
                  panelWidth={210}
                />
              </div>
              <div className="rounded-xl border border-line bg-sunken/50 p-2">
                <Dropdown
                  testId="format"
                  label={t("genv3.format")}
                  value={format}
                  options={[
                    {
                      value: "original",
                      label: t("retouch.formatOriginal"),
                      sub: t("retouch.formatOriginalSub"),
                      icon: <Wand2 size={13} aria-hidden />,
                    },
                    ...ratios.map((r) => ({
                      value: r, label: ratioName(t, r), meta: r, icon: ratioIcon(r),
                    })),
                  ]}
                  onChange={setFormat}
                  panelWidth={262}
                  renderValue={() => format === "original" ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Wand2 size={13} aria-hidden className="shrink-0 text-muted" />
                      <span className="min-w-0 truncate">{t("retouch.formatOriginal")}</span>
                    </span>
                  ) : <RatioValue t={t} ratio={format} />}
                />
              </div>
            </div>
          </section>

          {/* ── What the tool does, in one card. No prompt, no engine. ──── */}
          <section className="rounded-xl border border-[rgb(var(--accent)/0.3)] bg-accent-soft/25 p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
              <Sparkles size={14} aria-hidden className="text-accent" />
              {t("retouch.cardTitle")}
              <InfoHint text={t("retouch.cardHint")} />
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{t("retouch.cardBody")}</p>
          </section>

          {!available && (
            <p className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted">
              {t("retouch.unavailable")}
            </p>
          )}
        </div>

        {/* ── The footer: two figures, a hairline, the action ───────────── */}
        <div className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3">
          <div className="grid grid-cols-2 divide-x divide-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))]">
            <div className="min-w-0 px-2 text-center">
              <p className="text-[10px] font-medium leading-tight text-faint">{t("retouch.costPer")}</p>
              <p className="metric mt-0.5 text-[14px] leading-tight text-accent">
                {n(perImage)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
              </p>
            </div>
            <div className="min-w-0 px-2 text-center">
              <p className="text-[10px] font-medium leading-tight text-faint">{t("genv3.costTotal")}</p>
              <p className="metric mt-0.5 text-[14px] leading-tight text-accent">
                {n(total)} <span className="text-[10px] font-semibold text-muted">{t("genv3.credits")}</span>
              </p>
            </div>
          </div>
          {missing > 0 ? (
            <p className="mt-2 text-center text-[11px] font-medium text-danger">
              {t("studio.missing", { n: missing })}{" · "}
              <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
            </p>
          ) : photos.length === 0 ? (
            <p className="mt-2 text-center text-[11px] text-muted">{t("retouch.needPhotos")}</p>
          ) : (
            <p className="mt-2 text-center text-[10.5px] tabular-nums text-faint">{t("gtb.balance", { n: n(balance) })}</p>
          )}
          <button type="button" disabled={!canRun} onClick={retouchAll} data-retouch-cta
            aria-label={`${t("retouch.cta")} · ${n(total)} ${t("genv3.credits")}`}
            className={cn(
              "cta mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold",
              !canRun && "cursor-not-allowed opacity-55",
            )}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            <span>{t("retouch.cta")}</span>
            {total > 0 && <><span aria-hidden className="opacity-60">•</span><span className="tabular-nums">{n(total)}</span></>}
          </button>
        </div>
      </div>

      {/* ── RIGHT: the jobs in flight, then everything already retouched ── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        {pending.length > 0 && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-retouch-jobs>
            {pending.map((job) => (
              <div key={job.key} data-retouch-job={job.status}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={job.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover opacity-70" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                    {job.status !== "failed" && <Loader2 size={12} className="animate-spin text-accent" aria-hidden />}
                    {t(`retouch.status_${job.status}`)}
                  </span>
                  {job.error && <span className="mt-0.5 block text-[11px] leading-snug text-danger">{job.error}</span>}
                </span>
                {job.status === "failed" && (
                  <button type="button" onClick={() => retry(job)} disabled={busy} data-retouch-retry
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                    <RefreshCw size={12} aria-hidden />{t("retouch.retry")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

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
          emptyTitle={t("retouch.emptyTitle")}
          emptyBody={t("retouch.emptyBody")}
        />
      </div>
    </div>
  );
}
