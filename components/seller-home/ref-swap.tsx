"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * THE PRODUCT PHOTO BEHIND A RESULT — a /home grid tile whose result has a
 * product photo assigned (its `<slot>.ref`) shows that photo IN PLACE of the
 * result while it is looked at:
 *
 *   desktop  hover → the result fades into the product photo (~250 ms, CSS
 *            only — globals.css `.ref-swap`), out again when the pointer leaves;
 *   phone    a held finger (≥ 350 ms, without moving) shows it; lifting the
 *            finger, moving it (a scroll) or the browser cancelling the touch
 *            puts the result back. A plain tap is untouched, the page scrolls
 *            as always (nothing is prevented on touchstart), and the click a
 *            long press would end in is swallowed so it cannot open anything.
 *
 * Nothing else changes: no icon, no label, no overlay, the same frame, crop and
 * corners (both layers fill the parent frame). prefers-reduced-motion: the
 * swap is instant.
 */
const HOLD_MS = 350;
const SLOP_PX = 8;

export function RefSwap({ children, reference }: { children: React.ReactNode; reference: React.ReactNode }) {
  const [held, setHeld] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
    setHeld(false);
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
    swallow.current = false;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      swallow.current = true;
      setHeld(true);
    }, HOLD_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || e.pointerType === "mouse") return;
    if (Math.abs(e.clientX - s.x) > SLOP_PX || Math.abs(e.clientY - s.y) > SLOP_PX) cancel();
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <span className="ref-swap absolute inset-0 block" data-ref-swap data-on={held || undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancel} onPointerCancel={cancel}
      onPointerLeave={(e) => { if (e.pointerType !== "mouse") cancel(); }}
      onContextMenu={(e) => { if (held || swallow.current) e.preventDefault(); }}
      onClickCapture={onClickCapture}>
      <span className="absolute inset-0 block" data-result>{children}</span>
      <span className="absolute inset-0 block" data-ref aria-hidden="true">{reference}</span>
    </span>
  );
}
