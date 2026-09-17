"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A PICTURE YOU CAN ZOOM INTO AND THEN ACTUALLY LOOK AROUND.
 *
 * The details modal could already zoom. What it could not do was MOVE: the
 * zoomed image sat in an `overflow-auto` box, so reaching a corner at 200%
 * meant finding a scrollbar — on a phone, meant nothing at all. Zoom without
 * pan is a magnifier bolted to a wall.
 *
 * SO THE IMAGE IS TRANSFORMED, NOT SCROLLED. One `translate3d(...) scale(...)`
 * on the picture, written straight to the element during a drag rather than
 * pushed through React: a pointermove that re-rendered a modal this size would
 * stutter, and none of what moves is state anyone else needs. React hears
 * about the drag exactly twice — when it starts and when it ends — so the
 * cursor can change.
 *
 * WHAT A DRAG MUST NOT DO, and each of these was a real way to get it wrong:
 *   · scroll the page or move the modal — the pointer is captured, so every
 *     move after the first belongs to this element and nothing else sees it;
 *   · drag the `<img>` itself as a file — `draggable={false}`, because a
 *     browser's own image-drag ghost beats any handler to it;
 *   · select the metadata beside it — `select-none` while dragging;
 *   · fight the browser's scroll on a touch screen — `touch-action: none`
 *     only while there is something to pan, so a phone keeps its ordinary
 *     scrolling at 100%.
 *
 * THE BOUNDS ARE THE PICTURE'S OWN. `offsetWidth/offsetHeight` is the image's
 * layout size before any transform — that is, the file's natural size fitted
 * to this viewport — so the rendered size at zoom z is exactly that times z,
 * and the pan can go as far as the overflow and not one pixel further. Drag to
 * the left edge and it stops at the left edge; there is no way to fling the
 * picture off screen and be left looking at nothing.
 */

/** What the − and + buttons step through. */
export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 400] as const;

export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** The next stop up or down from wherever the zoom currently is. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((z) => z < current) ?? ZOOM_MIN;
}

export function ZoomPan({ src, alt, zoom, className }: {
  src: string;
  alt: string;
  /** Percent. 100 is "fits the viewport". */
  zoom: number;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  /** The current offset, in px. A ref and not state: it changes on every
   *  pointermove and nothing renders from it. */
  const pan = useRef({ x: 0, y: 0 });
  const drag = useRef<{ id: number; startX: number; startY: number; fromX: number; fromY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pannable, setPannable] = useState(false);

  /** How far the picture may move from centre, given the zoom. Zero on an
   *  axis that does not overflow, which is what stops a 16:9 image sliding up
   *  and down inside its own letterbox. */
  const limits = useCallback(() => {
    const box = viewport.current;
    const img = image.current;
    if (!box || !img) return { x: 0, y: 0 };
    const scale = zoom / 100;
    return {
      x: Math.max(0, (img.offsetWidth * scale - box.clientWidth) / 2),
      y: Math.max(0, (img.offsetHeight * scale - box.clientHeight) / 2),
    };
  }, [zoom]);

  const paint = useCallback(() => {
    const img = image.current;
    if (!img) return;
    img.style.transform =
      `translate3d(${pan.current.x}px, ${pan.current.y}px, 0) scale(${zoom / 100})`;
  }, [zoom]);

  /**
   * BACK TO 100% MEANS BACK TO THE MIDDLE, and so does a new picture — both
   * arrive here as a change of `zoom` or `src`. Without it, stepping down from
   * 300% would leave the image centred on wherever you had dragged to, and
   * opening the next one would open it already shoved off screen.
   */
  useLayoutEffect(() => {
    const max = limits();
    pan.current = {
      x: Math.max(-max.x, Math.min(max.x, pan.current.x)),
      y: Math.max(-max.y, Math.min(max.y, pan.current.y)),
    };
    if (zoom <= 100) pan.current = { x: 0, y: 0 };
    paint();
    setPannable(max.x > 0.5 || max.y > 0.5);
  }, [zoom, src, limits, paint]);

  useLayoutEffect(() => {
    pan.current = { x: 0, y: 0 };
    paint();
  }, [src, paint]);

  // A resized window changes the fitted size and therefore the bounds.
  useEffect(() => {
    const box = viewport.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const io = new ResizeObserver(() => {
      const max = limits();
      pan.current = {
        x: Math.max(-max.x, Math.min(max.x, pan.current.x)),
        y: Math.max(-max.y, Math.min(max.y, pan.current.y)),
      };
      paint();
      setPannable(max.x > 0.5 || max.y > 0.5);
    });
    io.observe(box);
    return () => io.disconnect();
  }, [limits, paint]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!pannable || e.button !== 0) return;
    // CAPTURE FIRST. Everything after this belongs to this element: the page
    // does not scroll, the modal does not move, and letting go outside the
    // viewport still ends the drag.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY,
      fromX: pan.current.x, fromY: pan.current.y,
    };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const max = limits();
    pan.current = {
      x: Math.max(-max.x, Math.min(max.x, d.fromX + (e.clientX - d.startX))),
      y: Math.max(-max.y, Math.min(max.y, d.fromY + (e.clientY - d.startY))),
    };
    // Straight to the element. No state, no render, no reflow — a transform
    // is composited.
    paint();
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div
      ref={viewport}
      data-zoom-viewport
      data-pannable={pannable || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        // `overflow-hidden` is what makes this a viewport rather than a
        // scroller: the zoomed picture is clipped to it and reached by
        // dragging, which is the whole point of the change.
        "relative flex h-full w-full items-center justify-center overflow-hidden",
        pannable && (dragging ? "cursor-grabbing" : "cursor-grab"),
        // Only claim the touch gestures when there is something to pan with
        // them; at 100% a phone keeps its ordinary scrolling.
        pannable && "touch-none",
        dragging && "select-none",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={src}
        alt={alt}
        // The browser's own image drag starts before any handler of ours and
        // would end the pan with a ghost image stuck to the cursor.
        draggable={false}
        onLoad={paint}
        className="max-h-full max-w-full select-none object-contain will-change-transform"
        style={{ transformOrigin: "center", transform: `translate3d(0,0,0) scale(${zoom / 100})` }}
      />
    </div>
  );
}
