"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import {
  Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Cpu, Crop, Download,
  Eraser, Expand, FileText, Heart, Link2, Loader2, Maximize2, Minus, Plus, Ruler, Save, Scaling,
  Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GalleryItem } from "@/components/genv3/types";
import { ratioName } from "@/components/genv3/ratio-options";
import { fileNameFor, saveBlob } from "@/lib/save-image";
import { ZoomPan, ZOOM_MAX, ZOOM_MIN, stepZoom } from "@/components/genv3/zoom-pan";
import { ResultFeedback } from "@/components/genv3/result-feedback";

/**
 * INFORMACJE O OBRAZIE — the premium image-details view.
 *
 * Desktop: image left (zoom, prev/next, filmstrip), metadata and actions
 * right. Phones get the same content as a full-screen sheet. Every action
 * here is real: the edit tiles run the existing tool pipeline on this very
 * file and save the result to the library; "Pobierz" hands over the exact
 * file the model produced, fetched into a blob so the browser saves it
 * without ever leaving GrovBase for the storage host. Unsupported operations
 * are visibly "Wkrótce" — never dead buttons pretending.
 *
 * The prompt shown is customer-safe by construction: their own prompt for
 * custom generations, the concept's seller-facing description for managed
 * ones. The hidden GrovBase prompt never reaches this component.
 */
export function ImageDetails({ items, index, onIndex, onClose, canRegenerate = true, onRegenerate, onFavorite, onDelete, onNote }: {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** False where no engine can serve a retake — the button is then absent. */
  canRegenerate?: boolean;
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
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [expandPick, setExpandPick] = useState(false);
  const noteDirty = note.trim() !== (item.note ?? "").trim();

  // THIS PREFETCH WENT WITH "PRZED / PO". It existed to have the job's first
  // reference photo signed and ready for the comparison; the reference strip
  // lower down asks for the same (deduped, cached) sources on its own, so
  // nothing else lost anything when the comparison went.

  // Reset per-image state when navigating — zoom included, so the next
  // picture never opens at 300% and shoved off screen. The pan resets with
  // it, inside ZoomPan, which watches the same two things.
  useEffect(() => { setZoom(100); setNote(item.note ?? ""); setExpandPick(false); }, [item.assetId, item.note]);

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

  const isTool = item.operation === "image_retouch";
  const dims = item.width && item.height ? `${item.width} × ${item.height}` : null;
  const created = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" })
    .format(new Date(item.createdAt)), [item.createdAt, locale]);

  /** The storage object's extension, for the rare answer with no
   *  Content-Type. Only ever a FALLBACK — the bytes decide, not the name. */
  function mimeFromPath(path: string): string {
    const ext = (path.split(".").pop() ?? "").toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    if (ext === "avif") return "image/avif";
    if (ext === "gif") return "image/gif";
    if (ext === "tiff" || ext === "tif") return "image/tiff";
    return "image/png";
  }

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
  async function copyNote() {
    if (!note.trim()) return;
    await navigator.clipboard.writeText(note.trim()).catch(() => null);
    toast.success(t("genv3.copied"));
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

  /**
   * ONE CLICK, THE FILE THAT WAS GENERATED.
   *
   * This used to open a menu of formats — JPG, PNG, WEBP, TIFF, "original" —
   * and every branch but the last ran the image back through the format tool
   * on the server. So "Pobierz" meant a round trip, a re-encode and a new file
   * that was not the thing the model produced, chosen from a list nobody asked
   * for. Now the button is a button: fetch the asset's own bytes and hand them
   * over, whatever they are. A PNG saves as a PNG, a WEBP as a WEBP.
   *
   * `item.url` is the ORIGINAL — the projection signs the derivatives
   * separately as `thumbUrl` and `previewUrl`, and neither is used here — and
   * `saveBlob` is the one save path in the product: the native share sheet on
   * a phone, an anchor everywhere else, and never a redirect to the storage
   * host. A dismissed share sheet is a decision, not a failure, so it says
   * nothing.
   */
  async function downloadOriginal() {
    if (toolBusy) return;
    setToolBusy("download");
    try {
      const blob = await fetchBlob();
      if (!blob) { toast.error(t("genv3.downloadFailed")); return; }
      // The storage object's own Content-Type, with the path's extension as
      // the fallback for a bucket that answered with nothing useful.
      const mime = blob.type || mimeFromPath(item.path);
      await saveBlob(blob, fileNameFor(item.product ?? item.model, mime));
    } catch { toast.error(t("genv3.downloadFailed")); }
    finally { setToolBusy(null); }
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
      // THE RUN IS ALREADY CHARGED AND ITS BYTES LIVE ONLY IN THAT RESPONSE.
      // This save is the only thing that persists them, so an unread answer
      // meant a seller was billed, told "Gotowe · N kredytów", and given
      // nothing that exists anywhere afterwards. Same shape the editor's own
      // save already uses.
      //
      // Not retried on purpose: /api/tools/save mints a fresh id per call with
      // upsert disabled, so a retry after a lost response writes a second
      // object and a second row — the same "cannot tell my own lost response
      // from a completed one" trap the ledger reconciler exists to avoid.
      const saveRes = await fetch("/api/tools/save", { method: "POST", body: save });
      const saveJson = await saveRes.json().catch(() => ({ ok: false })) as { ok?: boolean };
      if (!saveRes.ok || !saveJson.ok) { toast.error(t("tools.saveFailed")); return; }
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
        className="scrim absolute inset-0 cursor-default backdrop-blur-[10px]" />
      {/* The work surface, not a dialog squeezed into a corner: the viewport
          minus a 24px frame, out to 1920.

          The picture is the subject, so the PANEL takes a fixed, comfortable
          width (380–440) and every remaining pixel goes to the image. That is
          what stops a wide monitor from padding the sidebar instead of
          enlarging the photo — at 2560 the image gets ~1450px rather than the
          ~1130 a proportional split would have handed it. */}
      <div data-details-modal
        className="overlay animate-pop relative flex h-full w-full min-w-0 flex-col overflow-y-auto rounded-none sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)] sm:max-w-[1920px] sm:rounded-2xl lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,400px)] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ── IMAGE SIDE ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col bg-sunken/60 p-3 sm:p-4 lg:max-h-[calc(100dvh-3rem)]">
          <div className="relative flex min-h-[46dvh] flex-1 items-center justify-center overflow-hidden rounded-2xl bg-[rgb(var(--bg))] lg:min-h-0">
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
            {/* ZOOM AND PAN. This used to be an `overflow-auto` box holding a
                percentage-sized wrapper: it magnified, but reaching a corner
                at 200% meant hunting for a scrollbar, and on a phone it meant
                nothing at all. Now the picture is transformed inside a clipped
                viewport and dragged with the pointer — see zoom-pan.tsx. */}
            <div className="h-full max-h-[64dvh] w-full lg:max-h-none">
              <ZoomPan src={item.url} alt={item.product ?? ""} zoom={zoom} />
            </div>
            <div data-zoom-bar className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-1.5 py-1 backdrop-blur">
              <button type="button" aria-label={t("genv3.zoomOut")} disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => stepZoom(z, -1))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-40">
                <Minus size={13} aria-hidden />
              </button>
              <span className="w-12 text-center text-[11.5px] font-bold tabular-nums text-white">{zoom}%</span>
              <button type="button" aria-label={t("genv3.zoomIn")} disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => stepZoom(z, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-40">
                <Plus size={13} aria-hidden />
              </button>
              <span aria-hidden className="mx-0.5 h-4 w-px bg-white/25" />
              {/* NO "PRZED / PO" HERE ANY MORE. The comparison belonged to a
                  tool's own workbench, not to the viewer for a finished file:
                  in this modal it turned the one thing the screen is for —
                  looking at the picture — into a mode you could be stuck in.
                  The tools' own before/after and the CMS widget are untouched;
                  this modal's copy was local to this file. */}
              <button type="button" aria-label={t("genv3.fullImage")}
                // Fitting the whole image means starting from the top: back to
                // 100%, centred, and then the overlay.
                onClick={() => { setZoom(100); setFullscreen(true); }}
                className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/15">
                <Maximize2 size={13} aria-hidden />
                <span className="hidden sm:inline">{t("genv3.fullImage")}</span>
              </button>
            </div>
          </div>

          {/* NO FILMSTRIP, NO SECOND PREV/NEXT ROW. The reference keeps the
              image side to the picture and its zoom bar, and the batch is
              still walkable: the chevrons over the image and the ← → keys do
              the same job without a second strip of thumbnails competing with
              the reference photos at the top of the panel. */}
        </div>

        {/* ── INFO SIDE ──────────────────────────────────────────────────── */}
        <div className="thin-scroll min-w-0 space-y-5 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto">
          {/* ZDJĘCIA REFERENCYJNE lead the panel: "what was this made from"
              is the first question a seller asks of their own image, and it
              used to sit below a wall of settings. Keyed by generation — the
              view stays mounted across prev/next, and a reused instance
              painted the previous image's thumbnails under the new one. */}
          <div className="flex items-start justify-between gap-3">
            <SourcesSection key={item.generationId} item={item} />
            <button type="button" aria-label={t("common.close")} onClick={onClose}
              className="-mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink">
              <X size={16} aria-hidden />
            </button>
          </div>

          <PromptBox text={item.prompt} onCopy={copyPrompt} />

          {/* THE FACTS, AS A GRID OF TILES — no "Informacje" heading, because
              a seller looking at "Model AI / GPT Image 2" does not need to be
              told it is information. Each fact is its own cell: an icon, what
              it is, what it says. Entries are built as a list and filtered, so
              a missing figure leaves no empty tile and nothing is invented to
              fill one. */}
          <div data-details-settings className="grid grid-cols-2 gap-2">
            {([
              // A tool's engine is GrovBase's business: the customer bought
              // "Retusz zdjęć", and the provider stays in the cost log.
              isTool
                ? { icon: Wand2, label: t("genv3.metaOrigin"), value: t("retouch.title") }
                : { icon: Cpu, label: t("genv3.metaModel"), value: item.model },
              { icon: Crop, label: t("genv3.metaFormat"), value: item.ratio ? ratioName(t, item.ratio) : null },
              { icon: Scaling, label: t("genv3.resolution"), value: item.resolution },
              { icon: Ruler, label: t("genv3.metaPixels"), value: dims ? `${dims} px` : null },
              { icon: Calendar, label: t("genv3.metaDate"), value: created },
              // Straight from the job. Absent on anything rendered before the
              // figure was recorded — then the tile simply is not there.
              { icon: Clock, label: t("genv3.metaTime"),
                value: item.latencyMs != null ? t("genv3.secondsShort", { n: Math.max(1, Math.round(item.latencyMs / 1000)) }) : null },
            ] as { icon: typeof Cpu; label: string; value: string | null }[])
              .filter((f) => !!f.value)
              .map((f) => <InfoTile key={f.label} icon={f.icon} label={f.label} value={f.value!} />)}
          </div>

          <div>
            <details className="group/more">
              <summary data-details-more
                className="flex cursor-pointer list-none items-center gap-1 text-[11.5px] font-semibold text-faint transition-colors hover:text-accent">
                <ChevronDown size={12} aria-hidden className="transition-transform group-open/more:rotate-180" />
                {t("genv3.moreInfo")}
              </summary>
              <dl className="mt-2 space-y-2 text-[12.5px]">
                {!isTool && item.origin && (
                  <MetaRow label={t("genv3.metaOrigin")}
                    value={t(item.origin === "engine" ? "genv3.modeManaged" : "genv3.modeCustom")} />
                )}
                {/* The pixel size moved up into the grid; what stays here is
                    what the grid deliberately does not carry. */}
                {item.sessionType && (
                  <MetaRow label={t("genv3.metaSession")}
                    value={t(item.sessionType === "advertising" ? "genv3.sessionAd" : "genv3.sessionLife")} />
                )}
                {item.quality && <MetaRow label={t("genv3.quality")} value={qualityLabel(item.quality, t)} />}
                {item.quantity != null && <MetaRow label={t("genv3.countImages")} value={String(item.quantity)} />}
                {item.credits != null && (
                  <MetaRow label={t("genv3.metaCost")} value={t("genv3.creditsShort", { n: item.credits })} />
                )}
                <MetaRow label={t("genv3.metaId")} value={
                  <button type="button" onClick={copyId} title={item.assetId}
                    className="inline-flex items-center gap-1.5 font-semibold text-ink transition-colors hover:text-accent">
                    img_{item.assetId.slice(0, 8)}<Copy size={11} aria-hidden className="text-faint" />
                  </button>
                } />
              </dl>
            </details>
          </div>

          {/* FOUR EDIT TILES, no heading — real tools on this exact file. The
              fifth ("Popraw obraz (AI)") is gone: it had no backend, so it was
              a permanently disabled tile taking a row of the panel to say
              "Wkrótce". "Usuń wybrane" keeps its honest Wkrótce badge because
              the tile is in the reference; it is visibly unavailable, never a
              button that pretends to work. */}
          <div>
            <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
              <EditTile icon={Expand} busy={toolBusy === "expand"} title={t("genv3.editFormat")} sub={t("genv3.editFormatSub")}
                onClick={() => setExpandPick(!expandPick)} />
              <EditTile icon={Scaling} busy={toolBusy === "upscale"} title={t("genv3.editUpscale")} sub={t("genv3.editUpscaleSub")}
                onClick={() => runTool("upscale", { factor: 2 })} />
              <EditTile icon={Eraser} busy={toolBusy === "remove_bg"} title={t("genv3.editRemoveBg")} sub={t("genv3.editRemoveBgSub")}
                onClick={() => runTool("remove_bg", { format: "png" })} />
              <EditTile icon={Wand2} disabled title={t("genv3.editElements")} sub={t("genv3.editElementsSub")} soonLabel={t("genv3.soon")} />
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

          {/* NOTATKA — one line, no heading. The placeholder says what it is.
              The trailing button SAVES while there is something unsaved and
              COPIES once there is not, so the quick-copy the brief asks for
              never costs the seller an unsaved note. */}
          <div className="relative">
            <FileText size={14} aria-hidden className="pointer-events-none absolute left-3 top-3.5 text-faint" />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={1}
              maxLength={2000}
              placeholder={t("genv3.notePh")}
              aria-label={t("genv3.noteTitle")}
              className="thin-scroll min-h-[46px] w-full resize-y rounded-xl border border-line bg-sunken/50 py-3 pl-9 pr-10 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.5)]"
            />
            <button type="button"
              aria-label={noteDirty ? t("genv3.noteSave") : t("genv3.copyNote")}
              title={noteDirty ? t("genv3.noteSave") : t("genv3.copyNote")}
              disabled={savingNote || (!noteDirty && !note.trim())}
              onClick={() => { if (noteDirty) void saveNote(); else void copyNote(); }}
              className={cn("absolute right-2 top-2.5 rounded-lg p-1.5 transition-colors",
                noteDirty ? "text-accent hover:bg-accent-soft/50" : "text-faint hover:bg-raised hover:text-ink disabled:hover:bg-transparent")}>
              {savingNote ? <Loader2 size={14} className="animate-spin" aria-hidden />
                : noteDirty ? <Save size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            </button>
          </div>

          {/* AKCJE — three of equal weight, no heading. */}
          <div className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
            <button type="button" onClick={copyImage} title={t("genv3.copyImage")}
              className="plate flex h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold text-ink transition-colors hover:bg-raised">
              <Copy size={13} aria-hidden className="shrink-0 text-muted" />
              <span className="truncate">{t("genv3.copyImage")}</span>
            </button>
            <button type="button" onClick={copyUrl} data-copy-url title={t("genv3.copyUrl")}
              className="plate flex h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold text-ink transition-colors hover:bg-raised">
              <Link2 size={13} aria-hidden className="shrink-0 text-muted" />
              <span className="truncate">{t("genv3.copyUrl")}</span>
            </button>
            {/* No menu, no chevron: the same plate as its two neighbours. */}
            <button type="button" onClick={downloadOriginal}
              disabled={toolBusy === "download"} data-download-btn title={t("genv3.downloadImage")}
              className="plate flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-60">
              {toolBusy === "download" ? <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
                : <Download size={13} aria-hidden className="shrink-0 text-muted" />}
              <span className="truncate">{t("genv3.downloadImage")}</span>
            </button>
          </div>

          {/* 👍 / 👎 — one vote per result, stored server-side; ranking only. */}
          {item.generationId && <ResultFeedback key={item.generationId} generationId={item.generationId} />}

          {/* The one thing this panel exists to lead to, at full width. */}
          {canRegenerate && (
            <button type="button" onClick={() => onRegenerate(item)} data-regen-cta
              className="cta flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold">
              <Sparkles size={15} aria-hidden />
              {t("genv3.regen")}
            </button>
          )}
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

type Sources = {
  references: string[]; inspirations: string[]; marked: string | null;
  /** False when the job predates reference bookkeeping and nothing could be
   *  recovered — "we did not record this" is not "there was nothing". */
  known: boolean;
};
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
        known: json.known ?? false,
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
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [lightbox, setLightbox] = useState<string | null>(null);

  // The enlarged reference owns Escape while it is open — otherwise the key
  // travels up to the details view and closes the whole thing, throwing the
  // seller out of the image they were only inspecting a source photo of.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setLightbox(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lightbox]);

  // ALWAYS ASK THE SERVER. The gallery's counts come from the job's own
  // settings, and a job made before those settings existed reports zero —
  // which is exactly the row whose references have to be recovered through
  // its prompt session. Short-circuiting on the count printed "no reference
  // photos" over generations that plainly used them.
  useEffect(() => {
    let alive = true;
    const cached = cachedSources(item.generationId);
    if (cached) { setState({ status: "ready", data: cached }); return; }
    setState({ status: "loading" });
    void loadSources(item.generationId).then((data) => {
      if (!alive) return;
      setState(data ? { status: "ready", data } : { status: "error" });
    });
    return () => { alive = false; };
  }, [item.generationId]);

  const data = state.data;
  const shots = data
    ? [
      ...data.references.map((url) => ({ url, kind: t("genv3.sourcesRefs") })),
      ...data.inspirations.map((url) => ({ url, kind: t("genv3.sourcesInsp") })),
      ...(data.marked ? [{ url: data.marked, kind: t("genv3.sourcesMarked") }] : []),
    ]
    : [];
  // One row of four cells. Five or more sources give up the fourth tile to
  // the "+N" counter, so the row never wraps into a ragged second line.
  const MAX_TILES = shots.length > 4 ? 3 : 4;
  const shown = shots.slice(0, MAX_TILES);
  const overflow = shots.length - shown.length;

  return (
    <div data-sources data-sources-status={state.status} data-sources-gen={item.generationId} className="min-w-0 flex-1">
      {/* NO HEADING. A row of photographs at the top of a panel about an
          image is self-evident, and the reference leads with the pictures
          themselves. The explanatory hint goes with it: every tile already
          carries its own kind ("Zdjęcia referencyjne" / "Inspiracje") as a
          title and an aria-label, so the question it answered is answered by
          hovering the thing itself. */}
      {state.status === "loading" && (
        <div className="grid grid-cols-4 gap-2" aria-busy="true">
          {Array.from({ length: Math.min(Math.max(expected, 1), MAX_TILES) }, (_, i) => (
            <span key={i} className="skeleton aspect-[4/3] rounded-xl" />
          ))}
        </div>
      )}
      {state.status === "error" && (
        <p className="text-[11.5px] leading-relaxed text-faint">{t("genv3.sourcesFailed")}</p>
      )}
      {state.status === "ready" && data && (shots.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-faint">
          {data.known ? t("genv3.sourcesNone") : t("genv3.sourcesUnknown")}
        </p>
      ) : (
        // Four across the panel: big enough to recognise the actual photo,
        // which is the entire point of the section.
        <div className="grid grid-cols-4 gap-2">
          {shown.map((s, i) => (
            <button key={s.url} type="button" title={s.kind} data-source-thumb
              aria-label={`${s.kind} — ${t("genv3.sourceAria", { n: i + 1 })}`}
              onClick={() => setLightbox(s.url)}
              className="aspect-[4/3] overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))] transition-all duration-150 hover:ring-[rgb(var(--accent)/0.6)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
          {overflow > 0 && (
            <button type="button" data-source-more onClick={() => setLightbox(shots[MAX_TILES]!.url)}
              aria-label={t("genv3.sourceAria", { n: MAX_TILES + 1 })}
              className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2.5))] bg-sunken/50 text-[13px] font-bold tabular-nums text-muted transition-colors hover:border-[rgb(var(--accent)/0.5)] hover:text-accent">
              +{overflow}
            </button>
          )}
        </div>
      ))}

      {/* One reference, big. A source photo opened in a new tab left the
          seller's own image behind; here it comes back with a click. */}
      {lightbox && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label={t("common.close")} onClick={() => setLightbox(null)}
            className="absolute inset-0 cursor-zoom-out" />
          <div className="relative flex max-h-full max-w-4xl flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox} alt="" className="max-h-[80dvh] max-w-full rounded-xl object-contain" />
            {shots.length > 1 && (
              <div className="thin-scroll flex max-w-full gap-1.5 overflow-x-auto p-1">
                {shots.map((s) => (
                  <button key={s.url} type="button" onClick={() => setLightbox(s.url)} aria-label={s.kind}
                    className={cn("h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition-all",
                      s.url === lightbox ? "ring-accent" : "opacity-70 ring-transparent hover:opacity-100")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The prompt this exact image was rendered from. Long prompts are clipped to
 * a readable box with an expander rather than turned into a scrolling wall —
 * the panel below it still has to be reachable.
 */
function PromptBox({ text, onCopy }: { text: string | null; onCopy: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const long = (text?.length ?? 0) > 220;
  return (
    // NO "Prompt" HEADING. The spark on the left says what this box is, and a
    // seller reading their own sentence back does not need it labelled.
    <div className="relative rounded-xl border border-line bg-sunken/50 py-3 pl-9 pr-9">
      <Sparkles size={14} aria-hidden className="absolute left-3 top-3.5 text-accent" />
      <p data-details-prompt className={cn("whitespace-pre-line text-[12.5px] leading-relaxed text-ink",
        !open && long && "line-clamp-4")}>
        {text ?? <span className="text-faint">{t("genv3.noPrompt")}</span>}
      </p>
      {long && (
        <button type="button" data-prompt-expand onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-[11.5px] font-semibold text-faint transition-colors hover:text-accent">
          {open ? t("genv3.promptCollapse") : t("genv3.promptExpand")}
        </button>
      )}
      {text && (
        <button type="button" aria-label={t("genv3.copyPrompt")} onClick={onCopy}
          className="absolute right-2 top-2.5 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
          <Copy size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * ONE FACT, ONE CELL — the tiles of the info grid. An icon in a tinted
 * square, the name of the thing, then the thing. Two of these per row read
 * faster than six dotted leader lines, which is what the reference is really
 * saying: the panel is scanned, not read.
 */
function InfoTile({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-sunken/50 p-2.5">
      <span aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft/60 text-accent">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] leading-tight text-faint">{label}</p>
        <p className="truncate text-[12.5px] font-semibold leading-tight text-ink" title={value}>{value}</p>
      </div>
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
    <button type="button" onClick={onClick} disabled={disabled || busy} data-edit-tile
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

async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error("png")), "image/png"));
}

