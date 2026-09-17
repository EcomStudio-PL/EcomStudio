"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/notify";
import {
  ArrowUpRight, Brush, Check, Circle as CircleIcon, Eraser, Hand, Loader2, Minus,
  PenLine, RotateCcw, Sparkles, Square, Undo2, Wand2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ModelBadge, ModelTile } from "@/components/genv3/model-select";
import {
  AnnotationCanvas, flattenAnnotations, shapeSignature, toolNibPx,
  type DrawTool, type Shape,
} from "@/components/genv3/draw";
import { snapQuality, unitPrice, type GalleryItem, type GenModel } from "@/components/genv3/types";

/**
 * REGENERUJ OBRAZ — corrections in the customer's words AND on the pixels.
 *
 * The text instruction rides server-side as an appendix to the generation's
 * real prompt (hidden engine prompt or the customer's own). The drawing
 * tools are REAL: annotations are vector shapes on a canvas over the image;
 * on submit they are flattened onto a copy of the image, uploaded, and sent
 * to the backend as a marked guidance reference with an explicit contract
 * (marks locate changes, marks are never rendered).
 */

const COLORS = ["#a855f7", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#ffffff"];

/** How long the size preview stays after the last change to the slider. Long
 *  enough to read the final size, short enough that it is never "on". */
const SIZE_ECHO_MS = 500;

export function RegenerateModal({ item, models, balance, onClose, onDone }: {
  item: GalleryItem;
  models: GenModel[];
  balance: number;
  onClose: () => void;
  onDone: (credits: number) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [instruction, setInstruction] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Drawing state ──────────────────────────────────────────────────────
  const [tool, setTool] = useState<DrawTool>("brush");
  const [color, setColor] = useState(COLORS[0]);
  const [sizePx, setSizePx] = useState(12);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [undoStack, setUndoStack] = useState<Shape[][]>([]);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  // One uploaded markup file per distinct drawing: a failed attempt (network,
  // 402, 409) must not leave a new orphan in storage on every retry.
  const uploaded = useRef<{ sig: string; path: string } | null>(null);

  // Switching to a different image drops the annotations — they were drawn
  // over other pixels.
  useEffect(() => { setShapes([]); setUndoStack([]); uploaded.current = null; }, [item.assetId]);

  /**
   * HOW BIG IS 24px? — the size preview.
   *
   * The slider said "24px" and the customer had to draw a line to find out
   * what that meant, undo it, and try again. So while the size is being
   * changed, a circle of the REAL nib appears over the middle of the picture:
   * not an icon of a brush, the actual diameter the next stroke will have.
   *
   * IT IS A DOM NODE, NEVER A MARK. Nothing here touches `shapes`,
   * `undoStack`, the canvas or the flattened copy that travels to the
   * backend — moving the slider leaves the image exactly as it found it.
   *
   * VISIBLE WHILE THE SIZE IS MOVING, and for a breath afterwards: holding
   * the slider keeps it up (`sizing`), and every change restarts a short
   * linger (`echo`) so the final size is still on screen when the finger
   * lifts. It never stays.
   */
  const [sizing, setSizing] = useState(false);
  const [echo, setEcho] = useState(false);
  const echoTimer = useRef<number | null>(null);
  const pingSize = useCallback(() => {
    setEcho(true);
    if (echoTimer.current !== null) window.clearTimeout(echoTimer.current);
    echoTimer.current = window.setTimeout(() => setEcho(false), SIZE_ECHO_MS);
  }, []);
  useEffect(() => () => {
    if (echoTimer.current !== null) window.clearTimeout(echoTimer.current);
  }, []);
  // The pointer that drags a range input can be released anywhere — over the
  // panel, over the picture, off the window. The end of the drag is therefore
  // listened for globally, or a release outside the slider would leave the
  // preview pinned to the image.
  useEffect(() => {
    if (!sizing) return;
    const end = () => { setSizing(false); pingSize(); };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    // A window that loses focus mid-drag (Alt+Tab, a notification, the OS
    // taking over) may never deliver the release. Without this the ring would
    // still be sitting on the picture when the customer came back — the one
    // thing it must never do.
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [sizing, pingSize]);
  const nib = toolNibPx(tool, sizePx);
  const showNib = nib !== null && (sizing || echo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, busy]);

  // Cost preview mirrors the server's originCost: base price at this image's
  // resolution, plus the engine surcharge for managed generations. The quote
  // is keyed on the REAL model id that served this image — when that model is
  // no longer offered here, no price is invented: the customer must pick one.
  const sameModel = useMemo(
    () => models.find((m) => m.id === item.modelId),
    [models, item.modelId],
  );
  const chosen = modelId ? models.find((m) => m.id === modelId) : sameModel;
  const mode = item.origin === "engine" ? "managed" : "custom";
  const priceAt = (m: GenModel | undefined) => m
    // The retake renders at the ORIGINAL's quality (the server forwards it
    // from the job), so the quote must be priced at that quality too — or
    // the modal would promise the base price and the ledger would charge more.
    ? unitPrice(m, item.resolution && m.resolutions.includes(item.resolution) ? item.resolution : m.resolutions[0] ?? "1K", mode, snapQuality(m, item.quality ?? "medium"))
    : 0;
  const cost = priceAt(chosen);
  const notEnough = !!chosen && cost > balance;

  // Only models that can carry the reference photos qualify for a switch —
  // regenerating without references would break product fidelity.
  const switchable = models.filter((m) => m.supportsRefs);

  // Original model gone from this page's list → force an explicit switch.
  useEffect(() => {
    if (!sameModel && modelId === null) setModelId(switchable[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameModel]);

  const gestureStart = () => setUndoStack((prev) => [...prev.slice(-29), shapes]);
  const undo = () => setUndoStack((prev) => {
    if (prev.length === 0) return prev;
    setShapes(prev[prev.length - 1]);
    return prev.slice(0, -1);
  });
  const reset = () => { if (shapes.length > 0) { gestureStart(); setShapes([]); } };

  async function run() {
    if (busy || notEnough || !chosen) return;
    setBusy(true);
    try {
      // Flatten + upload the marked copy FIRST — if the marks cannot travel,
      // nothing is generated (no silent mark-less regeneration).
      let markedImagePath: string | undefined;
      if (shapes.length > 0) {
        const sig = shapeSignature(item.assetId, shapes);
        if (uploaded.current?.sig === sig) {
          markedImagePath = uploaded.current.path;
        } else {
          const blob = await flattenAnnotations(item.url, shapes);
          if (!blob) { toast.error(t("genv3.regenMarkFailed")); return; }
          const ws = item.path.split("/")[0];
          const ext = blob.type.includes("webp") ? "webp" : "jpg";
          const path = `${ws}/markup/${crypto.randomUUID()}.${ext}`;
          const { error } = await createClient().storage.from("product-images")
            .upload(path, blob, { contentType: blob.type });
          if (error) { toast.error(t("genv3.regenMarkFailed")); return; }
          uploaded.current = { sig, path };
          markedImagePath = path;
        }
      }

      const res = await fetch("/api/generations/regenerate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationId: item.generationId,
          instruction: instruction.trim() || undefined,
          modelId: modelId ?? undefined,
          markedImagePath,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string; credits?: number };
      if (json.ok) {
        toast.success(t("genv3.regenDone"));
        await onDone(json.credits ?? cost);
      } else if (json.error === "insufficient_credits") {
        toast.error(t("studio.err.insufficient_credits"));
      } else if (json.error === "already_running") {
        toast.error(t("genv3.regenRunning"));
      } else {
        const known = t(`studio.err.${json.error}`, {});
        toast.error(known && known !== `studio.err.${json.error}` ? known : t("common.error"));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const tools: { key: DrawTool; icon: typeof Brush; label: string }[] = [
    { key: "brush", icon: Brush, label: t("genv3.toolBrush") },
    { key: "eraser", icon: Eraser, label: t("genv3.toolEraser") },
    { key: "rect", icon: Square, label: t("genv3.toolRect") },
    { key: "circle", icon: CircleIcon, label: t("genv3.toolCircle") },
    { key: "line", icon: Minus, label: t("genv3.toolLine") },
    { key: "arrow", icon: ArrowUpRight, label: t("genv3.toolArrow") },
    { key: "hand", icon: Hand, label: t("genv3.toolHand") },
    { key: "magic", icon: Wand2, label: t("genv3.toolMagic") },
  ];

  // TWO ENGINES, NOT A CATALOGUE.
  //
  // A correction is a choice between "the one that made this" and "the one
  // that is best at edits" — a six-row price list is a decision the customer
  // did not ask to make. The recommendation is NOT hardcoded to a name: it is
  // whichever active engine the admin panel badges `recommended`, so the
  // catalogue stays the source of truth. If nothing is badged, or the badged
  // engine is the one that made the image, there is simply one row.
  const recommended = switchable.find((m) => m.badge === "recommended" && m.id !== sameModel?.id);
  const engines = [
    sameModel ? { model: sameModel, previous: true } : null,
    recommended ? { model: recommended, previous: false } : null,
  ].filter(Boolean) as { model: GenModel; previous: boolean }[];

  return (
    <div role="dialog" aria-modal="true" aria-label={t("genv3.regenTitle")}
      className="workspace fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-4">
      <button type="button" aria-label={t("common.close")} onClick={() => !busy && onClose()}
        className="scrim absolute inset-0 cursor-default backdrop-blur-[10px]" />
      {/* An editor, not a dialog: the picture being corrected takes every
          pixel the panel does not need, and the panel is a fixed, comfortable
          column rather than a share of the width. */}
      <div data-regen-modal
        className="overlay animate-pop relative flex h-full w-full min-w-0 flex-col overflow-y-auto rounded-none p-3 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-3rem)] sm:max-w-[1920px] sm:rounded-2xl sm:p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(370px,400px)] lg:gap-5 lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_430px]">
        <button type="button" aria-label={t("common.close")} onClick={() => !busy && onClose()}
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink">
          <X size={17} aria-hidden />
        </button>

        {/* ── THE PICTURE ────────────────────────────────────────────────
            One image and the canvas over it. No filmstrip, no prev/next, no
            format chip: this window exists to correct THIS image, and every
            one of those was an invitation to leave it mid-edit — taking the
            annotations with it, because marks belong to the pixels they were
            drawn on. */}
        <div className="flex min-w-0 items-center justify-center overflow-hidden rounded-2xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))] lg:max-h-[calc(100dvh-3rem)]">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.product ?? ""} draggable={false} data-regen-image
              className="block max-h-[38dvh] w-auto max-w-full select-none lg:max-h-[calc(100dvh-5rem)]" />
            <AnnotationCanvas
              className="absolute inset-0"
              url={item.url}
              shapes={shapes}
              tool={tool}
              color={color}
              sizePx={sizePx}
              onGestureStart={gestureStart}
              onChange={setShapes}
            />
            {/* THE SIZE PREVIEW — a DOM ring over the picture, drawn at the
                real nib diameter.

                `pointer-events-none` is load-bearing, not tidiness: the
                canvas captures the pointer on `e.target`, so a hit-testable
                node on top would take the capture and every stroke would
                freeze after its first point.

                NO z-index. This box (`relative`, no z-index) creates no
                stacking context, so a z-index here would escape it and paint
                over the modal's own close button. Being last in the DOM is
                all the "on top" this needs.

                Two rings and the pen's own colour between them: legible on a
                white sofa and on a black shadow, without glowing. */}
            {showNib && (
              <span aria-hidden data-brush-preview data-nib={nib}
                className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: nib, height: nib,
                  transform: "translate(-50%, -50%)",
                  // `border-box` (Tailwind's preflight) puts the border INSIDE
                  // the box, so the outer diameter is the nib to the pixel.
                  borderStyle: "solid",
                  borderWidth: nib >= 8 ? 1.5 : 1,
                  borderColor: color,
                  boxShadow: "0 0 0 1px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.85)",
                }} />
            )}
          </div>
        </div>

        {/* ── THE PANEL ──────────────────────────────────────────────────
            No section headings. Each control says what it is by being what it
            is: a box you type in, two buttons that undo, eight tools, a
            colour and a size, two engines, one green light. */}
        <div className="thin-scroll mt-3 flex min-w-0 flex-col gap-3 lg:mt-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:pr-1 lg:pt-8">
          <div className="relative">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("genv3.regenPh")}
              aria-label={t("genv3.regenDescribe")}
              data-regen-instruction
              className="w-full resize-y rounded-xl border border-line bg-sunken/50 p-3 pb-7 pl-9 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.5)]"
            />
            <PenLine size={14} aria-hidden className="pointer-events-none absolute left-3 top-3.5 text-accent" />
            <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] font-medium tabular-nums text-faint">
              {instruction.length}/500
            </span>
          </div>

          {/* Undo and clear, side by side and equal — they are one pair. */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={undo} disabled={undoStack.length === 0} data-regen-undo
              className="plate flex h-10 items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-40">
              <Undo2 size={14} aria-hidden className="text-muted" />{t("genv3.regenUndo")}
            </button>
            <button type="button" onClick={reset} disabled={shapes.length === 0} data-regen-reset
              className="plate flex h-10 items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-40">
              <RotateCcw size={14} aria-hidden className="text-muted" />{t("genv3.regenReset")}
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1.5" data-regen-tools>
            {tools.map((tl) => {
              const on = tool === tl.key;
              return (
                <button key={tl.key} type="button" aria-pressed={on} onClick={() => setTool(tl.key)}
                  data-regen-tool={tl.key}
                  className={cn(
                    "flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 transition-colors duration-150",
                    on ? "is-selected" : "border-line text-muted hover:bg-raised",
                  )}>
                  <tl.icon size={17} aria-hidden className={on ? "text-accent" : "text-faint"} />
                  <span className="text-[10.5px] font-semibold leading-none">{tl.label}</span>
                </button>
              );
            })}
          </div>

          {/* Colour and size on one line: both describe the same pen. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl border border-line bg-sunken/40 px-3 py-2.5">
            <span className="flex items-center gap-1.5" role="radiogroup" aria-label={t("genv3.toolColorAria")}>
              {COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-[22px] w-[22px] rounded-full border border-black/20 transition-transform",
                    color === c && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-[rgb(var(--surface))]",
                  )}
                  style={{ backgroundColor: c }} />
              ))}
              <label className={cn(
                "relative h-[22px] w-[22px] cursor-pointer overflow-hidden rounded-full border border-black/20",
                !COLORS.includes(color) && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-[rgb(var(--surface))]",
              )}
                style={{ background: "conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)" }}
                title={t("genv3.toolCustomColor")}>
                <input type="color" value={color} aria-label={t("genv3.toolCustomColor")}
                  onChange={(e) => setColor(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              </label>
            </span>
            <label className="flex min-w-[130px] flex-1 items-center gap-2.5 text-[11.5px] font-semibold text-muted">
              <span className="shrink-0">{t("genv3.toolSize")}</span>
              <input type="range" min={2} max={40} step={1} value={sizePx}
                // `onChange` on a range is the browser's `input` event, so it
                // covers the arrow keys, Home/End and Page Up/Down as well as
                // a drag — the preview answers the keyboard too.
                onChange={(e) => { setSizePx(Number(e.target.value)); pingSize(); }}
                // PRIMARY BUTTON ONLY, the same guard the drawing surface
                // uses: a right-click opens the context menu and the release
                // that would take the ring down again may never reach the
                // page, leaving it stranded on the picture.
                onPointerDown={(e) => { if (e.button === 0 || e.pointerType !== "mouse") setSizing(true); }}
                data-regen-size
                className="gb-range h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[rgb(var(--ink)/0.14)]" />
              <span className="w-9 shrink-0 text-right tabular-nums text-faint">{sizePx}px</span>
            </label>
          </div>

          {/* ── THE ENGINE ─────────────────────────────────────────────── */}
          <div className="space-y-2" data-regen-models>
            {!sameModel && (
              <p className="rounded-xl bg-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
                {t("genv3.regenModelGone")}
              </p>
            )}
            {engines.map(({ model: m, previous }, idx) => {
              const on = modelId ? modelId === m.id : previous;
              return (
                <button key={m.id} type="button" aria-pressed={on} data-regen-model={m.id}
                  onClick={() => setModelId(previous ? null : m.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-200",
                    on ? "is-selected" : "border-line hover:bg-raised",
                  )}>
                  <ModelTile name={m.name} index={idx} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate text-[13px] font-semibold">{m.name}</span>
                      <ModelBadge model={m} />
                    </span>
                    <span className="truncate text-[11px] text-faint">
                      {previous ? t("genv3.regenPrevSub") : t("genv3.regenRecoSub")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-accent">
                    {t("genv3.perUseShort", { n: priceAt(m) })}
                  </span>
                  <Check size={16} aria-hidden
                    className={cn("shrink-0 transition-opacity", on ? "text-accent opacity-100" : "opacity-0")} />
                </button>
              );
            })}
          </div>

          {/* The decision, at the foot of the panel it belongs to. */}
          <div className="mt-auto space-y-2 pt-1 pb-[max(0px,env(safe-area-inset-bottom))]">
            {notEnough && (
              <p className="text-center text-[11.5px] font-medium text-danger">{t("studio.err.insufficient_credits")}</p>
            )}
            <button type="button" disabled={busy || notEnough || !chosen} onClick={run} data-regen-run
              className={cn("cta flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold",
                (busy || notEnough || !chosen) && "cursor-not-allowed opacity-55")}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
              {busy ? t("genv3.regenBusy") : t("genv3.regenGenerate")}
              {!busy && !!chosen && <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[12px] tabular-nums">◇ {n(cost)}</span>}
            </button>
            <button type="button" disabled={busy} onClick={onClose} data-regen-cancel
              className="plate flex h-12 w-full items-center justify-center rounded-xl text-[13px] font-semibold text-muted transition-colors hover:bg-raised">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
