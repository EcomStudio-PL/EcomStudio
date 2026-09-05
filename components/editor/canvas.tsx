"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { EditorRatio, EditorState } from "@/lib/images/editor-state";
import { cn } from "@/lib/utils";

/**
 * EDITOR CANVAS — the instant, approximate preview.
 *
 * Nothing here produces the file the seller downloads. This draws the SAME
 * state the server bakes, at screen resolution, with the 2D context's own
 * filter and transforms — so dragging a slider costs one repaint instead of a
 * round trip, and the customer sees the composition change while their finger
 * is still moving. The honest export lives in composeEditor (sharp), and
 * `editor.previewNote` under the canvas says so.
 *
 * Two approximations are deliberate and cannot be closed in a browser:
 * temperature is a flat warm/cool tint here versus a per-channel gain in the
 * bake, and a positive sharpness has no 2D-context equivalent at all, so it
 * simply does not appear until the file is rendered.
 */

/** Long side of the preview bitmap. Beyond this the redraw starts to cost
 *  more than the interaction is worth, and no screen shows the difference. */
const PREVIEW_MAX = 1400;

/**
 * Mirrors composeEditor's box maths (lib/images/local.ts). It is duplicated
 * rather than imported because that module is server-only — it carries sharp —
 * and a preview that framed the shot differently from the export would be
 * worse than no preview at all. Both sides read the same clamped state.
 */
const RATIO_VALUE: Record<EditorRatio, number | null> = {
  original: null,
  custom: null,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

const MAX_SIDE = 8000;
const side = (value: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(value)));

function targetBox(frame: { width: number; height: number }, f: EditorState["format"]) {
  const asked = RATIO_VALUE[f.ratio];
  const aspect = asked ?? frame.width / frame.height;
  let width = f.width;
  let height = f.height;

  if (width !== null && (height === null || f.lockRatio)) height = Math.round(width / aspect);
  else if (width === null && height !== null) width = Math.round(height * aspect);
  else if (width === null && height === null) {
    if (asked === null) return { width: frame.width, height: frame.height };
    const current = frame.width / frame.height;
    width = current < asked ? Math.round(frame.height * asked) : frame.width;
    height = current < asked ? frame.height : Math.round(frame.width / asked);
  }
  return { width: side(width ?? frame.width), height: side(height ?? frame.height) };
}

export function EditorCanvas({ image, state, hasAlpha, zoom, resetKey, busy }: {
  image: HTMLImageElement | null;
  state: EditorState;
  /** Whether the working image is a cutout — decides the checkerboard. */
  hasAlpha: boolean;
  /** Percent of the fitted size: 100 fills the viewport, 400 is a 4× loupe. */
  zoom: number;
  /** Bumped by "Dopasuj" / "Wyśrodkuj" to recentre the view. */
  resetKey: number;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** One reused offscreen canvas: the product frame before it is placed. */
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // ── the draw ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !image.naturalWidth || !image.naturalHeight) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const srcW = image.naturalWidth;
    const srcH = image.naturalHeight;
    const tr = state.transform;
    const rad = (tr.rotate * Math.PI) / 180;

    // A free angle grows the canvas to its bounding box — the same frame the
    // bake works in, so every percentage below means the same thing on both.
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const frameW = tr.rotate === 0 ? srcW : Math.round(srcW * cos + srcH * sin);
    const frameH = tr.rotate === 0 ? srcH : Math.round(srcW * sin + srcH * cos);

    // dropShadow grows the canvas so the blurred, offset silhouette is not
    // clipped; that ring is part of the framing, so the preview grows too.
    //
    // No cutout, no shadow: the bake refuses to invent a silhouette for an
    // opaque photo, and casting one from the photo's rectangle here would draw
    // a box the export will never produce. The panel says why.
    const shadowOn = state.shadow.preset !== "none" && hasAlpha;
    const ring = shadowOn
      ? Math.round(state.shadow.blur * 3
        + Math.max(Math.abs(state.shadow.offsetX), Math.abs(state.shadow.offsetY))
        + frameW * 0.04)
      : 0;
    const castW = frameW + ring * 2;
    const castH = frameH + ring * 2;

    const target = targetBox({ width: castW, height: castH }, state.format);
    // Fit inside and pad out to the box: the product is never cropped to reach
    // a ratio and never enlarged to reach a size.
    const fitRatio = Math.min(target.width / castW, target.height / castH, 1);
    const innerW = Math.max(1, Math.round(castW * fitRatio));
    const innerH = Math.max(1, Math.round(castH * fitRatio));
    const padLeft = Math.floor((target.width - innerW) / 2);
    const padTop = Math.floor((target.height - innerH) / 2);

    // One scale from full-resolution pixels to preview pixels, so blur radii
    // and offsets stay proportional to the product at any preview size.
    const preview = Math.min(1, PREVIEW_MAX / Math.max(target.width, target.height));
    const k = fitRatio * preview;

    const width = Math.max(1, Math.round(target.width * preview));
    const height = Math.max(1, Math.round(target.height * preview));
    canvas.width = width;
    canvas.height = height;
    setBox((prev) => (prev.width === target.width && prev.height === target.height
      ? prev
      : { width: target.width, height: target.height }));

    // ── the product frame ────────────────────────────────────────────────
    const frame = frameRef.current ?? (frameRef.current = document.createElement("canvas"));
    const fw = Math.max(1, Math.round(frameW * k));
    const fh = Math.max(1, Math.round(frameH * k));
    frame.width = fw;
    frame.height = fh;
    const fx = frame.getContext("2d");
    if (!fx) return;
    fx.imageSmoothingQuality = "high";
    fx.filter = filterFor(state.adjust, k);
    // The flip is applied INSIDE the rotation, because that is the order the
    // bake uses: mirror first, then turn the mirrored photo.
    const scale = tr.scale / 100;
    fx.translate(fw / 2 + (fw * tr.offsetX) / 100, fh / 2 + (fh * tr.offsetY) / 100);
    fx.scale(scale, scale);
    fx.rotate(rad);
    fx.scale(tr.flipH ? -1 : 1, tr.flipV ? -1 : 1);
    fx.drawImage(image, (-srcW * k) / 2, (-srcH * k) / 2, srcW * k, srcH * k);
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.filter = "none";

    if (state.adjust.temperature !== 0) {
      // "source-atop" paints only where the product already is, so a cutout
      // keeps its transparent surround instead of gaining a tinted rectangle.
      fx.globalCompositeOperation = "source-atop";
      const strength = (Math.abs(state.adjust.temperature) / 100) * 0.22;
      fx.fillStyle = state.adjust.temperature > 0
        ? `rgba(255, 168, 76, ${strength})`
        : `rgba(76, 168, 255, ${strength})`;
      fx.fillRect(0, 0, fw, fh);
      fx.globalCompositeOperation = "source-over";
    }

    // ── the plate ────────────────────────────────────────────────────────
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    if (state.background.mode === "color") {
      ctx.fillStyle = state.background.color;
      ctx.fillRect(0, 0, width, height);
    }

    if (shadowOn) {
      // The context casts the shadow from the drawn bitmap's own alpha — the
      // same silhouette dropShadow blurs server-side. shadowBlur is twice the
      // gaussian sigma, which is what sharp's blur() takes.
      ctx.shadowColor = rgba(state.shadow.color, state.shadow.opacity / 100);
      ctx.shadowBlur = state.shadow.blur * k * 2;
      ctx.shadowOffsetX = state.shadow.offsetX * k;
      ctx.shadowOffsetY = state.shadow.offsetY * k;
    }
    ctx.drawImage(
      frame,
      Math.round((padLeft + ring * fitRatio) * preview),
      Math.round((padTop + ring * fitRatio) * preview),
      fw, fh,
    );
    ctx.shadowColor = "rgba(0, 0, 0, 0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }, [image, state, hasAlpha]);

  // ── fitting the plate into the column ──────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setView({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setPan({ x: 0, y: 0 }); }, [resetKey]);

  const fit = box.width > 0 && view.width > 0
    ? Math.min(view.width / box.width, view.height / box.height)
    : 0;
  const cssWidth = box.width * fit * (zoom / 100);
  const cssHeight = box.height * fit * (zoom / 100);
  const overflowX = Math.max(0, (cssWidth - view.width) / 2);
  const overflowY = Math.max(0, (cssHeight - view.height) / 2);
  const draggable = overflowX > 0 || overflowY > 0;
  // The checkerboard is the canvas element's own background, so it shows
  // through exactly the pixels the export will leave transparent.
  const checker = state.background.mode === "transparent"
    || (state.background.mode === "keep" && hasAlpha);

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggable) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const from = drag.current;
    if (!from) return;
    setPan({
      x: clamp(from.panX + (event.clientX - from.x), -overflowX, overflowX),
      y: clamp(from.panY + (event.clientY - from.y), -overflowY, overflowY),
    });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      className={cn(
        "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-sunken/60 p-3",
        "border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.9))]",
        draggable && "cursor-grab touch-none active:cursor-grabbing",
      )}
    >
      {/* `max-w-none` on purpose: a zoomed plate is SUPPOSED to be wider than
          its column, and the wrapper clips it. Before the first measurement it
          is sized to nothing rather than to its bitmap, so the column never
          flashes a full-resolution canvas. */}
      <canvas
        ref={canvasRef}
        className={cn("max-w-none rounded-lg shadow-e2", checker && "bg-checker")}
        style={{
          width: `${Math.max(0, cssWidth)}px`,
          height: `${Math.max(0, cssHeight)}px`,
          transform: `translate(${pan.x}px, ${pan.y}px)`,
        }}
      />
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[rgb(var(--bg)/0.55)] backdrop-blur-[2px]">
          <Loader2 size={16} className="animate-spin text-accent" aria-hidden />
          <span className="text-[12.5px] font-semibold">{t("editor.working")}</span>
        </div>
      )}
    </div>
  );
}

/** Only the adjustments a 2D context can genuinely reproduce. */
function filterFor(adjust: EditorState["adjust"], scale: number): string {
  const parts: string[] = [];
  if (adjust.brightness !== 0) parts.push(`brightness(${(1 + adjust.brightness / 100).toFixed(3)})`);
  if (adjust.contrast !== 0) parts.push(`contrast(${(1 + adjust.contrast / 100).toFixed(3)})`);
  if (adjust.saturation !== 0) parts.push(`saturate(${Math.max(0, 1 + adjust.saturation / 100).toFixed(3)})`);
  // Softening is a real gaussian on both sides; sharpening is an unsharp mask,
  // which the context cannot do — so it appears in the exported file only.
  if (adjust.sharpness < 0) {
    parts.push(`blur(${((0.3 + (-adjust.sharpness / 100) * 2.7) * scale).toFixed(2)}px)`);
  }
  return parts.length > 0 ? parts.join(" ") : "none";
}

function rgba(hex: string, alpha: number): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "000000";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
