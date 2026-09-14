"use client";
import { useEffect, type RefObject } from "react";

/**
 * HOW MUCH ROOM A DOCKED BAR REALLY NEEDS — measured, not guessed.
 *
 * A generator docks a toolbar above the bottom navigation. Whatever is last on
 * the page has to clear BOTH, and for a long time that number was a constant:
 * `--gen-dock-h: 148px`. The bar is actually 135px, it changes height when a
 * model adds a quality chip or the CTA wraps, and the constant could not know
 * any of that — so the page reserved 13px of nothing on a good day and hid its
 * own last element on a bad one.
 *
 * The bar is `position: fixed`, so its own rect is already in viewport
 * coordinates: everything from its top edge down to the bottom of the window
 * is exactly the strip it covers — the bar, the gap under it, the navigation
 * and the home indicator, whatever they happen to measure today. Plus one
 * comfortable gap so the last card does not end flush against the bar.
 *
 * `--gen-dock-room` is written on the ROOT, and `globals.css` spends it in
 * exactly one place: the bottom padding of the app shell's <main>. That is the
 * outermost scroller, and therefore the only box where reserving this is
 * correct — reserve it on an inner container and everything after that
 * container (the feedback CTA, for one) falls into the strip the bar covers.
 *
 * WHEN THE BAR HAS NO BOX the property is REMOVED rather than set to zero, so
 * the stylesheet's own fallback takes over. A bar hidden at `lg` measures
 * 0×0, and treating that as a real measurement would compute a room of one
 * whole viewport.
 */
export function useDockRoom(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.height === 0) { root.style.removeProperty("--gen-dock-room"); return; }
      root.style.setProperty("--gen-dock-room", `${Math.max(0, Math.round(window.innerHeight - r.top + 12))}px`);
    };
    measure();
    // The height changes without a resize — a quality chip appears, the CTA
    // swaps to a progress label — so the bar itself is observed, not just the
    // window. The window still matters: the bar's DISTANCE from the bottom of
    // the viewport moves when a mobile browser's own chrome slides away.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--gen-dock-room");
    };
  }, [ref]);
}
