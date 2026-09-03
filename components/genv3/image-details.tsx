"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Eraser, Expand,
  Heart, Link2, Loader2, Maximize2, Minus, Plus, Save, Scaling, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GalleryItem } from "@/components/genv3/types";

/**
 * INFORMACJE O OBRAZIE — the premium image-details view.
 *
 * Desktop: image left (zoom, prev/next, filmstrip), metadata and actions
 * right. Phones get the same content as a full-screen sheet. Every action
 * here is real: the edit tiles run the existing tool pipeline on this very
 * file and save the result to the library; the download menu converts
 * through the local format tool so the browser receives a same-origin blob
 * it can genuinely save. Unsupported operations are visibly "Wkrótce" —
 * never dead buttons pretending.
 *
 * The prompt shown is customer-safe by construction: their own prompt for
 * custom generations, the concept's seller-facing description for managed
 * ones. The hidden GrovBase prompt never reaches this component.
 */
export function ImageDetails({ items, index, onIndex, onClose, onRegenerate, onFavorite, onDelete, onNote }: {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onRegenerate: (item: GalleryItem) => void;
  onFavorite: (item: GalleryItem) => void;
  onDelete: (item: GalleryItem) => void;
  onNote: (item: GalleryItem, note: string) => void;
}) {
  const { t, locale } = useI18n();
  const item = items[index];
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [expandPick, setExpandPick] = useState(false);
  const noteDirty = note.trim() !== (item.note ?? "").trim();

  // Reset per-image state when navigating.
  useEffect(() => { setZoom(100); setNote(item.note ?? ""); setDlOpen(false); setExpandPick(false); }, [item.assetId, item.note]);

  // ESC + arrows; body scroll lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in the note (or any field) must never navigate away or close
      // the modal mid-draft — Escape merely leaves the field.
      const el = e.target as HTMLElement | null;
      const editing = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || !!el?.isContentEditable;
      if (e.key === "Escape") {
        if (editing) { el?.blur(); return; }
        if (fullscreen) setFullscreen(false); else onClose();
      }
      if (editing) return;
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, onIndex, index, items.length, fullscreen]);

  const dims = item.width && item.height ? `${item.width} × ${item.height}` : null;
  const created = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" })
    .format(new Date(item.createdAt)), [item.createdAt, locale]);

  const fetchBlob = useCallback(async (): Promise<Blob | null> => {
    try {
      const res = await fetch(item.url);
      return res.ok ? await res.blob() : null;
    } catch { return null; }
  }, [item.url]);

  async function copyPrompt() {
    if (!item.prompt) return;
    await navigator.clipboard.writeText(item.prompt).catch(() => null);
    toast.success(t("genv3.copied"));
  }
  async function copyId() {
    await navigator.clipboard.writeText(item.assetId).catch(() => null);
    toast.success(t("genv3.copied"));
  }
  async function copyUrl() {
    await navigator.clipboard.writeText(item.url).catch(() => null);
    toast.success(t("genv3.copiedUrl"));
  }
  async function copyImage() {
    const blob = await fetchBlob();
    if (!blob) { toast.error(t("common.error")); return; }
    try {
      // Clipboard accepts PNG only — convert through a canvas when needed.
      const png = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast.success(t("genv3.copiedImage"));
    } catch { toast.error(t("genv3.copyImageFailed")); }
  }

  /** Convert + download through the LOCAL format tool: the browser gets a
   *  same-origin blob, so "download" really downloads. */
  async function downloadAs(format: "jpeg" | "png" | "webp" | "tiff" | "original") {
    setDlOpen(false);
    const base = (item.product ?? "grovbase").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "grovbase";
    if (format === "original") {
      const blob = await fetchBlob();
      if (!blob) { toast.error(t("common.error")); return; }
      saveBlob(blob, `${base}-${item.assetId.slice(0, 8)}.${extOf(blob.type)}`);
      return;
    }
    const blob = await fetchBlob();
    if (!blob) { toast.error(t("common.error")); return; }
    setToolBusy("download");
    try {
      const fd = new FormData();
      fd.set("tool", "format");
      fd.set("file", new File([blob], "image", { type: blob.type || "image/png" }));
      fd.set("settings", JSON.stringify({ format, width: null, height: null, quality: 92, fit: "inside" }));
      const res = await fetch("/api/tools/run", { method: "POST", body: fd });
      if (!res.ok) { toast.error(t("common.error")); return; }
      saveBlob(await res.blob(), `${base}-${item.assetId.slice(0, 8)}.${format === "jpeg" ? "jpg" : format}`);
    } finally { setToolBusy(null); }
  }

  /** Run one real tool on this image and save the result to the library. */
  async function runTool(slug: "remove_bg" | "upscale" | "expand", settings: Record<string, unknown>) {
    if (toolBusy) return;
    setToolBusy(slug);
    try {
      const blob = await fetchBlob();
      if (!blob) { toast.error(t("common.error")); return; }
      const fd = new FormData();
      fd.set("tool", slug);
      fd.set("file", new File([blob], "image", { type: blob.type || "image/png" }));
      fd.set("settings", JSON.stringify(settings));
      const res = await fetch("/api/tools/run", { method: "POST", body: fd });
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null;
        toast.error(json?.error === "insufficient_credits" ? t("studio.err.insufficient_credits") : t("genv3.toolFailed"));
        return;
      }
      const out = await res.blob();
      const metaRaw = res.headers.get("X-Tool-Meta");
      let credits = 0;
      try { credits = metaRaw ? (JSON.parse(atob(metaRaw)) as { credits?: number }).credits ?? 0 : 0; } catch { /* label only */ }
      const save = new FormData();
      save.set("tool", slug);
      save.set("file", new File([out], "result", { type: out.type || "image/png" }));
      await fetch("/api/tools/save", { method: "POST", body: save });
      toast.success(credits > 0 ? t("genv3.toolDoneCredits", { n: credits }) : t("genv3.toolDone"));
    } catch {
      toast.error(t("genv3.toolFailed"));
    } finally { setToolBusy(null); }
  }

  async function saveNote() {
    setSavingNote(true);
    const { error } = await createClient().rpc("set_generation_note", {
      gen_id: item.generationId, note: note.trim(),
    });
    setSavingNote(false);
    if (error) { toast.error(t("common.error")); return; }
    onNote(item, note.trim());
    toast.success(t("genv3.noteSaved"));
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t("genv3.detailsTitle")}
      className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-4">
      <button type="button" aria-label={t("common.close")} onClick={onClose}
        className="scrim absolute inset-0 cursor-default backdrop-blur-[6px]" />
      <div className="overlay animate-pop relative flex h-full w-full min-w-0 flex-col overflow-y-auto rounded-none sm:h-auto sm:max-h-[92dvh] sm:max-w-5xl sm:rounded-2xl lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:overflow-hidden">
        {/* ── IMAGE SIDE ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col bg-sunken/60 p-3 sm:p-4 lg:max-h-[92dvh]">
          <div className="relative flex min-h-[46dvh] flex-1 items-center justify-center overflow-hidden rounded-xl bg-[rgb(var(--bg))] lg:min-h-0">
            {item.ratio && (
              <span className="absolute left-2.5 top-2.5 z-10 rounded-lg bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">{item.ratio}</span>
            )}
            <div className="absolute right-2.5 top-2.5 z-10 flex gap-1.5">
              <button type="button" aria-label={item.favorite ? t("library.unfavorite") : t("library.favorite")}
                aria-pressed={item.favorite}
                onClick={() => onFavorite(item)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75">
                <Heart size={14} aria-hidden fill={item.favorite ? "currentColor" : "none"} className={item.favorite ? "text-accent" : undefined} />
              </button>
              <button type="button" aria-label={t("common.delete")} onClick={() => onDelete(item)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75">
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
            {index > 0 && (
              <button type="button" aria-label={t("genv3.prev")} onClick={() => onIndex(index - 1)}
                className="absolute left-2.5 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75">
                <ChevronLeft size={17} aria-hidden />
              </button>
            )}
            {index < items.length - 1 && (
              <button type="button" aria-label={t("genv3.next")} onClick={() => onIndex(index + 1)}
                className="absolute right-2.5 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75">
                <ChevronRight size={17} aria-hidden />
              </button>
            )}
            {/* The layout box itself scales, so zoomed overflow starts at the
                scroll origin and every edge stays reachable. */}
            <div className="h-full max-h-[64dvh] w-full overflow-auto lg:max-h-none">
              <div className="mx-auto" style={{ width: `${zoom}%`, height: `${zoom}%`, minWidth: "100%", minHeight: "100%" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.product ?? ""} className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-1.5 py-1 backdrop-blur">
              <button type="button" aria-label={t("genv3.zoomOut")} disabled={zoom <= 50}
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-40">
                <Minus size={13} aria-hidden />
              </button>
              <span className="w-12 text-center text-[11.5px] font-bold tabular-nums text-white">{zoom}%</span>
              <button type="button" aria-label={t("genv3.zoomIn")} disabled={zoom >= 200}
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-40">
                <Plus size={13} aria-hidden />
              </button>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-white/25" />
              <button type="button" aria-label={t("genv3.fullscreen")} onClick={() => setFullscreen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15">
                <Maximize2 size={13} aria-hidden />
              </button>
            </div>
          </div>

          {/* Filmstrip */}
          {items.length > 1 && (
            <div className="thin-scroll -mx-1 mt-3 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-0.5">
              {items.map((s, i) => (
                <button key={s.assetId} type="button" aria-label={t("genv3.thumbAria", { n: i + 1 })}
                  aria-current={i === index}
                  onClick={() => onIndex(i)}
                  className={cn(
                    "h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 transition-all duration-150",
                    i === index ? "ring-accent" : "opacity-70 ring-transparent hover:opacity-100",
                  )}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 hidden shrink-0 items-center justify-between lg:flex">
            <button type="button" disabled={index === 0} onClick={() => onIndex(index - 1)}
              className="plate flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-40">
              <ChevronLeft size={14} aria-hidden />{t("genv3.prev")}
            </button>
            <button type="button" disabled={index === items.length - 1} onClick={() => onIndex(index + 1)}
              className="cta flex h-10 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold disabled:opacity-40">
              {t("genv3.next")}<ChevronRight size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* ── INFO SIDE ──────────────────────────────────────────────────── */}
        <div className="thin-scroll min-w-0 space-y-4 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5 lg:max-h-[92dvh] lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-[16px] font-semibold tracking-tight">{t("genv3.detailsTitle")}</h2>
            <button type="button" aria-label={t("common.close")} onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink">
              <X size={16} aria-hidden />
            </button>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold text-faint">{t("genv3.promptLabel")}</p>
            <div className="relative rounded-xl border border-line bg-sunken/50 p-3 pr-9">
              <p className="max-h-32 overflow-y-auto text-[12.5px] leading-relaxed text-ink">
                {item.prompt ?? <span className="text-faint">{t("genv3.noPrompt")}</span>}
              </p>
              {item.prompt && (
                <button type="button" aria-label={t("genv3.copyPrompt")} onClick={copyPrompt}
                  className="absolute right-2 top-2 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
                  <Copy size={13} aria-hidden />
                </button>
              )}
            </div>
          </div>

          {/* UŻYTE ZDJĘCIA — what this image was made from. Keyed by
              generation: the view stays mounted across prev/next, and reusing
              the instance painted the previous image's source thumbnails for
              a frame under the new one. */}
          <SourcesSection key={item.generationId} item={item} />

          {/* USTAWIENIA GENEROWANIA — every knob the job ran with */}
          <div data-details-settings>
            <p className="mb-2 text-[13px] font-semibold tracking-tight">{t("genv3.settings")}</p>
            <dl className="space-y-2 text-[12.5px]">
              <MetaRow label={t("genv3.metaModel")} value={item.model ?? "—"} />
              {item.origin && (
                <MetaRow label={t("genv3.metaOrigin")}
                  value={t(item.origin === "engine" ? "genv3.modeManaged" : "genv3.modeCustom")} />
              )}
              {item.sessionType && (
                <MetaRow label={t("genv3.metaSession")}
                  value={t(item.sessionType === "advertising" ? "genv3.sessionAd" : "genv3.sessionLife")} />
              )}
              <MetaRow label={t("genv3.metaFormat")} value={item.ratio ? `${item.ratio}${dims ? ` (${dims})` : ""}` : dims ?? "—"} />
              {item.resolution && <MetaRow label={t("genv3.resolution")} value={item.resolution} />}
              {item.quality && (
                <MetaRow label={t("genv3.quality")} value={qualityLabel(item.quality, t)} />
              )}
              {item.quantity != null && <MetaRow label={t("genv3.countImages")} value={String(item.quantity)} />}
              {item.credits != null && (
                <MetaRow label={t("genv3.metaCost")} value={t("genv3.creditsShort", { n: item.credits })} />
              )}
              <MetaRow label={t("genv3.metaDate")} value={created} />
              <MetaRow label={t("genv3.metaId")} value={
                <button type="button" onClick={copyId} title={item.assetId}
                  className="inline-flex items-center gap-1.5 font-semibold text-ink transition-colors hover:text-accent">
                  img_{item.assetId.slice(0, 8)}<Copy size={11} aria-hidden className="text-faint" />
                </button>
              } />
            </dl>
          </div>

          {/* EDYTUJ OBRAZ — real tools on this exact file */}
          <div>
            <p className="mb-2 text-[13px] font-semibold tracking-tight">{t("genv3.editTitle")}</p>
            <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
              <EditTile icon={Expand} busy={toolBusy === "expand"} title={t("genv3.editFormat")} sub={t("genv3.editFormatSub")}
                onClick={() => setExpandPick(!expandPick)} />
              <EditTile icon={Scaling} busy={toolBusy === "upscale"} title={t("genv3.editUpscale")} sub={t("genv3.editUpscaleSub")}
                onClick={() => runTool("upscale", { factor: 2 })} />
              <EditTile icon={Eraser} busy={toolBusy === "remove_bg"} title={t("genv3.editRemoveBg")} sub={t("genv3.editRemoveBgSub")}
                onClick={() => runTool("remove_bg", { format: "png" })} />
              <EditTile icon={Wand2} disabled title={t("genv3.editElements")} sub={t("genv3.editElementsSub")} soonLabel={t("genv3.soon")} />
              {/* Honest state: no AI-enhance backend exists yet — the tile is
                  visible per the mockup but disabled, never a fake button. */}
              <EditTile icon={Sparkles} disabled title={t("genv3.editEnhance")} sub={t("genv3.editEnhanceSub")} soonLabel={t("genv3.soon")} />
            </div>
            {expandPick && (
              <div className="animate-fade mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-sunken/40 p-2">
                <span className="text-[11px] font-semibold text-faint">{t("genv3.editFormatPick")}</span>
                {["1:1", "4:5", "9:16", "16:9"].map((r) => (
                  <button key={r} type="button"
                    onClick={() => { setExpandPick(false); void runTool("expand", { ratio: r }); }}
                    // Border comes from a utility rather than `border-line` so
                    // the hover tint is not outranked by the workspace scope.
                    className="rounded-lg border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))] px-2.5 py-1.5 text-[12px] font-bold tabular-nums transition-colors hover:border-[rgb(var(--accent)/0.5)] hover:text-accent">
                    {r}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">{t("genv3.editNote")}</p>
          </div>

          {/* NOTATKA */}
          <div>
            <p className="mb-2 text-[13px] font-semibold tracking-tight">{t("genv3.noteTitle")}</p>
            <div className="relative">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={t("genv3.notePh")}
                aria-label={t("genv3.noteTitle")}
                className="w-full resize-y rounded-xl border border-line bg-sunken/50 p-3 pr-10 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.5)]"
              />
              <button type="button" aria-label={t("genv3.noteSave")} disabled={!noteDirty || savingNote}
                onClick={saveNote}
                className={cn("absolute bottom-2.5 right-2 rounded-lg p-1.5 transition-colors",
                  noteDirty ? "text-accent hover:bg-accent-soft/50" : "text-faint")}>
                {savingNote ? <Loader2 size={14} className="animate-spin" aria-hidden />
                  : noteDirty ? <Save size={14} aria-hidden /> : <Check size={14} aria-hidden />}
              </button>
            </div>
          </div>

          {/* AKCJE */}
          <div>
            <p className="mb-2 text-[13px] font-semibold tracking-tight">{t("genv3.actionsTitle")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyImage}
                className="plate flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-raised">
                <Copy size={13} aria-hidden className="text-muted" />{t("genv3.copyImage")}
              </button>
              <button type="button" onClick={copyUrl}
                className="plate flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-raised">
                <Link2 size={13} aria-hidden className="text-muted" />{t("genv3.copyUrl")}
              </button>
              <div className="relative">
                <button type="button" aria-expanded={dlOpen} onClick={() => setDlOpen(!dlOpen)}
                  disabled={toolBusy === "download"}
                  className="cta flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold">
                  {toolBusy === "download" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}
                  {t("common.download")}
                  <ChevronDown size={12} aria-hidden className={cn("transition-transform", dlOpen && "rotate-180")} />
                </button>
                {dlOpen && (
                  <div className="panel absolute bottom-11 right-0 z-20 w-52 rounded-xl p-1 shadow-e3">
                    <DlItem label="JPG" sub={t("genv3.dlJpg")} onClick={() => downloadAs("jpeg")} />
                    <DlItem label="PNG" sub={t("genv3.dlPng")} onClick={() => downloadAs("png")} />
                    <DlItem label="WEBP" sub={t("genv3.dlWebp")} onClick={() => downloadAs("webp")} />
                    <DlItem label="TIFF" sub={t("genv3.dlTiff")} onClick={() => downloadAs("tiff")} />
                    <DlItem label={t("genv3.dlOriginal")} sub={t("genv3.dlOriginalSub")} onClick={() => downloadAs("original")} />
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={() => onRegenerate(item)}
              className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-[rgb(var(--accent)/0.45)] bg-accent-soft/30 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft/60">
              {t("genv3.regen")}
            </button>
          </div>
        </div>
      </div>

      {/* Simple in-app fullscreen viewer */}
      {fullscreen && (
        <button type="button" aria-label={t("common.close")} onClick={() => setFullscreen(false)}
          className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/95 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </div>
  );
}

function qualityLabel(q: string, t: (key: string) => string): string {
  const key = q === "low" ? "genv3.qualityLow" : q === "high" ? "genv3.qualityHigh" : q === "medium" ? "genv3.qualityMedium" : null;
  return key ? t(key) : q;
}

/* ── Użyte zdjęcia ────────────────────────────────────────────────────── */

type Sources = { references: string[]; inspirations: string[]; marked: string | null };
/**
 * Signed once per generation — paging back and forth through the filmstrip
 * must not re-sign the same photos. The entries EXPIRE well before the URLs
 * they hold do (the endpoint signs for an hour): a tab left open for an
 * afternoon would otherwise serve dead links from cache and show broken
 * thumbnails with no way back except a reload.
 */
const SOURCES_TTL_MS = 45 * 60 * 1000;
const sourcesCache = new Map<string, { data: Sources; at: number }>();
/** Requests still on the wire, so arrowing away and straight back joins the
 *  pending call instead of signing the same photos a second time. */
const sourcesInFlight = new Map<string, Promise<Sources | null>>();

function cachedSources(generationId: string): Sources | undefined {
  const hit = sourcesCache.get(generationId);
  if (!hit) return undefined;
  if (Date.now() - hit.at > SOURCES_TTL_MS) { sourcesCache.delete(generationId); return undefined; }
  return hit.data;
}

function loadSources(generationId: string): Promise<Sources | null> {
  const pending = sourcesInFlight.get(generationId);
  if (pending) return pending;
  const request = fetch(`/api/generations/sources?generationId=${encodeURIComponent(generationId)}`, { cache: "no-store" })
    .then((res) => res.json() as Promise<{ ok: boolean } & Partial<Sources>>)
    .then((json) => {
      if (!json.ok) return null;
      const data: Sources = {
        references: json.references ?? [], inspirations: json.inspirations ?? [], marked: json.marked ?? null,
      };
      // Cached even when the viewer has already moved on — the answer is
      // still right for that generation, and paging back must not re-sign.
      sourcesCache.set(generationId, { data, at: Date.now() });
      return data;
    })
    .catch(() => null)
    .finally(() => { sourcesInFlight.delete(generationId); });
  sourcesInFlight.set(generationId, request);
  return request;
}

/**
 * The product references, inspiration photos and marked-guidance copy this
 * generation was rendered with. Thumbnails are signed ON DEMAND when the
 * view opens (see /api/generations/sources) — the gallery page itself only
 * carries the counts. A job without any source says so plainly.
 */
function SourcesSection({ item }: { item: GalleryItem }) {
  const { t } = useI18n();
  const expected = item.referenceCount + item.inspirationCount;
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data?: Sources }>(() => {
    const cached = cachedSources(item.generationId);
    if (cached) return { status: "ready", data: cached };
    // A job that carried no source photos has nothing to fetch — say so on
    // the first paint instead of flashing a skeleton for one frame.
    if (expected === 0) return { status: "ready", data: { references: [], inspirations: [], marked: null } };
    return { status: "loading" };
  });

  useEffect(() => {
    let alive = true;
    const cached = cachedSources(item.generationId);
    if (cached) { setState({ status: "ready", data: cached }); return; }
    if (expected === 0) {
      setState({ status: "ready", data: { references: [], inspirations: [], marked: null } });
      return;
    }
    setState({ status: "loading" });
    void loadSources(item.generationId).then((data) => {
      if (!alive) return;
      setState(data ? { status: "ready", data } : { status: "error" });
    });
    return () => { alive = false; };
  }, [item.generationId, expected]);

  const data = state.data;
  const empty = state.status === "ready" && data
    && data.references.length === 0 && data.inspirations.length === 0 && !data.marked
    && expected === 0;

  return (
    <div data-sources data-sources-status={state.status} data-sources-gen={item.generationId}>
      <p className="mb-2 text-[13px] font-semibold tracking-tight">{t("genv3.sourcesTitle")}</p>
      {state.status === "loading" && (
        <div className="flex flex-wrap gap-1.5" aria-busy="true">
          {Array.from({ length: Math.min(Math.max(expected, 1), 6) }, (_, i) => (
            <span key={i} className="skeleton h-14 w-14 rounded-lg" />
          ))}
        </div>
      )}
      {state.status === "error" && (
        <p className="text-[11.5px] leading-relaxed text-faint">{t("genv3.sourcesFailed")}</p>
      )}
      {state.status === "ready" && data && (empty ? (
        <p className="text-[11.5px] leading-relaxed text-faint">{t("genv3.sourcesNone")}</p>
      ) : (
        <div className="space-y-2.5">
          {(item.referenceCount > 0 || data.references.length > 0) && (
            <SourceGroup label={t("genv3.sourcesRefs")} urls={data.references}
              count={Math.max(item.referenceCount, data.references.length)} ariaLabel={(n) => t("genv3.sourceAria", { n })} />
          )}
          {(item.inspirationCount > 0 || data.inspirations.length > 0) && (
            <SourceGroup label={t("genv3.sourcesInsp")} urls={data.inspirations}
              count={Math.max(item.inspirationCount, data.inspirations.length)} ariaLabel={(n) => t("genv3.sourceAria", { n })} />
          )}
          {data.marked && (
            <SourceGroup label={t("genv3.sourcesMarked")} urls={[data.marked]} count={1} ariaLabel={(n) => t("genv3.sourceAria", { n })} />
          )}
        </div>
      ))}
    </div>
  );
}

function SourceGroup({ label, urls, count, ariaLabel }: {
  label: string; urls: string[]; count: number; ariaLabel: (n: number) => string;
}) {
  return (
    <div data-source-group>
      <p className="mb-1 text-[11px] font-semibold text-faint">
        {label} <span className="tabular-nums">({count})</span>
      </p>
      {urls.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {urls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel(i + 1)}
              className="block h-14 w-14 overflow-hidden rounded-lg bg-sunken ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))] transition-opacity hover:opacity-85">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-faint">—</p>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-faint">{label}</dt>
      <span aria-hidden className="min-w-4 flex-1 border-b border-dotted border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]" />
      <dd className="min-w-0 truncate text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function EditTile({ icon: Icon, title, sub, onClick, disabled, soonLabel, busy }: {
  icon: typeof Expand; title: string; sub: string;
  onClick?: () => void; disabled?: boolean; soonLabel?: string; busy?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className={cn(
        "relative rounded-xl border border-line bg-sunken/40 p-2.5 text-left transition-colors duration-200",
        disabled ? "cursor-default opacity-55" : "hover:border-[rgb(var(--accent)/0.4)] hover:bg-raised",
      )}>
      {busy
        ? <Loader2 size={14} className="mb-1 animate-spin text-accent" aria-hidden />
        : <Icon size={14} aria-hidden className="mb-1 text-muted" />}
      <span className="block text-[12px] font-semibold leading-tight">{title}</span>
      <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">{sub}</span>
      {soonLabel && <span className="absolute right-2 top-2"><Badge tone="neutral">{soonLabel}</Badge></span>}
    </button>
  );
}

function DlItem({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-baseline justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sunken">
      <span className="text-[12.5px] font-bold">{label}</span>
      <span className="truncate text-[10.5px] text-faint">{sub}</span>
    </button>
  );
}

export function extOf(mime: string): string {
  return mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : "img";
}

/** Hand the browser a same-origin blob to save — the one way a click can
 *  genuinely download rather than open a tab. Shared with the gallery's
 *  "Pobierz wybrane". */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error("png")), "image/png"));
}
