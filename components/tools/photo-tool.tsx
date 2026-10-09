"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Columns2, Download, FlaskConical, Library, Loader2, RefreshCw, Sparkles, TriangleAlert,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { saveImageFrom } from "@/lib/save-image";
import {
  AI_BACKGROUND_GUIDANCE_DEFAULT, AI_SHADOW_STYLES, BACKGROUND_PROMPT_MAX, COLOR_PALETTE,
  PHOTO_MAX_BYTES, PHOTO_MAX_PHOTOS,
  type AiShadowBackground, type AiShadowStyle, type PhotoToolSlug,
} from "@/lib/images/tools";
import type { PhotoResult } from "@/lib/server/photo-tools";
import { PhotoUploader, DropOverlay, useFileDrop } from "@/components/genv3/uploader";
import { Modal } from "@/components/ui/modal";
import { InfoHint } from "@/components/ui/hint";
import { CostIsland, GroupLabel, RadioRows, type RadioRow } from "@/components/tools/panel-parts";
import { Compare } from "@/components/tools/compare";
import type { UploadedRef } from "@/components/genv3/types";

/** Photos running at once — Retusz's figure: a batch, not ten simultaneous
 *  requests from one seller (Photoroom's own default is 60 a minute). */
const CONCURRENCY = 2;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const HEX_RE = /^#[0-9a-f]{6}$/i;
/** A scene typed by the seller instead of a preset. */
const CUSTOM = "__custom";

type Format = "png" | "jpeg" | "webp";

/** The formats each tool offers. A cutout keeps its alpha, so no JPEG there. */
const FORMATS: Record<PhotoToolSlug, Format[]> = {
  remove_bg: ["png", "webp"],
  white_bg: ["png", "jpeg", "webp"],
  ai_background: ["png", "jpeg", "webp"],
  ai_shadow: ["png", "jpeg", "webp"],
};

/** Codes the panel has its own sentence for, then the ones the shared tool
 *  vocabulary already translates. Anything else is the generic failure — a
 *  raw code never reaches the screen. */
const PANEL_ERRORS = new Set([
  "duplicate_request", "provider_sandbox", "provider_unsupported_params", "prompt_required",
  "preset_unavailable", "rate_limited", "storage_failed", "source_missing", "feature_unavailable",
  "provider_empty_result", "provider_error", "network_error",
]);
const TOOL_ERRORS = new Set([
  "insufficient_credits", "no_provider", "image_too_large", "unsupported_format", "unreadable_image",
  "provider_auth_failed", "provider_out_of_credit", "provider_rate_limited", "provider_timeout",
  "provider_unreachable", "tool_unavailable", "processing_failed",
]);

type JobState = {
  key: string;
  path: string;
  /** Local preview of the SOURCE, so a card shows what is being worked on. */
  url: string;
  status: "queued" | "processing" | "completed" | "failed";
  error?: string;
  /** One per press of the button; a retry of this photo reuses it, so a
   *  request whose answer was lost can never be paid for twice. */
  attempt: string;
  /** The settings of the press, frozen: a retry repeats what was asked. */
  settings: Record<string, unknown>;
  guidancePath: string | null;
};

type RunResponse = {
  ok: boolean;
  error?: string;
  /** The press had already delivered: this is that stored result, not a new run. */
  recovered?: boolean;
  credits?: number;
  environment?: "live" | "sandbox" | "local";
  result?: { id: string; url: string | null; width: number; height: number; mime: string; bytes: number };
};

/**
 * THE FOUR PHOTO TOOLS — one screen each: Usuń tło, Zmień kolor tła, Dodaj
 * tło AI, Dodaj cień.
 *
 * Retusz's shell and rhythm (photos, the tool's own few settings, the price,
 * the button, then the results), with nothing of its machinery: every photo is
 * its own request to `/api/tools/photo`, which picks the provider, prices it,
 * charges, refunds on failure and stores the result before answering. So a
 * refresh or a dropped connection never loses a paid image — it is already in
 * the history below and in the Library.
 */
export function PhotoToolWorkspace({
  tool, workspaceId, available, reason, environment, credits, freeWhenTransparent, balance: initialBalance,
  presets, initialItems, initialCursor,
}: {
  tool: PhotoToolSlug;
  workspaceId: string;
  /** False when the tool cannot run for this viewer — the panel says why. */
  available: boolean;
  reason: "ok" | "no_provider" | "maintenance" | "disabled" | "sandbox";
  /** "sandbox": an operator testing with a Photoroom test key (0 credits,
   *  watermarked results, never shown as a product). */
  environment: "live" | "sandbox" | null;
  /** Credits for one photo, as the server will charge them. */
  credits: number;
  /** "Zmień kolor tła": a photo that is already cut out is recoloured
   *  locally, for free. */
  freeWhenTransparent: boolean;
  balance: number;
  /** Preset NAMES — their prompts never leave the server. */
  presets: { key: string; label: string }[];
  initialItems: PhotoResult[];
  initialCursor: string | null;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  // ── photos ────────────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<UploadedRef[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Per uploaded path: does the photo already have a transparent background? */
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const reserved = useRef(0);
  const inFlight = useRef(0);
  /** Every local preview this screen made, released when it closes. */
  const previews = useRef(new Set<string>());
  const preview = (file: File) => {
    const url = URL.createObjectURL(file);
    previews.current.add(url);
    return url;
  };
  const release = (url: string | undefined) => {
    if (url && previews.current.delete(url)) URL.revokeObjectURL(url);
  };
  useEffect(() => {
    const all = previews.current;
    return () => { all.forEach((u) => URL.revokeObjectURL(u)); all.clear(); };
  }, []);

  // ── settings ──────────────────────────────────────────────────────────
  const [format, setFormat] = useState<Format>("png");
  const [color, setColor] = useState("#FFFFFF");
  const [hexDraft, setHexDraft] = useState("#FFFFFF");
  const [scene, setScene] = useState<string>(() => presets[0]?.key ?? CUSTOM);
  const [prompt, setPrompt] = useState("");
  const [guidance, setGuidance] = useState<UploadedRef | null>(null);
  const [guidanceUploading, setGuidanceUploading] = useState(false);
  const [strength, setStrength] = useState(AI_BACKGROUND_GUIDANCE_DEFAULT);
  const [shadowStyle, setShadowStyle] = useState<AiShadowStyle>("soft");
  const [shadowBg, setShadowBg] = useState<AiShadowBackground>("white");

  // ── runs and results ──────────────────────────────────────────────────
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(initialBalance);
  const [items, setItems] = useState<PhotoResult[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewing, setViewing] = useState<PhotoResult | null>(null);
  const known = useRef(new Set(initialItems.map((i) => i.id)));
  /** Jobs whose credits are already off the displayed balance — so a result
   *  found twice (an answer and a recovery) is never subtracted twice. */
  const charged = useRef(new Set<string>());
  const running = useRef(false);

  // The test-key notice is for an operator who can actually run it.
  const sandbox = available && environment === "sandbox";
  const jpegOff = tool === "ai_shadow" && shadowBg === "transparent";
  const effectiveFormat: Format = jpegOff && format === "jpeg" ? "png" : format;
  const usesColor = tool === "white_bg" || (tool === "ai_shadow" && shadowBg === "color");
  // What the field SAYS is what is checked: a half-typed HEX blocks the run
  // instead of quietly running the last valid colour.
  const colorOk = HEX_RE.test(hexDraft);
  const custom = scene === CUSTOM;
  const promptOk = tool !== "ai_background" || !custom || prompt.trim().length >= 3;

  // The free path is the SERVER's decision; this estimate only keeps the
  // displayed total honest, with the same rule (≥5% of a 256 px proxy clear).
  const paidCount = tool === "white_bg" && freeWhenTransparent
    ? photos.filter((p) => !clear[p.path]).length
    : photos.length;
  const freeCount = photos.length - paidCount;
  const total = credits * paidCount;
  const missing = Math.max(0, total - balance);

  const errText = useCallback((code?: string) => {
    if (code && PANEL_ERRORS.has(code)) return t(`photoTool.err.${code}`);
    if (code && TOOL_ERRORS.has(code)) return t(`tools.err.${code}`);
    return t("tools.err.processing_failed");
  }, [t]);

  // ── upload: the same three ways in as Retusz (pick, drop, paste) ──────
  async function upload(files: File[]) {
    const supabase = createClient();
    const room = Math.max(0, PHOTO_MAX_PHOTOS - photos.length - reserved.current);
    if (files.length > room) toast.error(t("genv3.capReached", { max: PHOTO_MAX_PHOTOS }));
    if (room === 0) return;
    const batch = files.slice(0, room);
    reserved.current += batch.length;
    inFlight.current += 1;
    setUploading(true);
    try {
      for (const file of batch) {
        if (!ACCEPTED.includes(file.type)) { toast.error(t("products.invalidType")); continue; }
        if (file.size > PHOTO_MAX_BYTES) { toast.error(t("products.tooLarge")); continue; }
        const path = await store(supabase, file);
        if (!path) { toast.error(t("photoTool.uploadFailed")); continue; }
        if (tool === "white_bg") {
          const isClear = await hasRealTransparency(file);
          setClear((prev) => ({ ...prev, [path]: isClear }));
        }
        setPhotos((prev) => prev.length >= PHOTO_MAX_PHOTOS ? prev : [...prev, { key: path, path, url: preview(file) }]);
      }
    } finally {
      reserved.current -= batch.length;
      inFlight.current -= 1;
      if (inFlight.current === 0) setUploading(false);
    }
  }

  async function store(supabase: ReturnType<typeof createClient>, file: File): Promise<string | null> {
    const ext = (file.name.split(".").pop()?.toLowerCase() || "jpg").replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${workspaceId}/photo-tools/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    return error ? null : path;
  }

  async function uploadGuidance(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) { toast.error(t("products.invalidType")); return; }
    if (file.size > PHOTO_MAX_BYTES) { toast.error(t("products.tooLarge")); return; }
    setGuidanceUploading(true);
    try {
      const path = await store(createClient(), file);
      if (!path) { toast.error(t("photoTool.uploadFailed")); return; }
      release(guidance?.url);
      setGuidance({ key: path, path, url: preview(file) });
    } finally {
      setGuidanceUploading(false);
    }
  }

  const dragging = useFileDrop({
    enabled: available && !busy,
    onDrop: (files, event) => {
      if (files.length === 0) { toast.error(t("products.invalidType")); return; }
      // A drop on the inspiration block is the inspiration; anywhere else it
      // is a product photo.
      const target = (event.target as Element | null)?.closest?.("[data-drop-target]");
      if (tool === "ai_background" && target?.getAttribute("data-drop-target") === "guidance") {
        void uploadGuidance(files);
        return;
      }
      void upload(files);
    },
  });

  // ── settings as the server reads them ─────────────────────────────────
  function currentSettings(): Record<string, unknown> {
    switch (tool) {
      case "remove_bg": return { format: effectiveFormat };
      case "white_bg": return { color: color.toUpperCase(), padding: 0, format: effectiveFormat, quality: 92 };
      case "ai_background": return {
        preset: custom ? "" : scene,
        prompt: custom ? prompt.replace(/\s+/g, " ").trim().slice(0, BACKGROUND_PROMPT_MAX) : "",
        guidance: strength,
        format: effectiveFormat,
      };
      case "ai_shadow": return { style: shadowStyle, background: shadowBg, color: color.toUpperCase(), format: effectiveFormat };
    }
  }

  // ── history ───────────────────────────────────────────────────────────
  /** Pull the newest page, show what this screen has not shown yet, and
   *  return the WHOLE page — a recovery looks for its press in all of it, not
   *  only in what is new to this screen (another photo's lookup may have
   *  added it a moment ago). */
  const refreshHead = useCallback(async (): Promise<PhotoResult[]> => {
    try {
      const res = await fetch(`/api/tools/photo?tool=${tool}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: PhotoResult[] };
      if (!json.ok || !json.items) return [];
      const fresh = json.items.filter((i) => !known.current.has(i.id));
      if (fresh.length > 0) {
        fresh.forEach((i) => known.current.add(i.id));
        setItems((prev) => [...fresh, ...prev]);
      }
      return json.items;
    } catch {
      return [];
    }
  }, [tool]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/tools/photo?tool=${tool}&before=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: PhotoResult[]; nextCursor?: string | null };
      if (!json.ok || !json.items) { toast.error(t("common.error")); return; }
      const older = json.items.filter((i) => !known.current.has(i.id));
      older.forEach((i) => known.current.add(i.id));
      setItems((prev) => [...prev, ...older]);
      setCursor(json.nextCursor ?? null);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoadingMore(false);
    }
  }

  // ── one photo ─────────────────────────────────────────────────────────
  const update = (key: string, patch: Partial<JobState>) =>
    setJobs((prev) => prev.map((j) => j.key === key ? { ...j, ...patch } : j));

  /** Take a job's credits off the displayed balance — once per job. */
  const charge = useCallback((job: JobState, credits: number | null | undefined) => {
    if (charged.current.has(job.key)) return;
    charged.current.add(job.key);
    if (credits) setBalance((b) => Math.max(0, b - credits));
  }, []);

  /** Did a request whose answer never arrived still deliver? The history is
   *  the truth: a result made from this photo BY THIS PRESS means yes. */
  const recovered = useCallback(async (job: JobState) => {
    const page = await refreshHead();
    const hit = page.find((i) => i.sourcePath === job.path && i.attempt === job.attempt);
    if (hit) charge(job, hit.credits);
    return !!hit;
  }, [refreshHead, charge]);

  const runOne = useCallback(async (job: JobState): Promise<boolean> => {
    update(job.key, { status: "processing", error: undefined });
    let json: RunResponse;
    try {
      const res = await fetch("/api/tools/photo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool, sourcePath: job.path, settings: job.settings,
          guidancePath: job.guidancePath, attempt: job.attempt,
        }),
      });
      json = await res.json() as RunResponse;
    } catch {
      // The connection dropped — the run may still have finished on the
      // server. Look before offering a retry that could pay twice.
      if (await recovered(job)) { update(job.key, { status: "completed" }); return true; }
      update(job.key, { status: "failed", error: errText("network_error") });
      return false;
    }
    if (json.ok && json.result) {
      // A recovered press was paid for by its first request, whose answer
      // never reached this screen — so it comes off the balance here, once.
      charge(job, json.credits);
      const r = json.result;
      if (!known.current.has(r.id)) {
        known.current.add(r.id);
        setItems((prev) => [{
          id: r.id, tool, url: r.url, thumbUrl: r.url, sourceUrl: job.url, sourcePath: job.path, attempt: job.attempt,
          width: r.width, height: r.height, mime: r.mime, bytes: r.bytes,
          createdAt: new Date().toISOString(), environment: json.environment ?? "live",
          credits: json.credits ?? 0, settings: summary(tool, job.settings), uncertainty: null,
        }, ...prev]);
      }
      update(job.key, { status: "completed" });
      return true;
    }
    if (json.error === "duplicate_request" && await recovered(job)) {
      update(job.key, { status: "completed" });
      return true;
    }
    update(job.key, { status: "failed", error: errText(json.error) });
    return false;
  }, [tool, errText, recovered, charge]);

  async function runAll() {
    // Guarded against the double click that would otherwise pay twice.
    if (running.current || photos.length === 0) return;
    running.current = true;
    setBusy(true);
    const attempt = crypto.randomUUID();
    const settings = currentSettings();
    const guidancePath = tool === "ai_background" ? guidance?.path ?? null : null;
    const batch: JobState[] = photos.map((p) => ({
      key: `${p.path}-${attempt}`, path: p.path, url: p.url, status: "queued", attempt, settings, guidancePath,
    }));
    setJobs(batch);
    let done = 0, failed = 0, cursorAt = 0;
    const worker = async () => {
      while (cursorAt < batch.length) {
        const job = batch[cursorAt++];
        if (await runOne(job)) done++; else failed++;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      if (failed > 0 && done === 0) toast.error(t("photoTool.allFailed"));
      else if (failed > 0) toast.warning(t("photoTool.someFailed", { n: failed }));
      else toast.success(t("photoTool.done", { n: done }));
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function retry(job: JobState) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      // Look first: the "failed" press may have delivered after all. The
      // server checks too (same token), so even a miss here cannot pay twice.
      if (await recovered(job)) { update(job.key, { status: "completed", error: undefined }); return; }
      await runOne(job);
    } finally { setBusy(false); running.current = false; }
  }

  async function download(item: PhotoResult) {
    if (!item.url) return;
    try {
      await saveImageFrom(item.url, { seed: t(`photoTool.suffix.${tool}`) });
    } catch {
      toast.error(t("photoTool.downloadFailed"));
    }
  }

  // ── what stops the button, in words ───────────────────────────────────
  const blocker = !available ? null
    : photos.length === 0 ? t("photoTool.needPhotos")
      : usesColor && !colorOk ? t("photoTool.needColor")
        : !promptOk ? t("photoTool.needPrompt")
          : missing > 0 ? t("studio.missing", { n: missing })
            : null;
  const canRun = available && !busy && !uploading && !guidanceUploading && photos.length > 0
    && (!usesColor || colorOk) && promptOk && missing === 0;
  const status = !available ? null : blocker
    ?? (freeCount > 0 ? t("photoTool.freeNote", { n: freeCount, total: photos.length }) : null)
    ?? (photos.length > 0 ? t("photoTool.balance", { n: n(balance) }) : null);
  const pending = jobs.filter((j) => j.status !== "completed");
  const progress = jobs.length > 0 ? jobs.filter((j) => j.status === "completed" || j.status === "failed").length : 0;

  const formatRows: RadioRow<Format>[] = FORMATS[tool].map((f) => ({
    value: f,
    label: t(`photoTool.fmt.${f}`),
    meta: t(`photoTool.fmtMeta.${f}`),
    ...(f === "jpeg" && jpegOff ? { disabledReason: t("photoTool.jpegNoAlpha") } : {}),
  }));

  return (
    <div className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0",
      "lg:grid-cols-[clamp(380px,27vw,430px)_minmax(0,1fr)] lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
    )} data-photo-tool={tool}>
      <DropOverlay show={dragging} title={t("photoTool.dropTitle")} sub={t("photoTool.dropSub", { n: PHOTO_MAX_PHOTOS })} />

      {/* ── LEFT: the tool ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="panel thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:pb-6">
          <header>
            <Link href="/tools"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink">
              <ArrowLeft size={13} aria-hidden /> {t("nav.allTools")}
            </Link>
            <h1 className="mt-1.5 font-display text-[19px] font-semibold tracking-tight">{t(`photoTool.name.${tool}`)}</h1>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t(`photoTool.body.${tool}`)}</p>
          </header>

          {sandbox && (
            <p className="flex gap-2 rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-3 py-2.5 text-[11.5px] leading-relaxed" data-photo-sandbox>
              <FlaskConical size={14} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              <span>{t("photoTool.sandboxNote")}</span>
            </p>
          )}

          {!available && (
            <p className="rounded-xl bg-raised px-3.5 py-3 text-[12px] leading-relaxed text-muted" data-photo-unavailable>
              {t(`tools.unavailable.${reason === "ok" ? "maintenance" : reason}`)}
            </p>
          )}

          {available && <PhotoUploader
            preview
            items={photos}
            max={PHOTO_MAX_PHOTOS}
            uploading={uploading}
            capturePaste
            compact
            zone
            dropTarget="photos"
            onFiles={upload}
            onRemove={(i) => {
              // A preview still shown by a job card or a comparison stays
              // alive until the screen closes.
              const gone = photos[i];
              if (gone && !jobs.some((j) => j.url === gone.url) && !items.some((it) => it.sourceUrl === gone.url)) release(gone.url);
              setPhotos((prev) => prev.filter((_, j) => j !== i));
            }}
            label={t("photoTool.photos", { n: PHOTO_MAX_PHOTOS })}
          />}

          {tool === "white_bg" && (
            <ColorPicker label={t("photoTool.color")} color={color} draft={hexDraft}
              onPick={(c) => { setColor(c); setHexDraft(c); }}
              onDraft={(v) => { setHexDraft(v); if (HEX_RE.test(v)) setColor(v.toUpperCase()); }} />
          )}

          {tool === "ai_background" && (
            <>
              <section>
                <GroupLabel>{t("photoTool.scene")}</GroupLabel>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("photoTool.scene")}>
                  {presets.map((p) => (
                    <SceneChip key={p.key} active={scene === p.key} onClick={() => setScene(p.key)}>{p.label}</SceneChip>
                  ))}
                  <SceneChip active={custom} onClick={() => setScene(CUSTOM)}>{t("photoTool.custom")}</SceneChip>
                </div>
                {presets.length === 0 && <p className="mt-1.5 text-[11px] text-faint">{t("photoTool.noPresets")}</p>}
                {custom && (
                  <div className="mt-2.5">
                    <label htmlFor="photo-tool-prompt" className="mb-1 flex items-center justify-between gap-2 text-[12px] font-semibold">
                      <span className="flex items-center gap-1">{t("photoTool.promptLabel")}<InfoHint text={t("photoTool.promptHint")} /></span>
                      <span className="text-[11px] font-normal tabular-nums text-faint">{prompt.length} / {BACKGROUND_PROMPT_MAX}</span>
                    </label>
                    <textarea id="photo-tool-prompt" value={prompt} maxLength={BACKGROUND_PROMPT_MAX} rows={3}
                      onChange={(e) => setPrompt(e.target.value)} placeholder={t("photoTool.promptPh")}
                      className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.6)]" />
                  </div>
                )}
              </section>

              {available && <section data-drop-target="guidance">
                <PhotoUploader
                  items={guidance ? [guidance] : []}
                  max={1}
                  uploading={guidanceUploading}
                  compact
                  counter={false}
                  dropTarget="guidance"
                  onFiles={uploadGuidance}
                  onRemove={() => { release(guidance?.url); setGuidance(null); }}
                  label={<span className="flex items-center gap-1">{t("photoTool.inspiration")}<InfoHint text={t("photoTool.inspirationHint")} /></span>}
                />
                {guidance && (
                  <div className="mt-2">
                    <GroupLabel hint={`${Math.round(strength * 100)}%`}>{t("photoTool.strength")}</GroupLabel>
                    <input type="range" min={0} max={100} step={5} value={Math.round(strength * 100)}
                      aria-label={t("photoTool.strength")}
                      onChange={(e) => setStrength(Number(e.target.value) / 100)}
                      className="w-full accent-[rgb(var(--accent))]" />
                  </div>
                )}
              </section>}
            </>
          )}

          {tool === "ai_shadow" && (
            <>
              <section>
                <GroupLabel>{t("photoTool.shadowStyle")}</GroupLabel>
                <RadioRows name="photo-shadow-style" value={shadowStyle} onChange={setShadowStyle}
                  rows={AI_SHADOW_STYLES.map((s) => ({ value: s, label: t(`photoTool.shadow.${s}`), meta: t(`photoTool.shadowMeta.${s}`) }))} />
              </section>
              <section>
                <GroupLabel>{t("photoTool.background")}</GroupLabel>
                <RadioRows name="photo-shadow-bg" value={shadowBg} onChange={setShadowBg}
                  rows={(["white", "transparent", "color"] as const).map((b) => ({ value: b, label: t(`photoTool.bg.${b}`) }))} />
                {shadowBg === "color" && (
                  <div className="mt-2.5">
                    <ColorPicker label={t("photoTool.color")} color={color} draft={hexDraft}
                      onPick={(c) => { setColor(c); setHexDraft(c); }}
                      onDraft={(v) => { setHexDraft(v); if (HEX_RE.test(v)) setColor(v.toUpperCase()); }} />
                  </div>
                )}
              </section>
            </>
          )}

          <section>
            <GroupLabel>{t("photoTool.format")}</GroupLabel>
            <RadioRows name="photo-format" value={effectiveFormat} onChange={setFormat} rows={formatRows} />
          </section>

          {tool === "white_bg" && freeWhenTransparent && (
            <p className="text-[11px] leading-relaxed text-faint">{t("photoTool.freeHint")}</p>
          )}

        </div>

        {/* ── The footer: price per photo, total, why not, the action ───── */}
        {!available ? (
          // No price on a tool that cannot run: "0 credits" would read as free.
          <div data-cost-island className="panel relative z-20 shrink-0 rounded-2xl px-4 py-3 lg:shadow-e2">
            <button type="button" disabled data-photo-cta
              className="cta flex h-11 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl px-3 text-[13.5px] font-semibold opacity-55">
              <Sparkles size={14} aria-hidden /><span>{t(`photoTool.cta.${tool}`)}</span>
            </button>
          </div>
        ) : (
        <CostIsland perImage={credits} count={paidCount} enough={missing === 0} status={status}>
          {missing > 0 && (
            <p className="-mt-1 mb-2 text-center text-[11px]">
              <Link href="/credits" className="font-semibold text-accent hover:opacity-75">{t("credits.topup")}</Link>
            </p>
          )}
          <button type="button" disabled={!canRun} onClick={runAll} data-photo-cta
            aria-label={`${t(`photoTool.cta.${tool}`)} · ${n(total)} ${t("genv3.credits")}`}
            className={cn(
              "cta flex h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13.5px] font-semibold",
              !canRun && "cursor-not-allowed opacity-55",
            )}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            <span>{busy && jobs.length > 0 ? t("tools.progress", { done: progress, total: jobs.length }) : t(`photoTool.cta.${tool}`)}</span>
            {!busy && total > 0 && <><span aria-hidden className="opacity-60">•</span><span className="tabular-nums">{n(total)}</span></>}
          </button>
        </CostIsland>
        )}
      </div>

      {/* ── RIGHT: what is running, then everything already made ─────────── */}
      <div className="thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1">
        {pending.length > 0 && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-photo-jobs>
            {pending.map((job) => (
              <div key={job.key} data-photo-job={job.status}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={job.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover opacity-70" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                    {job.status !== "failed" && <Loader2 size={12} className="animate-spin text-accent" aria-hidden />}
                    {t(`photoTool.status_${job.status}`)}
                  </span>
                  {job.error && <span className="mt-0.5 block text-[11px] leading-snug text-danger">{job.error}</span>}
                </span>
                {job.status === "failed" && (
                  <button type="button" onClick={() => retry(job)} disabled={busy} data-photo-retry
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                    <RefreshCw size={12} aria-hidden />{t("photoTool.retry")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-10 text-center lg:h-full">
            <Sparkles size={20} aria-hidden className="text-faint" />
            <p className="mt-2 text-[14px] font-semibold">{t("photoTool.emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted">{t("photoTool.emptyBody")}</p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
              <h2 className="text-[13px] font-semibold">{t("photoTool.results")}</h2>
              <Link href="/library?tab=tools" className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink">
                <Library size={13} aria-hidden />{t("photoTool.inLibrary")}
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" data-photo-results>
              {items.map((item) => (
                <ResultCard key={item.id} item={item} tool={tool}
                  onOpen={() => setViewing(item)} onDownload={() => download(item)} />
              ))}
            </ul>
            {cursor && (
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={loadMore} disabled={loadingMore}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-4 text-[12.5px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                  {loadingMore && <Loader2 size={13} className="animate-spin" aria-hidden />}
                  {t("photoTool.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={t(`photoTool.name.${tool}`)} wide>
        {viewing && (
          <div className="space-y-3">
            {viewing.environment === "sandbox" && (
              <p className="text-[11.5px] text-warning">{t("photoTool.sandboxResult")}</p>
            )}
            {viewing.url && viewing.sourceUrl
              ? <Compare before={viewing.sourceUrl} after={viewing.url} alt={t(`photoTool.name.${tool}`)} />
              : viewing.url && (
                <div className="overflow-hidden rounded-xl bg-checker">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={viewing.url} alt={t(`photoTool.name.${tool}`)} className="block max-h-[60vh] w-full object-contain" />
                </div>
              )}
            {uncertain(viewing) && (
              <p className="flex gap-1.5 text-[11.5px] text-muted"><TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-warning" />{t("photoTool.uncertain")}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11.5px] tabular-nums text-faint">
                {viewing.width && viewing.height ? `${viewing.width}×${viewing.height} · ` : ""}{extLabel(viewing.mime)}
              </span>
              <div className="flex gap-2">
                <Link href="/library?tab=tools"
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-semibold text-muted hover:bg-raised hover:text-ink">
                  <Library size={13} aria-hidden />{t("photoTool.inLibrary")}
                </Link>
                <button type="button" onClick={() => download(viewing)} disabled={!viewing.url}
                  className="cta flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold disabled:opacity-50">
                  <Download size={13} aria-hidden />{t("common.download")}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function SceneChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick}
      className={cn(
        "min-h-[36px] rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
        active
          ? "border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.08)] text-accent"
          : "border-line text-muted hover:bg-raised hover:text-ink",
      )}>
      {children}
    </button>
  );
}

/** The palette, a free HEX field and a swatch showing the colour chosen. */
function ColorPicker({ label, color, draft, onPick, onDraft }: {
  label: string; color: string; draft: string;
  onPick: (hex: string) => void; onDraft: (value: string) => void;
}) {
  const { t } = useI18n();
  const valid = HEX_RE.test(draft);
  return (
    <section>
      <GroupLabel hint={color.toUpperCase()}>{label}</GroupLabel>
      <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={label}>
        {COLOR_PALETTE.map((c) => {
          const active = color.toUpperCase() === c;
          return (
            <button key={c} type="button" role="radio" aria-checked={active} aria-label={c} title={c}
              onClick={() => onPick(c)}
              className={cn(
                "aspect-square w-full rounded-lg border transition-shadow",
                active ? "border-[rgb(var(--accent))] ring-2 ring-[rgb(var(--accent)/0.45)]" : "border-line hover:ring-2 hover:ring-[rgb(var(--hairline)/0.6)]",
              )}
              style={{ backgroundColor: c }} />
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span aria-hidden className="h-10 w-10 shrink-0 rounded-lg border border-line" style={{ backgroundColor: HEX_RE.test(color) ? color : "transparent" }} />
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("photoTool.colorCustom")}</span>
          <input value={draft} maxLength={7} spellCheck={false} autoComplete="off"
            onChange={(e) => {
              const v = e.target.value.trim();
              onDraft(v.startsWith("#") ? v : `#${v}`);
            }}
            placeholder="#FFFFFF" aria-invalid={!valid}
            className={cn(
              "h-10 w-full rounded-xl border bg-surface px-3 font-mono text-[13px] uppercase outline-none transition-colors",
              valid ? "border-line focus:border-[rgb(var(--accent)/0.6)]" : "border-[rgb(var(--danger)/0.6)]",
            )} />
        </label>
      </div>
      {!valid && <p className="mt-1 text-[11px] text-danger">{t("photoTool.colorInvalid")}</p>}
    </section>
  );
}

function ResultCard({ item, tool, onOpen, onDownload }: {
  item: PhotoResult; tool: PhotoToolSlug; onOpen: () => void; onDownload: () => void;
}) {
  const { t } = useI18n();
  const swatch = item.settings.color && HEX_RE.test(item.settings.color) ? item.settings.color : null;
  return (
    <li className="group min-w-0 overflow-hidden rounded-xl border border-line bg-surface/60" data-photo-result={item.environment ?? "live"}>
      <button type="button" onClick={onOpen} className="relative block aspect-square w-full bg-checker"
        aria-label={item.sourceUrl ? t("photoTool.compare") : t("photoTool.open")}>
        {item.url
          // The grid paints the 640 px copy; the original opens on a click.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.thumbUrl ?? item.url} alt={t(`photoTool.name.${tool}`)} loading="lazy" decoding="async" className="h-full w-full object-contain" />
          : <span className="flex h-full items-center justify-center text-[11px] text-faint">{t("photoTool.expired")}</span>}
        {item.environment === "sandbox" && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-warning px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            {t("photoTool.sandboxBadge")}
          </span>
        )}
        {item.environment === "local" && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {t("tools.free")}
          </span>
        )}
        {uncertain(item) && (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-warning p-1 text-white" title={t("photoTool.uncertain")}>
            <TriangleAlert size={12} aria-hidden />
          </span>
        )}
      </button>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {swatch && <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border border-line" style={{ backgroundColor: swatch }} />}
        <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-faint">
          {item.width && item.height ? `${item.width}×${item.height}` : extLabel(item.mime)}
        </span>
        {item.sourceUrl && (
          <button type="button" onClick={onOpen} aria-label={t("photoTool.compare")} title={t("photoTool.compare")}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink">
            <Columns2 size={14} aria-hidden />
          </button>
        )}
        <button type="button" onClick={onDownload} disabled={!item.url} aria-label={t("common.download")} title={t("common.download")}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
          <Download size={14} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/** Photoroom reports how unsure it was about the cutout (0 sure … 1 unsure;
 *  -1 for people, where it does not score). Above one half it is worth a look. */
function uncertain(item: PhotoResult): boolean {
  return item.uncertainty != null && item.uncertainty >= 0.5;
}

function extLabel(mime: string): string {
  return mime.includes("webp") ? "WebP" : mime.includes("jpeg") ? "JPG" : "PNG";
}

/** The browser-side copy of the server's settings summary, for a card that
 *  appears before the history is re-read. */
function summary(tool: PhotoToolSlug, s: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof s.format === "string") out.format = s.format;
  if ((tool === "white_bg" || (tool === "ai_shadow" && s.background === "color")) && typeof s.color === "string") out.color = s.color;
  return out;
}

/**
 * THE SAME RULE THE SERVER APPLIES (lib/images/local.ts → hasRealTransparency):
 * a 256 px proxy, and at least 5% of its pixels with alpha ≤ 16. A JPEG has no
 * alpha at all. Any failure is "no" — the server decides anyway, this only
 * keeps the displayed total honest.
 */
async function hasRealTransparency(file: File): Promise<boolean> {
  if (file.type === "image/jpeg") return false;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return false; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const data = ctx.getImageData(0, 0, w, h).data;
    let clearPx = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] <= 16) clearPx++;
    return clearPx / (w * h) >= 0.05;
  } catch {
    return false;
  }
}
