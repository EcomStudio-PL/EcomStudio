"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { ProcessEdge, ProcessNode } from "@/lib/grovshot-shot/process-types";
import { cn } from "@/lib/utils";

/**
 * A small read-only flow canvas: absolutely placed node cards in a
 * translated/scaled layer, SVG curves between them. Pan by dragging the
 * background (mouse or one finger), zoom with the wheel or two fingers,
 * "fit" puts the whole graph on screen. No graph library: the layout is a
 * fixed grid the server already assigns (col, row), horizontal by design.
 */

export const NODE_W = 208;
export const NODE_H = 132;
const COL_GAP = 56;
const ROW_GAP = 28;
const PAD = 40;
const MIN_K = 0.2;
const MAX_K = 2.2;

export type Placed = ProcessNode & { x: number; y: number };

export function layout(nodes: ProcessNode[]): { placed: Placed[]; width: number; height: number } {
  const shotRows = Math.max(1, ...nodes.filter((n) => n.kind === "shot" || n.kind === "round" || n.kind === "experiment").map((n) => n.row + 1));
  const midY = ((shotRows - 1) / 2) * (NODE_H + ROW_GAP);
  const placed = nodes.map((n) => {
    const pipeline = n.kind !== "shot" && n.kind !== "round" && n.kind !== "experiment";
    return { ...n, x: PAD + n.col * (NODE_W + COL_GAP), y: PAD + (pipeline ? midY : n.row * (NODE_H + ROW_GAP)) };
  });
  const width = Math.max(...placed.map((p) => p.x + NODE_W), 0) + PAD;
  const height = Math.max(...placed.map((p) => p.y + NODE_H), 0) + PAD;
  return { placed, width, height };
}

type View = { x: number; y: number; k: number };

export function FlowCanvas({ nodes, edges, selected, onSelect, renderNode, labels }: {
  nodes: ProcessNode[]; edges: ProcessEdge[]; selected: string | null; onSelect: (id: string) => void;
  renderNode: (n: Placed) => React.ReactNode;
  labels: { zoomIn: string; zoomOut: string; fit: string };
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const { placed, width, height } = layout(nodes);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: number; pinch: number | null; k: number } | null>(null);
  const downNode = useRef<string | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    const k = Math.max(MIN_K, Math.min(1.1, cw / width, ch / height));
    setView({ k, x: (cw - width * k) / 2, y: (ch - height * k) / 2 });
  }, [width, height]);

  useLayoutEffect(() => { fit(); }, [fit, nodes.length]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = (factor: number, cx: number, cy: number) => setView((v) => {
    const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // The node under the finger/mouse: selected on release if nothing moved
    // (the capture below would otherwise take the click away from it).
    if (pointers.current.size === 0) downNode.current = (e.target as HTMLElement).closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    drag.current = {
      x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: drag.current?.moved ?? 0, k: view.k,
      pinch: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null,
    };
    if (pts.length === 1) drag.current.moved = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && drag.current.pinch) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const r = box.current!.getBoundingClientRect();
      const cx = (pts[0].x + pts[1].x) / 2 - r.left;
      const cy = (pts[0].y + pts[1].y) / 2 - r.top;
      const k = Math.max(MIN_K, Math.min(MAX_K, drag.current.k * (d / drag.current.pinch)));
      setView((v) => ({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }));
      drag.current.moved += 10;
      return;
    }
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dx) + Math.abs(dy));
    setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (e.type === "pointerup" && (drag.current?.moved ?? 0) < 6 && downNode.current) onSelect(downNode.current);
      downNode.current = null;
      drag.current = null;
    } else if (drag.current) {
      const p = [...pointers.current.values()][0];
      drag.current = { ...drag.current, x: p.x, y: p.y, vx: view.x, vy: view.y, pinch: null, k: view.k };
    }
  };
  // Keyboard activation (Enter/Space) arrives as a click with no pointer.
  const keyClick = (e: React.MouseEvent, id: string) => { if (e.detail === 0) onSelect(id); };

  const pos = new Map(placed.map((p) => [p.id, p]));
  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-[radial-gradient(rgb(var(--hairline)/0.35)_1px,transparent_1px)] [background-size:22px_22px]"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      data-gsp-canvas
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width, height }}>
        <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height} aria-hidden>
          {edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
            const c = Math.max(30, (x2 - x1) / 2);
            return (
              <path key={`${e.from}-${e.to}`} d={`M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`} fill="none"
                strokeWidth={e.kind === "flow" ? 1.6 : 1.8}
                className={e.kind === "retry" ? "stroke-warning" : e.kind === "experiment" ? "stroke-accent2" : "stroke-[rgb(var(--muted)/0.55)]"}
                strokeDasharray={e.kind === "flow" ? undefined : "5 4"} />
            );
          })}
        </svg>
        {placed.map((n) => (
          <button
            key={n.id} type="button" onClick={(e) => keyClick(e, n.id)} data-node-id={n.id}
            className={cn("absolute rounded-xl border bg-surface text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              selected === n.id ? "border-accent ring-2 ring-accent/30" : "border-line")}
            style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
            data-gsp-node={n.kind}
          >
            {renderNode(n)}
          </button>
        ))}
      </div>
      <div className="absolute bottom-3 left-3 flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        {[
          { label: labels.zoomIn, icon: <Plus size={15} aria-hidden />, act: () => { const r = box.current!.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); } },
          { label: labels.zoomOut, icon: <Minus size={15} aria-hidden />, act: () => { const r = box.current!.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); } },
          { label: labels.fit, icon: <Maximize2 size={14} aria-hidden />, act: fit },
        ].map((b) => (
          <button key={b.label} type="button" onClick={b.act} aria-label={b.label} title={b.label}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface shadow-sm hover:bg-raised">
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
