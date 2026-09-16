"use client";
import { useEffect } from "react";

/**
 * PINCH-ZOOM, ON IOS, WHERE THE VIEWPORT META CANNOT REACH.
 *
 * Everything else about locking the app to 1:1 is declarative: `maximumScale`
 * and `userScalable` in `app/layout.tsx` for Android and for iOS-from-the-home-
 * screen, and `touch-action: manipulation` in `globals.css` for the double tap.
 * Mobile Safari in a TAB is the one case with no declarative answer — it has
 * ignored `user-scalable=no` and `maximum-scale` since iOS 10 — and that is the
 * majority of iPad traffic, which is exactly where a two-finger stretch is
 * easiest to trigger by accident.
 *
 * WHY THIS IS NOT THE THING YOU ARE NOT SUPPOSED TO DO.
 *
 * The listener people warn about is `touchmove` (or `touchstart`, or
 * `pointermove`) with a blanket `preventDefault`, because every one of those
 * fires for a ONE-finger drag: it cancels scrolling, sliders, carousels,
 * swipes and drag-to-upload along with the zoom.
 *
 * `gesturestart` / `gesturechange` / `gestureend` are different events. They
 * are Safari's own, they exist for nothing but pinch and rotate, and the first
 * of them does not fire until a SECOND finger lands. A scroll never produces
 * one. Neither does a tap, a swipe, a slider drag or a file drop. Cancelling
 * them removes page zoom and touches nothing else — and nothing in this app
 * interprets a two-finger gesture itself, so there is no feature to collide
 * with.
 *
 * Gated to `(pointer: coarse)` so a Mac trackpad — which also produces these
 * events in Safari — keeps its pinch. Desktop is untouched, as required.
 */

/* Safari's pinch/rotate events are not in the DOM lib, so they are declared
   here rather than cast away. `scale` and `rotation` go unused, but a type
   that describes the event honestly is the point. */
declare global {
  interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
  }
  interface DocumentEventMap {
    gesturestart: GestureEvent;
    gesturechange: GestureEvent;
    gestureend: GestureEvent;
  }
}

const GESTURES = ["gesturestart", "gesturechange", "gestureend"] as const;

export function ViewportLock() {
  useEffect(() => {
    // A mouse is not a finger. Desktop Safari keeps trackpad pinch.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    // NOT passive: a passive listener may not call preventDefault, and
    // preventing the default IS the entire job here.
    const block = (event: GestureEvent) => event.preventDefault();
    for (const name of GESTURES) {
      document.addEventListener(name, block, { passive: false });
    }
    return () => {
      for (const name of GESTURES) document.removeEventListener(name, block);
    };
  }, []);

  return null;
}
