"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight, Brush, ChevronLeft, ChevronRight, Circle as CircleIcon, Eraser, Hand,
  Loader2, Minus, PenLine, RefreshCw, Sparkles, Square, Wand2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ModelBadge, ModelTile } from "@/components/genv3/model-select";
import { AnnotationCanvas, flattenAnnotations, type DrawTool, type Shape } from "@/components/genv3/draw";
import { unitPrice, type GalleryItem, type GenModel } from "@/components/genv3/types";

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

export function RegenerateModal({ item, siblings, models, balance, onPick, onClose, onDone }: {
  item: GalleryItem;
  siblings: GalleryItem[];
  models: GenModel[];
  balance: number;
  onPick: (item: GalleryItem) => void;
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

  // Switching to a different image drops the annotations — they were drawn
  // over other pixels.
  useEffect(() => { setShapes([]); setUndoStack([]); }, [item.assetId]);

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
    ? unitPrice(m, item.resolution && m.resolutions.includes(item.resolution) ? item.resolution : m.resolutions[0] ?? "1K", mode)
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
        const blob = await flattenAnnotations(item.url, shapes);
        if (!blob) { toast.error(t("genv3.regenMarkFailed")); return; }
        const ws = item.path.split("/")[0];
        const ext = blob.type.includes("webp") ? "webp" : "jpg";
        const path = `${ws}/markup/${crypto.randomUUID()}.${ext}`;
        const { error } = await createClient().storage.from("product-images")
          .upload(path, blob, { contentType: blob.type });
        if (error) { toast.error(t("genv3.regenMarkFailed")); return; }
        markedImagePath = path;
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

  return (
    <div role="dialog" aria-modal="true" aria-label={t("genv3.regenTitle")}
      className="workspace fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-4">
      <button type="button" aria-label={t("common.close")} onClick={() => !busy && onClose()}
        className="scrim absolute inset-0 cursor-default backdrop-blur-[6px]" />
      <div className="overlay animate-pop relative flex h-full w-full min-w-0 flex-col overflow-y-auto rounded-none p-4 sm:h-auto sm:max-h-[94dvh] sm:max-w-4xl sm:rounded-2xl sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-semibold tracking-tight">{t("genv3.regenTitle")}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">{t("genv3.regenSub")}</p>
          </div>
          <button type="button" aria-label={t("common.close")} onClick={() => !busy && onClose()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* ── Image + annotation canvas + filmstrip ─────────────────── */}
          <div className="min-w-0">
            <div className="flex justify-center overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.product ?? ""} draggable={false}
                  className="block max-h-[40dvh] w-auto max-w-full select-none lg:max-h-[46dvh]" />
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
              </div>
            </div>
            {siblings.length > 1 && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <button type="button" aria-label={t("genv3.prev")}
                  onClick={() => {
                    const i = siblings.findIndex((s) => s.assetId === item.assetId);
                    if (i > 0) onPick(siblings[i - 1]);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised">
                  <ChevronLeft size={14} aria-hidden />
                </button>
                <div className="thin-scroll flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
                  {siblings.slice(0, 14).map((s) => (
                    <button key={s.assetId} type="button" aria-label={s.product ?? ""}
                      aria-current={s.assetId === item.assetId}
                      onClick={() => onPick(s)}
                      className={cn(
                        "h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition-all duration-150",
                        s.assetId === item.assetId ? "ring-accent" : "opacity-70 ring-transparent hover:opacity-100",
                      )}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
                <button type="button" aria-label={t("genv3.next")}
                  onClick={() => {
                    const i = siblings.findIndex((s) => s.assetId === item.assetId);
                    if (i >= 0 && i < siblings.length - 1) onPick(siblings[i + 1]);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised">
                  <ChevronRight size={14} aria-hidden />
                </button>
              </div>
            )}
          </div>

          {/* ── Instruction + tools + model ───────────────────────────── */}
          <div className="min-w-0 space-y-4">
            <div>
              <p className="mb-1.5 text-[13px] font-semibold tracking-tight">1. {t("genv3.regenDescribe")}</p>
              <div className="relative">
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={t("genv3.regenPh")}
                  aria-label={t("genv3.regenDescribe")}
                  className="w-full resize-y rounded-xl border border-line bg-sunken/50 p-3 pb-6 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.5)]"
                />
                <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] font-medium tabular-nums text-faint">
                  {instruction.length}/500
                </span>
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-faint">{t("genv3.regenEmptyHint")}</p>
            </div>

            {/* 2. Mark the changes — the REAL tools */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold tracking-tight">
                  2. {t("genv3.regenMark")}{" "}
                  <span className="font-normal text-faint">({t("genv3.optional")})</span>
                </p>
                <span className="flex shrink-0 gap-1">
                  <button type="button" onClick={undo} disabled={undoStack.length === 0}
                    className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-raised disabled:opacity-40">
                    {t("genv3.regenUndo")}
                  </button>
                  <button type="button" onClick={reset} disabled={shapes.length === 0}
                    className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-raised disabled:opacity-40">
                    {t("genv3.regenReset")}
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {tools.map((tl) => {
                  const on = tool === tl.key;
                  return (
                    <button key={tl.key} type="button" aria-pressed={on} onClick={() => setTool(tl.key)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-colors duration-150",
                        on ? "is-selected" : "border-line text-muted hover:bg-raised",
                      )}>
                      <tl.icon size={15} aria-hidden className={on ? "text-accent" : "text-faint"} />
                      <span className="text-[9.5px] font-semibold leading-none">{tl.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="flex items-center gap-1.5" role="radiogroup" aria-label={t("genv3.toolColorAria")}>
                  {COLORS.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "h-6 w-6 rounded-full border border-black/20 transition-transform",
                        color === c && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-[rgb(var(--surface))]",
                      )}
                      style={{ backgroundColor: c }} />
                  ))}
                  <label className={cn(
                    "relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-black/20",
                    !COLORS.includes(color) && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-[rgb(var(--surface))]",
                  )}
                    style={{ background: "conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444)" }}
                    title={t("genv3.toolCustomColor")}>
                    <input type="color" value={color} aria-label={t("genv3.toolCustomColor")}
                      onChange={(e) => setColor(e.target.value)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  </label>
                </span>
                <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-semibold text-muted">
                  <span className="shrink-0">{t("genv3.toolSize")}</span>
                  <input type="range" min={2} max={40} step={1} value={sizePx}
                    onChange={(e) => setSizePx(Number(e.target.value))}
                    className="h-1 min-w-0 flex-1 accent-[rgb(var(--accent))]" />
                  <span className="w-9 shrink-0 text-right tabular-nums text-faint">{sizePx}px</span>
                </label>
              </div>
              <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-line bg-sunken/40 px-3 py-2.5">
                <PenLine size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" />
                <p className="text-[11px] leading-relaxed text-muted">{t("genv3.regenToolsNote")}</p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[13px] font-semibold tracking-tight">3. {t("genv3.regenModel")}</p>
              <div className="space-y-1.5">
                {sameModel ? (
                  <button type="button" aria-pressed={modelId === null} onClick={() => setModelId(null)}
                    className={cn("flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors duration-200",
                      modelId === null ? "is-selected" : "border-line hover:bg-raised")}>
                    <RefreshCw size={14} aria-hidden className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 text-[13px] font-semibold">{t("genv3.regenSameModel")}</span>
                    <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-accent">
                      {t("genv3.perShotShort", { n: priceAt(sameModel) })}
                    </span>
                  </button>
                ) : (
                  <p className="rounded-xl bg-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
                    {t("genv3.regenModelGone")}
                  </p>
                )}
                {switchable.filter((m) => m.id !== sameModel?.id || modelId !== null).slice(0, 6).map((m, idx) => {
                  const on = modelId === m.id;
                  return (
                    <button key={m.id} type="button" aria-pressed={on} onClick={() => setModelId(on ? null : m.id)}
                      className={cn("flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors duration-200",
                        on ? "is-selected" : "border-line hover:bg-raised")}>
                      <ModelTile name={m.name} index={idx} size="sm" />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="min-w-0 truncate text-[12.5px] font-semibold">{m.name}</span>
                        <ModelBadge model={m} />
                      </span>
                      <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-accent">
                        {t("genv3.perShotShort", { n: priceAt(m) })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4 pb-[max(0px,env(safe-area-inset-bottom))]">
          {notEnough && <p className="mr-auto text-[11.5px] font-medium text-danger">{t("studio.err.insufficient_credits")}</p>}
          <button type="button" disabled={busy} onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-raised">
            {t("common.cancel")}
          </button>
          <button type="button" disabled={busy || notEnough || !chosen} onClick={run}
            className={cn("cta flex h-11 items-center gap-2 rounded-xl px-5 text-[13.5px] font-semibold",
              (busy || notEnough || !chosen) && "cursor-not-allowed opacity-55")}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
            {busy ? t("genv3.regenBusy") : t("genv3.regenCta")}
            {!busy && !!chosen && <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[12px] tabular-nums">◇ {n(cost)}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
