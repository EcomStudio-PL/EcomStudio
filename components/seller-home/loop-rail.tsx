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
 * hand-made move on a card's edge — with one copy of the whole list on either
 * side:
 *
 *     [ copies ]  [ the real cards ]  [ copies ]
 *
 * A view and the view one list's width away are identical, pixel for pixel.
 * Whenever the strip comes to rest over the copies it is moved — instantly,
 * by exactly that width — onto the real cards showing the same thing, so
 * nothing on screen moves: after the last tool comes the first, before the
 * first the last, both ways, for ever.
 *
 * The arrows (and ←/→ between cards) move the strip by their own frames,
 * snapping off meanwhile, and draw every frame at whichever identical spot
 * lies inside the scrollable range — so a run of fast presses goes round as
 * far as it likes and never meets the end of the copies. Presses add up: one
 * press, one card. Reduced motion: no glide, the strip is simply there.
 *
 * The copies are drawing only: aria-hidden, no ids, nothing in them takes the
 * keyboard (the caller renders their links with tabIndex -1; anything else
 * focusable inside — a clip's controls — is given -1 here), and a pointer's
 * focus never stays on one. A copy still opens its tool when clicked. The
 * real cards are the only ones a screen reader or Tab meets; ←/→ on one moves
 * the focus to its neighbour, the last card's neighbour being the first, and
 * the strip always comes to rest where that real, focused card is in view.
 *
 * The copies BEFORE the list are added only after hydration — the server
 * cannot know the cards' width, so it cannot start the strip scrolled past
 * them. The strip is moved by their width in the same frame, before anything
 * is painted. Without JavaScript the strip simply starts at the first card.
 *
 * Card width is the same CSS as Rail: --rail-cols / --rail-gap per
 * breakpoint on `className`, a card being (100% − whole gaps) ÷ cols wide —
 * where the browser has round(), nudged (by under 2px) so that card + gap is a
 * multiple of 4px: one list's width is then a whole number of device pixels
 * at the common screen scales (1, 1.25, 1.5, 2, 3 …) and the move between a
 * view and its twin is exact.
 */

type Geometry = { track: HTMLDivElement; origin: number; period: number; pitch: number; gap: number; max: number };
/** A glide of the strip, in strip indices (0 = the first real card at the
 *  left edge): from → to, leaving at speed v0 (cards per ms), arriving at
 *  rest; `at` / `v` are where it has got to and how fast it is going. */
type Glide = { from: number; to: number; v0: number; at: number; v: number; start: number; duration: number; frame: number };

/** How long the strip must be still (no scroll events, no finger, no button
 *  held) to count as at rest where the browser has no `scrollend`. */
const SETTLE_MS = 140;
/** One arrow press / one key: a card's glide. */
const STEP_MS = 380;
/** Easing onto the nearest card after stopping between two (the strip's very
 *  ends are the only places scroll-snap allows that). */
const ALIGN_MS = 220;

const FOCUSABLE = "a[href], button:not([disabled]), [tabindex='0']";
/** Everything that could take the focus inside a copy. */
const COPY_FOCUSABLE = ["a[href]", "button", "input", "select", "textarea", "video", "audio", "iframe", "[tabindex]"]
  .map((s) => `[data-loop-clone] ${s}`).join(", ");

const jump = (track: HTMLDivElement, left: number) => track.scrollTo({ left, behavior: "instant" });
/**
 * The glide's curve: a cubic from `from` (leaving at v0) to `to` (arriving at
 * rest) — Hermite. From rest v0 = 3·distance/duration, which is exactly an
 * ease-out; a press during a glide carries the glide's own speed on, so a run
 * of presses never lurches. Position and speed at s ∈ [0, 1].
 */
const curve = (g: Glide, s: number) => {
  const d = g.duration;
  const at = (2 * s ** 3 - 3 * s ** 2 + 1) * g.from + (s ** 3 - 2 * s ** 2 + s) * d * g.v0 + (-2 * s ** 3 + 3 * s ** 2) * g.to;
  const v = ((6 * s ** 2 - 6 * s) * g.from + (3 * s ** 2 - 4 * s + 1) * d * g.v0 + (-6 * s ** 2 + 6 * s) * g.to) / d;
  return { at, v };
};
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Strip index the strip stands at now. */
const where = (g: Geometry) => (g.track.scrollLeft - g.origin) / g.pitch;
/** Can the strip stand exactly at strip index `at` (inside the range)? */
const fits = (g: Geometry, at: number) => {
  const left = g.origin + at * g.pitch;
  return left >= -0.5 && left <= g.max + 0.5;
};
/** The spot showing what strip index `at` shows, inside the scrollable range. */
const place = (g: Geometry, at: number) => {
  let left = g.origin + at * g.pitch;
  while (left > g.max + 0.5) left -= g.period;
  while (left < -0.5) left += g.period;
  return left;
};
/** Is real card k wholly in view with the strip at strip index `at`? */
const shows = (g: Geometry, at: number, k: number) => {
  const left = (k - at) * g.pitch;
  return left >= -1 && left + (g.pitch - g.gap) <= g.track.clientWidth + 1;
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
  const glideRef = useRef<Glide | null>(null);
  /** A finger on the strip / a mouse button held on it. */
  const touchRef = useRef(false);
  const pressRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const settleRef = useRef<() => void>(() => {});
  const revealRef = useRef<(k: number, dir: -1 | 1) => void>(() => {});
  /** ←/→ is moving the focus (it brings the card in itself). */
  const keyRef = useRef(false);

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
    return {
      track, origin, period, pitch: period / n, gap: parseFloat(getComputedStyle(track).columnGap) || 0,
      max: track.scrollWidth - track.clientWidth,
    };
  }, [n]);

  /** The real card holding the keyboard focus, or -1. */
  const focusedCard = useCallback((): number => {
    const track = trackRef.current;
    if (!track) return -1;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(":scope > [data-loop-item]"));
    return cards.findIndex((c) => c.contains(document.activeElement));
  }, []);

  /** Stop a glide right where it is. Scroll-snap stays off: put back between
   *  two cards it would yank the strip to the nearer edge at once — under a
   *  finger, onto another card. It comes back on when the strip is at rest on
   *  a card (settle). True if a glide was running. */
  const haltGlide = useCallback((): boolean => {
    const glide = glideRef.current;
    if (!glide) return false;
    cancelAnimationFrame(glide.frame);
    glideRef.current = null;
    return true;
  }, []);

  /**
   * Move the strip from strip index `from` to `to` by our own frames, with
   * scroll-snap off meanwhile (it would otherwise pull every frame to a card
   * edge), each frame drawn at whichever identical spot is inside the range.
   * `to` is a whole card, so snapping comes back on (in settle) with nothing
   * to move.
   */
  const glideTo = useCallback((from: number, to: number, duration: number) => {
    const track = trackRef.current;
    if (!track) return;
    const prev = glideRef.current;
    if (prev) cancelAnimationFrame(prev.frame);
    track.style.scrollSnapType = "none";
    const d = reducedMotion() ? 0 : duration;
    const span = to - from;
    // Leave at the running glide's speed — but, going the same way, never so
    // slow that it creeps nor so fast that it overshoots (≤ 3·distance/d).
    let v0 = d > 0 ? (3 * span) / d : 0;
    if (prev && d > 0 && Math.sign(prev.v) !== -Math.sign(span)) {
      v0 = Math.sign(span) * Math.min(Math.max(Math.abs(prev.v), Math.abs(span) / d), (3 * Math.abs(span)) / d);
    } else if (prev && d > 0) v0 = prev.v;
    const glide: Glide = { from, to, v0, at: from, v: v0, start: performance.now(), duration: d, frame: 0 };
    glideRef.current = glide;
    const frame = () => {
      if (glideRef.current !== glide) return;
      const g = geometry();
      if (!g) { haltGlide(); return; }
      // The clock read now, not the frame's timestamp (which may be older
      // than the press): every frame of a glide moves.
      const t = glide.duration > 0 ? Math.min(1, (performance.now() - glide.start) / glide.duration) : 1;
      if (t < 1) ({ at: glide.at, v: glide.v } = curve(glide, t));
      else { glide.at = glide.to; glide.v = 0; }
      jump(g.track, place(g, glide.at));
      if (t < 1) { glide.frame = requestAnimationFrame(frame); return; }
      glideRef.current = null;
      settleRef.current();   // on a card now: settle puts snapping back on
    };
    if (glide.duration === 0) frame();
    else glide.frame = requestAnimationFrame(frame);
  }, [geometry, haltGlide]);

  /**
   * AT REST: stand on the real cards. Of the views identical to this one,
   * keep the one where the focused real card is visible (so the focus ring is
   * never on a hidden card), else the one whose left card is a real one.
   * Never while a finger, a held button or a glide is on the strip.
   */
  const settle = useCallback(() => {
    if (touchRef.current || pressRef.current || glideRef.current) return;
    const g = geometry();
    if (!g) return;
    const at = where(g);
    const near = Math.round(at);
    if (Math.abs(at - near) > 0.02) { glideTo(at, near, ALIGN_MS); return; }
    const options = [near, near - n, near + n].filter((i) => fits(g, i));
    const focus = focusedCard();
    const shown = focus >= 0 ? options.find((i) => shows(g, i, focus)) : undefined;
    const best = shown ?? options.find((i) => i >= 0 && i <= n - 1) ?? near;
    // Scroll-snap back on (if a hand or a glide had it off) and THEN the
    // move: the browser may still hold an old snap target from before it was
    // off and yank the strip there; the move, made with snapping on, replaces
    // that target with this card, in the same frame — nothing is painted
    // between the two.
    const restoring = Boolean(g.track.style.scrollSnapType);
    if (restoring) g.track.style.scrollSnapType = "";
    if (restoring || Math.abs(g.origin + best * g.pitch - g.track.scrollLeft) > 0.5) jump(g.track, g.origin + best * g.pitch);
    indexRef.current = ((best % n) + n) % n;
    // A keyboard focus on a card no identical view shows: bring it in.
    if (focus >= 0 && shown === undefined && document.activeElement?.matches(":focus-visible")) {
      revealRef.current(focus, focus < best ? -1 : 1);
    }
  }, [geometry, glideTo, focusedCard, n]);

  /**
   * A finger or a sideways wheel takes the strip: a glide stops right where
   * it is, and if the strip is out over the copies it is first moved —
   * invisibly, by one list's width, scroll-snap off so the move is exact —
   * back over the real cards, so a run of quick swipes never meets the end of
   * the strip, however many there are before it ever comes to rest.
   */
  const takeOver = useCallback((wheel = false) => {
    const halted = haltGlide();
    const g = geometry();
    if (!g) return;
    const at = where(g);
    // A wheel's own snap animation outlives a move made under it (and would
    // pull the strip back to the copy it was heading for once snapping is on
    // again): under a wheel, only a strip deep in the copies is moved — a
    // long, unbroken scroll; the rest is settled when the wheel stops.
    const edge = wheel ? n / 2 : 0.5;
    const shift = at < -edge ? n : at >= n - 1 + edge ? -n : 0;
    if (shift && Math.abs(at - Math.round(at)) > 0.02) g.track.style.scrollSnapType = "none";
    if (shift) jump(g.track, g.origin + (at + shift) * g.pitch);
    if (halted) g.track.style.scrollSnapType = "none";
  }, [geometry, haltGlide, n]);

  /** Bring real card k into view after the focus moved to it, coming in from
   *  the side the focus moved towards (dir) — the real card, never a copy. */
  const reveal = useCallback((k: number, dir: -1 | 1) => {
    const g = geometry();
    if (!g) return;
    const glide = glideRef.current;
    // Where the strip is going to rest (a glide's end, or here).
    const now = glide ? glide.at : where(g);
    const rest = glide ? glide.to : Math.round(now);
    // That rest — or its twin one list away — may already show the card…
    let end = [rest, rest - n, rest + n].find((i) => fits(g, i) && shows(g, i, k));
    // …else card k at the right edge (moving right) or the left (moving left).
    if (end === undefined) {
      const whole = Math.max(1, Math.floor((g.track.clientWidth + g.gap) / g.pitch + 0.01));
      end = dir > 0 ? k - (whole - 1) : k;
    }
    // Glide from the identical view that lies less than one list behind the
    // end in the direction the focus moved: never backwards, never a lap.
    const ahead = (((end - now) % n) + n) % n;
    const start = dir > 0 ? end - ahead : end + ((n - ahead) % n);
    if (!glide && Math.abs(start - end) < 0.001) {
      if (Math.abs(g.origin + end * g.pitch - g.track.scrollLeft) > 0.5) jump(g.track, g.origin + end * g.pitch);
      indexRef.current = ((end % n) + n) % n;
      return;
    }
    glideTo(start, end, STEP_MS);
  }, [geometry, glideTo, n]);

  useEffect(() => { settleRef.current = settle; revealRef.current = reveal; }, [settle, reveal]);

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
    // Rest = no scroll event, no finger, no held button for a moment;
    // `scrollend`, where the browser has it, says so at once. Momentum and
    // snapping keep firing scroll events, so neither is ever cut short.
    const later = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => settleRef.current(), SETTLE_MS);
    };
    let touchLeft = 0;
    // Once the strip itself is scrolling with the finger, the browser snaps
    // only when the swipe ends: snapping can come back on — so a swipe begun
    // over a halted glide or the invisible move still lands on a card's edge,
    // one card per swipe, like any other. A finger moving the PAGE (up/down)
    // leaves the strip, and its snapping, alone: settle eases it onto a card.
    // Checked on scroll too: while a swipe scrolls, the browser may hold back
    // touchmove events.
    const resnapUnderFinger = () => {
      if (touchRef.current && track.style.scrollSnapType && Math.abs(track.scrollLeft - touchLeft) > 1) track.style.scrollSnapType = "";
    };
    const onScroll = () => { resnapUnderFinger(); later(); };
    const onEnd = () => { window.clearTimeout(timerRef.current); settleRef.current(); };
    // A finger or a sideways wheel takes the strip (see takeOver).
    const onTouchStart = () => {
      touchRef.current = true;
      window.clearTimeout(timerRef.current);
      takeOver();
      touchLeft = track.scrollLeft;
    };
    const onTouchMove = resnapUnderFinger;
    // Only when the last finger lifts (a second finger lifting first is not
    // the end of the hold).
    const onTouchEnd = (e: TouchEvent) => {
      if ((e.touches?.length ?? 0) > 0) return;
      touchRef.current = false;
      later();
    };
    const onWheel = (e: WheelEvent) => { if (e.deltaX !== 0 || e.shiftKey) takeOver(true); };
    // A held mouse button (main, or middle — open in a new tab): a glide stops
    // and nothing settles under it, so a press and its release are on the
    // same card and the click is never lost. Not moved over the copies: the
    // card under the button must stay.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || (e.button !== 0 && e.button !== 1)) return;
      pressRef.current = true;
      if (haltGlide()) track.style.scrollSnapType = "none";
    };
    const onRelease = () => { if (pressRef.current) { pressRef.current = false; later(); } };
    // A pointer's focus never stays on a copy (Tab cannot reach one at all):
    // a mouse's is dropped when the press ends — not during it, which would
    // cancel the link's own drag and turn a drag into a click; a tap's (which
    // arrives after the finger has lifted) at once.
    const dropCopyFocus = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && track.contains(el) && el.closest("[data-loop-clone]")) el.blur();
    };
    const onPointerUp = () => { onRelease(); dropCopyFocus(); };
    // A context menu swallows the release (and may follow a ctrl-click); so
    // does leaving the window with the button down.
    const onContextMenu = () => { onRelease(); dropCopyFocus(); };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest("[data-loop-clone]")) { if (!pressRef.current) el.blur(); return; }
      // Tab / Shift+Tab onto a real card the browser left out of view (or a
      // glide is carrying away): bring it in, from the side the focus came.
      if (keyRef.current || !el.matches(":focus-visible")) return;
      const cards = Array.from(track.querySelectorAll<HTMLElement>(":scope > [data-loop-item]"));
      const k = cards.findIndex((c) => c.contains(el));
      if (k < 0) return;
      const from = e.relatedTarget as Node | null;
      const p = from ? cards.findIndex((c) => c.contains(from)) : -1;
      const dir: -1 | 1 = p >= 0 ? ((k - p + n) % n <= n / 2 ? 1 : -1)
        : from && (from.compareDocumentPosition(track) & Node.DOCUMENT_POSITION_PRECEDING) ? -1 : 1;
      requestAnimationFrame(() => {
        const g = geometry();
        if (!g || focusedCard() !== k) return;
        if (glideRef.current || !shows(g, where(g), k)) reveal(k, dir);
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("scrollend", onEnd);
    track.addEventListener("touchstart", onTouchStart, { passive: true });
    track.addEventListener("touchmove", onTouchMove, { passive: true });
    track.addEventListener("touchend", onTouchEnd, { passive: true });
    track.addEventListener("touchcancel", onTouchEnd, { passive: true });
    track.addEventListener("wheel", onWheel, { passive: true });
    track.addEventListener("pointerdown", onPointerDown, { passive: true });
    track.addEventListener("contextmenu", onContextMenu);
    track.addEventListener("focusin", onFocusIn);
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onRelease, { passive: true });
    window.addEventListener("dragend", onPointerUp, { passive: true });
    window.addEventListener("blur", onRelease);
    // Nothing focusable inside a copy — including what a slot renders later
    // (a clip's controls).
    const quiet = () => track.querySelectorAll<HTMLElement>(COPY_FOCUSABLE).forEach((el) => {
      if (el.getAttribute("tabindex") !== "-1") el.setAttribute("tabindex", "-1");
    });
    quiet();
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(quiet) : null;
    mo?.observe(track, { childList: true, subtree: true });
    // A new width (rotation, a breakpoint) changes every card's width: put the
    // same real card back at the left edge — or, if the focus is on a card
    // that would then be out of view, that card. A glide measures afresh every
    // frame and lands right by itself. Height alone (a font) changes nothing.
    let width = track.clientWidth;
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        if (track.clientWidth === width) return;
        width = track.clientWidth;
        if (touchRef.current || pressRef.current || glideRef.current) return;
        const g = geometry();
        if (!g) return;
        const focus = focusedCard();
        const at = focus >= 0 && !shows(g, indexRef.current, focus) ? focus : indexRef.current;
        g.track.style.scrollSnapType = "";
        jump(g.track, g.origin + at * g.pitch);
      })
      : null;
    ro?.observe(track);
    return () => {
      window.clearTimeout(timerRef.current);
      haltGlide();
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("scrollend", onEnd);
      track.removeEventListener("touchstart", onTouchStart);
      track.removeEventListener("touchmove", onTouchMove);
      track.removeEventListener("touchend", onTouchEnd);
      track.removeEventListener("touchcancel", onTouchEnd);
      track.removeEventListener("wheel", onWheel);
      track.removeEventListener("pointerdown", onPointerDown);
      track.removeEventListener("contextmenu", onContextMenu);
      track.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onRelease);
      window.removeEventListener("dragend", onPointerUp);
      window.removeEventListener("blur", onRelease);
      mo?.disconnect();
      ro?.disconnect();
    };
  }, [ready, geometry, focusedCard, haltGlide, takeOver, reveal]);

  /** One card left or right, round and round; presses add up. */
  const step = (dir: -1 | 1) => {
    const g = geometry();
    if (!g) return;
    const glide = glideRef.current;
    const from = glide ? glide.at : where(g);
    glideTo(from, (glide ? glide.to : Math.round(from)) + dir, STEP_MS);
  };


  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    // Alt/Cmd+← → is the browser's Back/Forward: never taken.
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(":scope > [data-loop-item]"));
    const at = cards.findIndex((c) => c.contains(document.activeElement));
    if (at < 0) return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    // The neighbour that opens; a card that does not open (yet) is stepped over.
    for (let s = 1; s < n; s++) {
      const k = (((at + dir * s) % n) + n) % n;
      const card = cards[k];
      const target = card.matches(FOCUSABLE) ? card : card.querySelector<HTMLElement>(FOCUSABLE);
      if (!target) continue;
      e.preventDefault();
      keyRef.current = true;
      target.focus({ preventScroll: true });
      keyRef.current = false;
      reveal(k, dir);
      return;
    }
  };

  const arrow = "absolute z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--surface)/0.82)] text-ink shadow-[0_8px_24px_-10px_rgb(0_0_0/0.45)] backdrop-blur-md transition-[opacity,transform] duration-200 hover:scale-105 sm:flex motion-reduce:transition-none motion-reduce:hover:scale-100";
  const copy = (side: "before" | "after") => clones.map((node, i) => (
    <div key={`${side}-${i}`} aria-hidden="true" data-loop-clone={side}>{node}</div>
  ));

  return (
    <div className="relative" role="region" aria-roledescription={role} aria-label={label} data-loop-rail>
      <div ref={trackRef} onKeyDown={onKey}
        className={cn(
          "flex snap-x snap-mandatory gap-[var(--rail-gap)] overflow-x-auto overscroll-x-contain pb-1 pt-1 [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[&_a:focus-visible]:outline-offset-[-3px] [&>*:focus-visible]:outline-offset-[-3px]",
          "[&>*]:w-[calc((100%_-_(var(--rail-cols)_-_1)_*_var(--rail-gap))_/_var(--rail-cols))] [&>*]:shrink-0 [&>*]:snap-start",
          // Card + gap a multiple of 4px where the browser can round (see above).
          "supports-[width:round(down,1px,1px)]:[&>*]:w-[calc(round(nearest,calc((100%_-_(var(--rail-cols)_-_1)_*_var(--rail-gap))_/_var(--rail-cols)_+_var(--rail-gap)),4px)_-_var(--rail-gap))]",
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
