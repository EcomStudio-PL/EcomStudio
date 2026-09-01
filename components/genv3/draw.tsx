"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ANNOTATION ENGINE for the regenerate modal — real drawing tools, not
 * props. Shapes live as VECTOR objects in normalized image coordinates
 * (0..1 of the displayed image box), so the same list renders crisply on
 * the on-screen canvas at any size AND flattens 1:1 onto the full-size
 * image copy that travels to the backend as the marked guidance reference.
 *
 * Tools: brush (freehand), eraser (removes the element under the cursor),
 * rect / circle / line / arrow (drag to size), hand (drags an existing
 * element around), magic (color-similarity region select — a classic
 * flood-fill wand computed client-side on the actual pixels).
 */

export type DrawTool = "brush" | "eraser" | "rect" | "circle" | "line" | "arrow" | "hand" | "magic";

type Pt = { x: number; y: number };

export type Shape =
  | { kind: "stroke"; pts: Pt[]; color: string; size: number }
  | { kind: "rect" | "circle" | "line" | "arrow"; a: Pt; b: Pt; color: string; size: number }
  /** Magic-wand selection: a tinted raster mask in its own working
   *  resolution, drawn scaled over the image; dx/dy let the hand move it. */
  | { kind: "magic"; mask: HTMLCanvasElement; color: string; dx: number; dy: number };

/* `size` is stored as a FRACTION OF THE IMAGE WIDTH — display-independent. */

// ── Image pixels (for the wand + the flatten step) ─────────────────────────
const bitmapCache = new Map<string, Promise<ImageBitmap | null>>();

function loadBitmap(url: string): Promise<ImageBitmap | null> {
  let p = bitmapCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("fetch"))))
      .then((b) => createImageBitmap(b))
      // Only SUCCESSES are worth caching: a signed URL that expired or a
      // network blip must not poison the wand and the flatten step until a
      // full reload — drop the entry so the next attempt really retries.
      .catch(() => { bitmapCache.delete(url); return null; });
    bitmapCache.set(url, p);
    if (bitmapCache.size > 12) {
      const first = bitmapCache.keys().next().value;
      if (first && first !== url) bitmapCache.delete(first);
    }
  }
  return p;
}

// ── Rendering (shared by the live canvas and the flatten step) ─────────────
function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function renderShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], W: number, H: number) {
  for (const s of shapes) {
    if (s.kind === "magic") {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(s.mask, s.dx * W, s.dy * H, W, H);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.size * W);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.kind === "stroke") {
      if (s.pts.length === 1) {
        const p = s.pts[0];
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        s.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * W, p.y * H) : ctx.lineTo(p.x * W, p.y * H)));
        ctx.stroke();
      }
    } else {
      const ax = s.a.x * W, ay = s.a.y * H, bx = s.b.x * W, by = s.b.y * H;
      ctx.beginPath();
      if (s.kind === "rect") {
        ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      } else if (s.kind === "circle") {
        ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (s.kind === "arrow") {
          const ang = Math.atan2(by - ay, bx - ax);
          // Both the floor and the scale are relative to the image width, so
          // the flattened copy shows the same arrow the customer drew on the
          // (much smaller) preview.
          const head = Math.max(0.012 * W, ctx.lineWidth * 2.6);
          for (const off of [Math.PI * 0.82, -Math.PI * 0.82]) {
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + head * Math.cos(ang + off), by + head * Math.sin(ang + off));
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }
}

// ── Hit testing (px space) — for the eraser and the hand ───────────────────
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const px = a.x + t * dx - p.x, py = a.y + t * dy - p.y;
  return Math.sqrt(px * px + py * py);
}

function hitShape(s: Shape, px: number, py: number, W: number, H: number): boolean {
  const threshold = Math.max(10, (s.kind === "magic" ? 0 : s.size * W) / 2 + 8);
  if (s.kind === "stroke") {
    for (let i = 0; i < s.pts.length; i++) {
      const a = { x: s.pts[i].x * W, y: s.pts[i].y * H };
      const b = i + 1 < s.pts.length ? { x: s.pts[i + 1].x * W, y: s.pts[i + 1].y * H } : a;
      if (distToSegment({ x: px, y: py }, a, b) < threshold) return true;
    }
    return false;
  }
  if (s.kind === "magic") {
    const mx = Math.round(((px - s.dx * W) / W) * s.mask.width);
    const my = Math.round(((py - s.dy * H) / H) * s.mask.height);
    if (mx < 0 || my < 0 || mx >= s.mask.width || my >= s.mask.height) return false;
    const ctx = s.mask.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    return ctx.getImageData(mx, my, 1, 1).data[3] > 0;
  }
  const ax = s.a.x * W, ay = s.a.y * H, bx = s.b.x * W, by = s.b.y * H;
  if (s.kind === "line" || s.kind === "arrow") {
    return distToSegment({ x: px, y: py }, { x: ax, y: ay }, { x: bx, y: by }) < threshold;
  }
  // rect + circle: inside the (slightly padded) bounding box counts.
  const x0 = Math.min(ax, bx) - threshold, x1 = Math.max(ax, bx) + threshold;
  const y0 = Math.min(ay, by) - threshold, y1 = Math.max(ay, by) + threshold;
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  if (s.kind === "rect") return true;
  const rx = Math.max(1, Math.abs(bx - ax) / 2 + threshold);
  const ry = Math.max(1, Math.abs(by - ay) / 2 + threshold);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  return ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
}

// ── Magic wand — flood fill on downscaled pixels ───────────────────────────
const WAND_EDGE = 420;
const WAND_TOLERANCE = 34;

function magicMask(bmp: ImageBitmap, at: Pt, color: string): HTMLCanvasElement | null {
  const scale = Math.min(1, WAND_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const work = document.createElement("canvas");
  work.width = w; work.height = h;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  if (!wctx) return null;
  wctx.drawImage(bmp, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try { data = wctx.getImageData(0, 0, w, h).data; } catch { return null; }

  const sx = Math.min(w - 1, Math.max(0, Math.round(at.x * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.round(at.y * h)));
  const si = (sy * w + sx) * 4;
  const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2];
  const tol2 = WAND_TOLERANCE * WAND_TOLERANCE * 3;

  const selected = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  queue[tail++] = sy * w + sx;
  selected[sy * w + sx] = 1;
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w, y = (idx / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (selected[ni]) continue;
      const di = ni * 4;
      const dr = data[di] - r0, dg = data[di + 1] - g0, db = data[di + 2] - b0;
      if (dr * dr + dg * dg + db * db > tol2) continue;
      selected[ni] = 1;
      queue[tail++] = ni;
    }
  }

  const mask = document.createElement("canvas");
  mask.width = w; mask.height = h;
  const mctx = mask.getContext("2d");
  if (!mctx) return null;
  const out = mctx.createImageData(w, h);
  const [cr, cg, cb] = hexToRgb(color);
  for (let i = 0; i < selected.length; i++) {
    if (!selected[i]) continue;
    const o = i * 4;
    out.data[o] = cr; out.data[o + 1] = cg; out.data[o + 2] = cb; out.data[o + 3] = 255;
  }
  mctx.putImageData(out, 0, 0);
  return mask;
}

// ── Flatten: image + annotations → one blob for the backend ────────────────
export async function flattenAnnotations(
  url: string, shapes: Shape[], maxEdge = 2048,
): Promise<Blob | null> {
  if (shapes.length === 0) return null;
  const bmp = await loadBitmap(url);
  if (!bmp) return null;
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * scale));
  const H = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, W, H);
  renderShapes(ctx, shapes, W, H);
  const webp = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.85));
  if (webp) return webp;
  return await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.87));
}

/** Cheap identity for one drawing, so an upload can be reused across retries
 *  instead of orphaning a new file in storage on every failed attempt. */
export function shapeSignature(seed: string, shapes: Shape[]): string {
  const parts = shapes.map((s) => {
    if (s.kind === "stroke") {
      const pts = s.pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(";");
      return `s|${s.color}|${s.size.toFixed(4)}|${pts}`;
    }
    if (s.kind === "magic") {
      return `m|${s.color}|${s.mask.width}x${s.mask.height}|${s.dx.toFixed(3)},${s.dy.toFixed(3)}`;
    }
    return `${s.kind}|${s.color}|${s.size.toFixed(4)}|${s.a.x.toFixed(3)},${s.a.y.toFixed(3)}|${s.b.x.toFixed(3)},${s.b.y.toFixed(3)}`;
  });
  return `${seed}#${parts.join("~")}`;
}

// ── The interactive canvas ─────────────────────────────────────────────────
export function AnnotationCanvas({ url, shapes, tool, color, sizePx, onGestureStart, onChange, className }: {
  url: string;
  shapes: Shape[];
  tool: DrawTool;
  color: string;
  /** Brush size in on-screen pixels; stored normalized per shape. */
  sizePx: number;
  /** Called once when a gesture begins — the parent snapshots for undo. */
  onGestureStart: () => void;
  onChange: (next: Shape[]) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const gesture = useRef<
    | { type: "draw" }
    | { type: "erase" }
    | { type: "drag"; index: number; lastX: number; lastY: number }
    | null
  >(null);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const urlRef = useRef(url);
  urlRef.current = url;

  /**
   * The ONLY way this component mutates the shape list. Pointer moves fire
   * far faster than React commits, and every mutation is computed from
   * `shapesRef.current` — so the ref has to advance with the write, not with
   * the next render. Without this, a fast eraser sweep or drag computes two
   * consecutive changes from the same stale base and the second silently
   * reverts the first.
   */
  const emit = useCallback((next: Shape[]) => {
    shapesRef.current = next;
    onChange(next);
  }, [onChange]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W === 0 || H === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    renderShapes(ctx, draft ? [...shapesRef.current, draft] : shapesRef.current, W, H);
  }, [draft]);

  useEffect(() => { redraw(); }, [redraw, shapes]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  const toLocal = (e: React.PointerEvent): { px: number; py: number; x: number; y: number; W: number; H: number } => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
    const py = Math.min(rect.height, Math.max(0, e.clientY - rect.top));
    return { px, py, x: px / rect.width, y: py / rect.height, W: rect.width, H: rect.height };
  };

  const eraseAt = (px: number, py: number, W: number, H: number) => {
    const list = shapesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitShape(list[i], px, py, W, H)) {
        emit(list.filter((_, j) => j !== i));
        return;
      }
    }
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const { px, py, x, y, W, H } = toLocal(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    const norm = sizePx / Math.max(1, W);

    if (tool === "magic") {
      // The fetch can take seconds on a full-size image. If the customer
      // moves to another image meanwhile, the mask computed from the OLD
      // pixels must not land on the new canvas — and the undo snapshot is
      // pushed only once a mask really exists, so a failed wand click never
      // leaves a no-op entry on the stack.
      const at = { x, y };
      const forUrl = url;
      void loadBitmap(forUrl).then((bmp) => {
        if (!bmp || urlRef.current !== forUrl) return;
        const mask = magicMask(bmp, at, color);
        if (!mask || urlRef.current !== forUrl) return;
        onGestureStart();
        emit([...shapesRef.current, { kind: "magic", mask, color, dx: 0, dy: 0 }]);
      });
      return;
    }
    if (tool === "eraser") {
      onGestureStart();
      gesture.current = { type: "erase" };
      eraseAt(px, py, W, H);
      return;
    }
    if (tool === "hand") {
      const list = shapesRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        if (hitShape(list[i], px, py, W, H)) {
          onGestureStart();
          gesture.current = { type: "drag", index: i, lastX: x, lastY: y };
          return;
        }
      }
      return;
    }
    onGestureStart();
    gesture.current = { type: "draw" };
    if (tool === "brush") {
      setDraft({ kind: "stroke", pts: [{ x, y }], color, size: norm });
    } else {
      setDraft({ kind: tool, a: { x, y }, b: { x, y }, color, size: norm });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const { px, py, x, y, W, H } = toLocal(e);
    if (g.type === "erase") { eraseAt(px, py, W, H); return; }
    if (g.type === "drag") {
      const dx = x - g.lastX, dy = y - g.lastY;
      g.lastX = x; g.lastY = y;
      emit(shapesRef.current.map((s, i) => {
        if (i !== g.index) return s;
        if (s.kind === "stroke") return { ...s, pts: s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
        if (s.kind === "magic") return { ...s, dx: s.dx + dx, dy: s.dy + dy };
        return { ...s, a: { x: s.a.x + dx, y: s.a.y + dy }, b: { x: s.b.x + dx, y: s.b.y + dy } };
      }));
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === "stroke") return { ...d, pts: [...d.pts, { x, y }] };
      if (d.kind === "magic") return d;
      return { ...d, b: { x, y } };
    });
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.type === "draw") {
      setDraft((d) => {
        if (d) {
          // A shape dragged out to (near) zero size is a misclick, not a mark.
          const degenerate = d.kind !== "stroke" && d.kind !== "magic"
            && Math.abs(d.a.x - d.b.x) < 0.004 && Math.abs(d.a.y - d.b.y) < 0.004;
          if (!degenerate) emit([...shapesRef.current, d]);
        }
        return null;
      });
    }
  }

  /** A browser-initiated cancel (app switch, palm rejection, notification
   *  shade) is an ABORT, not a finished mark: the draft is discarded. */
  function onPointerCancel() {
    gesture.current = null;
    setDraft(null);
  }

  const cursor = tool === "hand" ? "grab" : "crosshair";
  return (
    <div ref={wrapRef} className={className}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="absolute inset-0 h-full w-full"
        style={{ cursor, touchAction: "none" }}
        aria-hidden
      />
    </div>
  );
}
