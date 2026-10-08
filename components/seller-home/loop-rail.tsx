"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE TOOL CAROUSEL'S ENDLESS RAIL — the looping variant of ./rail.tsx, for
 * the first carousel on /home only. (The before/after row and the featured
 * tools keep the plain Rail, unchanged.)
 *
 * The cards sit on the same native scrolling strip as Rail — wheel, trackpad,
 * touch swipe and momentum are the browser's own, `scroll-snap` lands every
 * move on a card's edge — with one copy of the whole list on either side:
 *
 *     [ copies ]  [ the real cards ]  [ copies ]
 *
 * Whenever the strip comes to rest over the copies, it is moved — instantly,
 * by exactly one list's width — onto the real cards showing the same thing.
 * The two views are identical pixel for pixel, so nothing on screen moves:
 * after the last tool comes the first, before the first the last, both ways,
 * for ever. An arrow press that would leave the real cards makes the same
 * invisible move first and then glides one card, so fast presses never run
 * off the end of the copies.
 *
 * The copies are drawing only: aria-hidden, no ids, nothing in them takes the
 * keyboard (the caller renders their links with tabIndex -1). A pointer may
 * still click one — it opens the same tool. The real cards are the only ones
 * a screen reader or Tab meets; ←/→ on one moves the focus to its neighbour,
 * the last card's neighbour being the first, and the strip always comes to
 * rest where that real, focused card is in view.
 *
 * The copies BEFORE the list are added only after hydration — the server
 * cannot know the cards' width, so it cannot start the strip scrolled past
 * them. The strip is moved by their width in the same frame, before anything
 * is painted. Without JavaScript the strip simply starts at the first card.
 *
 * Card width is the same CSS as Rail: --rail-cols / --rail-gap per
 * breakpoint on `className`, a card being (100% − whole gaps) ÷ cols wide —
 * rounded down to a whole pixel where the browser supports round(), so that
 * the move by one list's width is exact to the pixel.
 */

type Geometry = { track: HTMLDivElement; origin: number; period: number; pitch: number; gap: number };

/** How long the strip must be still (no scroll events, no finger) to count as
 *  at rest where the browser has no `scrollend`. */
const SETTLE_MS = 140;
/** Longest an arrow's glide may take; until then it is not cut short. */
const GLIDE_MS = 1200;

const FOCUSABLE = "a[href], button:not([disabled]), [tabindex='0']";

const jump = (track: HTMLDivElement, left: number) => track.scrollTo({ left, behavior: "instant" });

/** Is real card k wholly in view with the strip scrolled to `pos`? */
const inView = (g: Geometry, pos: number, k: number) => {
  const left = g.origin + k * g.pitch - pos;
  return left >= -1 && left + (g.pitch - g.gap) <= g.track.clientWidth + 1;
};

/** The other spots showing exactly what `pos` shows: one list's width away. */
const twins = (g: Geometry, pos: number) => {
  const max = g.track.scrollWidth - g.track.clientWidth;
  return [pos - g.period, pos + g.period].filter((p) => p >= -1 && p <= max + 1);
};

export function LoopRail({ label, role, prevLabel, nextLabel, className, arrowTop = "50%", items, clones }: {
  label: string;
  /** What a screen reader calls the widget ("karuzela"), translated. */
  role: string;
  prevLabel: string;
  nextLabel: string;
  /** Sets --rail-cols / --rail-gap per breakpoint. */
  className?: string;
  /** Where the arrows sit vertically (the middle of the pictures). */
  arrowTop?: string;
  /** The real cards, in order. */
  items: readonly ReactNode[];
  /** The same cards drawn as copies — same order, links with tabIndex -1. */
  clones: readonly ReactNode[];
}) {
  const n = items.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const positioned = useRef(false);
  /** The real card at the left edge when the strip last came to rest. */
  const indexRef = useRef(0);
  /** An arrow's destination while the strip glides there (strip index). */
  const targetRef = useRef<number | null>(null);
  /** Until when (performance.now()) that glide may still be under way. */
  const glidingRef = useRef(0);
  const touchRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const geometry = useCallback((): Geometry | null => {
    const track = trackRef.current;
    if (!track || n === 0) return null;
    const first = track.querySelector<HTMLElement>(":scope > [data-loop-item]");
    const after = track.querySelector<HTMLElement>(":scope > [data-loop-clone='after']");
    if (!first || !after) return null;
    // Positions in the strip's own scroll coordinates, to the subpixel.
    const base = track.getBoundingClientRect().left - track.scrollLeft;
    const origin = first.getBoundingClientRect().left - base;
    const period = after.getBoundingClientRect().left - base - origin;
    if (!(period > 0)) return null;
    return { track, origin, period, pitch: period / n, gap: parseFloat(getComputedStyle(track).columnGap) || 0 };
  }, [n]);

  /** Reduced motion: no glide at all, the strip is simply there. */
  const glide = (track: HTMLDivElement, left: number) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    glidingRef.current = reduce ? 0 : performance.now() + GLIDE_MS;
    track.scrollTo({ left, behavior: reduce ? "instant" : "smooth" });
  };
  /** A hand on the strip (finger, wheel) takes over from any glide. */
  const release = useCallback(() => { targetRef.current = null; glidingRef.current = 0; }, []);

  /** The real card holding the keyboard focus, or -1. */
  const focusedCard = useCallback((): number => {
    const track = trackRef.current;
    if (!track) return -1;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(":scope > [data-loop-item]"));
    return cards.findIndex((c) => c.contains(document.activeElement));
  }, []);

  /**
   * AT REST: stand on the real cards. Of the views identical to this one,
   * keep the one where the focused real card is visible (so the focus ring is
   * never on a hidden card), else the one whose left card is a real one.
   * Returns false while an arrow's glide is still on its way — not at rest.
   */
  const settle = useCallback((): boolean => {
    if (touchRef.current) return true;
    const g = geometry();
    if (!g) return true;
    const here = g.track.scrollLeft;
    const target = targetRef.current;
    if (target !== null && performance.now() < glidingRef.current
      && Math.abs(here - (g.origin + target * g.pitch)) > 1) return false;
    const options = [here, ...twins(g, here)];
    const focus = focusedCard();
    const band = (p: number) => { const at = (p - g.origin) / g.pitch; return at >= -0.5 && at < n - 0.5; };
    const best = focus >= 0 && options.some((p) => inView(g, p, focus))
      ? options.find((p) => inView(g, p, focus)) as number
      : options.find(band) ?? here;
    if (Math.abs(best - here) > 0.5) jump(g.track, best);
    const idx = Math.round((best - g.origin) / g.pitch);
    indexRef.current = ((idx % n) + n) % n;
    release();
    return true;
  }, [geometry, focusedCard, release, n]);

  // The copies before the list, once hydrated…
  useLayoutEffect(() => { setReady(true); }, []);
  // …and, in the same frame, the strip moved by their width: the view holds.
  useLayoutEffect(() => {
    if (!ready || positioned.current) return;
    const g = geometry();
    if (!g) return;
    positioned.current = true;
    jump(g.track, g.track.scrollLeft + g.origin);
  }, [ready, geometry]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !ready) return;
    // Rest = no scroll event and no finger for a moment; `scrollend`, where
    // the browser has it, says so at once. Momentum and snapping keep firing
    // scroll events, so neither is ever cut short.
    const later = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { if (!settle()) later(); }, SETTLE_MS);
    };
    const onEnd = () => { window.clearTimeout(timerRef.current); if (!settle()) later(); };
    const onTouchStart = () => { touchRef.current = true; release(); window.clearTimeout(timerRef.current); };
    const onTouchEnd = () => { touchRef.current = false; later(); };
    const onWheel = () => release();
    track.addEventListener("scroll", later, { passive: true });
    track.addEventListener("scrollend", onEnd);
    track.addEventListener("touchstart", onTouchStart, { passive: true });
    track.addEventListener("touchend", onTouchEnd, { passive: true });
    track.addEventListener("touchcancel", onTouchEnd, { passive: true });
    track.addEventListener("wheel", onWheel, { passive: true });
    // A new width (rotation, a breakpoint) changes every card's width: put the
    // same real card back at the left edge — or, if the focus is on a card
    // that would then be out of view, that card. Height alone (a font
    // arriving) changes nothing.
    let width = track.clientWidth;
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        if (track.clientWidth === width) return;
        width = track.clientWidth;
        if (touchRef.current) return;
        const g = geometry();
        if (!g) return;
        release();
        const focus = focusedCard();
        let pos = g.origin + indexRef.current * g.pitch;
        if (focus >= 0 && !inView(g, pos, focus)) pos = g.origin + focus * g.pitch;
        jump(g.track, pos);
      })
      : null;
    ro?.observe(track);
    return () => {
      window.clearTimeout(timerRef.current);
      track.removeEventListener("scroll", later);
      track.removeEventListener("scrollend", onEnd);
      track.removeEventListener("touchstart", onTouchStart);
      track.removeEventListener("touchend", onTouchEnd);
      track.removeEventListener("touchcancel", onTouchEnd);
      track.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
  }, [ready, settle, geometry, focusedCard, release]);

  /** One card left or right, round and round. */
  const step = (dir: -1 | 1) => {
    const g = geometry();
    if (!g) return;
    const { track, origin, period, pitch } = g;
    let target = (targetRef.current ?? Math.round((track.scrollLeft - origin) / pitch)) + dir;
    // Leaving the real cards: first the invisible move by one list's width.
    let left = track.scrollLeft;
    while (target < 0) { left += period; target += n; }
    while (target > n - 1) { left -= period; target -= n; }
    if (left !== track.scrollLeft) jump(track, left);
    targetRef.current = target;
    glide(track, origin + target * pitch);
  };

  /** Bring real card k into view after the focus moved to it, coming in from
   *  the side the focus moved towards (dir) — the real card, not a copy. */
  const reveal = (k: number, dir: -1 | 1) => {
    const g = geometry();
    if (!g) return;
    const here = g.track.scrollLeft;
    if (inView(g, here, k)) return;
    // The same view one list's width away may already show it: no motion.
    const twin = twins(g, here).find((p) => inView(g, p, k));
    if (twin !== undefined) { jump(g.track, twin); return; }
    // Card k at the right edge (moving right) or the left edge (moving left)…
    const whole = Math.max(1, Math.floor((g.track.clientWidth + g.gap) / g.pitch + 0.01));
    const t = dir > 0 ? k - (whole - 1) : k;
    const dest = g.origin + t * g.pitch;
    // …gliding from whichever identical view lies nearest, so the glide is
    // one card long even across the seam.
    const start = [here, ...twins(g, here)].reduce((a, b) => (Math.abs(b - dest) < Math.abs(a - dest) ? b : a));
    if (start !== here) jump(g.track, start);
    targetRef.current = t;
    glide(g.track, dest);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(":scope > [data-loop-item]"));
    const at = cards.findIndex((c) => c.contains(document.activeElement));
    if (at < 0) return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    // The neighbour that opens; a card that does not open (yet) is stepped over.
    for (let s = 1; s < n; s++) {
      const pos = at + dir * s;
      const k = ((pos % n) + n) % n;
      const card = cards[k];
      const target = card.matches(FOCUSABLE) ? card : card.querySelector<HTMLElement>(FOCUSABLE);
      if (!target) continue;
      e.preventDefault();
      target.focus({ preventScroll: true });
      reveal(k, dir);
      return;
    }
  };

  const arrow = "absolute z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--surface)/0.82)] text-ink shadow-[0_8px_24px_-10px_rgb(0_0_0/0.45)] backdrop-blur-md transition-[opacity,transform] duration-200 hover:scale-105 sm:flex motion-reduce:transition-none motion-reduce:hover:scale-100";
  // A press on a copy still opens its tool, but never leaves the focus on it.
  const copy = (side: "before" | "after") => clones.map((node, i) => (
    <div key={`${side}-${i}`} aria-hidden="true" data-loop-clone={side} onMouseDown={(e) => e.preventDefault()}>{node}</div>
  ));

  return (
    <div className="relative" role="region" aria-roledescription={role} aria-label={label} data-loop-rail>
      <div ref={trackRef} onKeyDown={onKey}
        className={cn(
          "flex snap-x snap-mandatory gap-[var(--rail-gap)] overflow-x-auto overscroll-x-contain pb-1 pt-1 [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[&_a:focus-visible]:outline-offset-[-3px] [&>*:focus-visible]:outline-offset-[-3px]",
          "[&>*]:w-[calc((100%_-_(var(--rail-cols)_-_1)_*_var(--rail-gap))_/_var(--rail-cols))] [&>*]:shrink-0 [&>*]:snap-start",
          // Whole pixels per card where the browser can round: one list's
          // width is then a whole number of pixels too, so the move between a
          // view and its twin lands exactly — not half a pixel off.
          "supports-[width:round(down,1px,1px)]:[&>*]:w-[round(down,calc((100%_-_(var(--rail-cols)_-_1)_*_var(--rail-gap))_/_var(--rail-cols)),1px)]",
          className,
        )}>
        {ready && copy("before")}
        {items.map((node, i) => <div key={`item-${i}`} data-loop-item={i}>{node}</div>)}
        {copy("after")}
      </div>
      <button type="button" onClick={() => step(-1)} aria-label={prevLabel} data-rail-prev
        className={cn(arrow, "left-2")} style={{ top: arrowTop }}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <button type="button" onClick={() => step(1)} aria-label={nextLabel} data-rail-next
        className={cn(arrow, "right-2")} style={{ top: arrowTop }}>
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  );
}
