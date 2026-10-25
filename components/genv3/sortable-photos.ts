"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * DRAG & DROP ZDJĘĆ V2 — the order of a tool's photos, by hand.
 *
 * No library: nothing for drag and drop is installed, and what a 10-photo
 * grid needs is small enough to own — one hook for the three ways in:
 *
 *   MOUSE   press and move 5 px: the photo lifts (grab → grabbing, a slight
 *           scale and shadow), the others make way, the empty slot shows
 *           where it will land. A press without movement is still a click —
 *           the preview opens; a drag never opens it.
 *   TOUCH   press and HOLD 250 ms (a short vibration where supported): only
 *           then does the photo lift and the page stop scrolling under the
 *           finger. Moving sooner is an ordinary scroll. Nothing sets
 *           `touch-action: none` on the panel.
 *   KEYS    on the photo's number: Space/Enter lifts it, the arrows move it
 *           (up/down by a row), Space/Enter drops it, Escape puts it back.
 *           Every step is announced ("Zdjęcie 3 przeniesione na pozycję 1.").
 *
 * The photos keep their own stable keys; the hook only ever reports ONE
 * move (from, to) when a drag ends, and the tool applies it to its array —
 * so the order in the panel is the order in the request, by construction.
 */

/** The array with one element moved — what a drop does, and nothing else. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item as T);
  return next;
}

/** Which slot a point is over: the nearest centre, so a gap between tiles
 *  and the space past the last one both resolve to a real position. */
export function nearestSlot(centres: { x: number; y: number }[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  centres.forEach((c, i) => {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Arrow keys on a grid of `cols` columns, clamped to the list. */
export function keyTarget(index: number, key: string, cols: number, count: number): number {
  const step = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -cols : key === "ArrowDown" ? cols : 0;
  return Math.max(0, Math.min(count - 1, index + step));
}

const MOUSE_THRESHOLD = 5;
const TOUCH_HOLD_MS = 250;
const TOUCH_SLOP = 8;
const EDGE = 48;
const MAX_SPEED = 14;

export type DragMode = "pointer" | "touch" | "keyboard";

export type DragState = {
  key: string;
  from: number;
  over: number;
  mode: DragMode;
  /** The floating copy's top-left, in viewport px (pointer and touch). */
  x: number; y: number;
  w: number; h: number;
};

type Announce = (kind: "lifted" | "moved" | "dropped" | "cancelled", n: number, m: number) => void;

export function useSortablePhotos<T extends { key: string }>({ items, onMove, announce, enabled }: {
  items: readonly T[];
  onMove?: (from: number, to: number) => void;
  announce: Announce;
  enabled: boolean;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** A press that turned into a drag must not also be a click. */
  const swallowClick = useRef(false);
  const pending = useRef<{
    key: string; index: number; x: number; y: number; ox: number; oy: number; w: number; h: number;
    mode: "pointer" | "touch"; timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const scroller = useRef<HTMLElement | null>(null);
  const raf = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const announceRef = useRef(announce);
  announceRef.current = announce;

  const order = drag ? reorder(items, drag.from, drag.over) : [...items];

  /** Moving a keyed element in the DOM drops its focus; the keyboard user's
   *  photo keeps it, on its number, wherever it now stands. */
  const refocus = useCallback((key: string) => {
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-photo-key="${CSS.escape(key)}"] [data-photo-order]`)?.focus();
    });
  }, []);

  /* ── where is the pointer ──────────────────────────────────────────── */
  const slotCentres = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return [];
    const rect = grid.getBoundingClientRect();
    // offsetLeft/Top ignore the make-way transforms, so a slot is where it
    // will settle, not where its animation happens to be this frame.
    return [...grid.querySelectorAll<HTMLElement>("[data-sort-slot]")].map((el) => ({
      x: rect.left + el.offsetLeft + el.offsetWidth / 2,
      y: rect.top + el.offsetTop + el.offsetHeight / 2,
    }));
  }, []);

  const track = useCallback(() => {
    const d = dragRef.current;
    if (!d || d.mode === "keyboard") return;
    const over = nearestSlot(slotCentres(), pointer.current.x, pointer.current.y);
    const p = pending.current;
    const next = {
      ...d,
      over: over < 0 ? d.over : over,
      x: pointer.current.x - (p?.ox ?? d.w / 2),
      y: pointer.current.y - (p?.oy ?? d.h / 2),
    };
    if (next.over !== d.over || next.x !== d.x || next.y !== d.y) setDrag(next);
  }, [slotCentres]);

  /* ── auto-scroll near the edges ────────────────────────────────────── */
  const stopScroll = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);
  const scrollLoop = useCallback(() => {
    raf.current = requestAnimationFrame(() => {
      if (!dragRef.current) { raf.current = null; return; }
      const el = scroller.current;
      const top = el ? el.getBoundingClientRect().top : 0;
      const bottom = el ? el.getBoundingClientRect().bottom : window.innerHeight;
      const y = pointer.current.y;
      let dy = 0;
      if (y < top + EDGE) dy = -Math.ceil(MAX_SPEED * Math.min(1, (top + EDGE - y) / EDGE));
      else if (y > bottom - EDGE) dy = Math.ceil(MAX_SPEED * Math.min(1, (y - (bottom - EDGE)) / EDGE));
      if (dy !== 0) {
        if (el) el.scrollTop += dy; else window.scrollBy(0, dy);
        track();
      }
      scrollLoop();
    });
  }, [track]);

  const begin = useCallback((mode: "pointer" | "touch") => {
    const p = pending.current;
    if (!p) return;
    swallowClick.current = true;
    scroller.current = scrollParent(gridRef.current);
    const state: DragState = {
      key: p.key, from: p.index, over: p.index, mode,
      x: pointer.current.x - p.ox, y: pointer.current.y - p.oy, w: p.w, h: p.h,
    };
    setDrag(state);
    dragRef.current = state;
    document.documentElement.dataset.photoDragging = mode;
    if (mode === "touch") { try { navigator.vibrate?.(10); } catch { /* not everywhere */ } }
    announceRef.current("lifted", p.index + 1, p.index + 1);
    scrollLoop();
  }, [scrollLoop]);

  const finish = useCallback((commit: boolean) => {
    const d = dragRef.current;
    const p = pending.current;
    if (p?.timer) clearTimeout(p.timer);
    pending.current = null;
    stopScroll();
    delete document.documentElement.dataset.photoDragging;
    if (!d) return;
    setDrag(null);
    dragRef.current = null;
    if (commit && d.over !== d.from) {
      onMoveRef.current?.(d.from, d.over);
      announceRef.current("dropped", d.from + 1, d.over + 1);
    } else {
      announceRef.current(commit ? "dropped" : "cancelled", d.from + 1, d.from + 1);
    }
    if (d.mode === "keyboard") refocus(d.key);
    // The click that follows a pointer drag is swallowed once, then released.
    setTimeout(() => { swallowClick.current = false; }, 0);
  }, [stopScroll, refocus]);

  /* ── mouse / pen ───────────────────────────────────────────────────── */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>, index: number, key: string) => {
    if (!enabled || !onMoveRef.current || e.pointerType === "touch" || e.button !== 0) return;
    if (dragRef.current) return;
    const cell = e.currentTarget.getBoundingClientRect();
    pending.current = {
      key, index, x: e.clientX, y: e.clientY, ox: e.clientX - cell.left, oy: e.clientY - cell.top,
      w: cell.width, h: cell.height, mode: "pointer", timer: null,
    };
    pointer.current = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      pointer.current = { x: ev.clientX, y: ev.clientY };
      const p = pending.current;
      if (!dragRef.current && p && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) >= MOUSE_THRESHOLD) begin("pointer");
      if (dragRef.current) { ev.preventDefault(); track(); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (dragRef.current) finish(true);
      else pending.current = null;
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }, [enabled, begin, track, finish]);

  /* ── touch: long-press, then the page holds still ──────────────────── */
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLElement>, index: number, key: string) => {
    if (!enabled || !onMoveRef.current || e.touches.length !== 1 || dragRef.current) return;
    const t = e.touches[0]!;
    const cell = e.currentTarget.getBoundingClientRect();
    pointer.current = { x: t.clientX, y: t.clientY };
    const p = {
      key, index, x: t.clientX, y: t.clientY, ox: t.clientX - cell.left, oy: t.clientY - cell.top,
      w: cell.width, h: cell.height, mode: "touch" as const, timer: null as ReturnType<typeof setTimeout> | null,
    };
    pending.current = p;
    p.timer = setTimeout(() => { if (pending.current === p) begin("touch"); }, TOUCH_HOLD_MS);
    const move = (ev: TouchEvent) => {
      const tt = ev.touches[0];
      if (!tt) return;
      pointer.current = { x: tt.clientX, y: tt.clientY };
      if (dragRef.current) {
        // Only now, and only while the photo is held: the page stays put.
        ev.preventDefault();
        track();
      } else if (Math.hypot(tt.clientX - p.x, tt.clientY - p.y) > TOUCH_SLOP) {
        // Moved before the hold: an ordinary scroll. Let it be one.
        if (p.timer) clearTimeout(p.timer);
        pending.current = null;
        detach();
      }
    };
    const end = (ev: TouchEvent) => {
      detach();
      if (dragRef.current) { ev.preventDefault(); finish(ev.type === "touchend"); }
      else { if (p.timer) clearTimeout(p.timer); pending.current = null; }
    };
    const menu = (ev: Event) => { if (pending.current === p || dragRef.current) ev.preventDefault(); };
    // The page started scrolling during the hold (iOS can begin a scroll
    // before our slop is reached): it is a scroll, not a lift.
    const scrolled = () => {
      if (dragRef.current) return;
      if (p.timer) clearTimeout(p.timer);
      if (pending.current === p) pending.current = null;
      detach();
    };
    const detach = () => {
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
      document.removeEventListener("contextmenu", menu);
      window.removeEventListener("scroll", scrolled, true);
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: false });
    document.addEventListener("touchcancel", end, { passive: false });
    document.addEventListener("contextmenu", menu);
    window.addEventListener("scroll", scrolled, { capture: true, passive: true });
  }, [enabled, begin, track, finish]);

  /* ── keyboard ──────────────────────────────────────────────────────── */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>, index: number, key: string) => {
    if (!enabled || !onMoveRef.current) return;
    const d = dragRef.current;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!d) {
        const state: DragState = { key, from: index, over: index, mode: "keyboard", x: 0, y: 0, w: 0, h: 0 };
        setDrag(state);
        dragRef.current = state;
        announceRef.current("lifted", index + 1, index + 1);
      } else if (d.mode === "keyboard") {
        finish(true);
      }
      return;
    }
    if (!d || d.mode !== "keyboard") return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const over = keyTarget(d.over, e.key, gridColumns(gridRef.current), itemsRef.current.length);
      if (over !== d.over) {
        const next = { ...d, over };
        setDrag(next);
        dragRef.current = next;
        announceRef.current("moved", d.from + 1, over + 1);
        refocus(d.key);
      }
    }
  }, [enabled, finish, refocus]);

  // Escape lifts nothing for a pointer drag in progress: it puts it back.
  useEffect(() => {
    if (!drag || drag.mode === "keyboard") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag, finish]);

  // The items changed under a drag (an upload finished, one was removed):
  // the drag is abandoned rather than applied to a different list.
  const signature = items.map((i) => i.key).join("|");
  const startedOn = useRef(signature);
  useEffect(() => {
    if (!dragRef.current) { startedOn.current = signature; return; }
    if (startedOn.current !== signature) finish(false);
  }, [signature, finish]);

  useEffect(() => () => { stopScroll(); delete document.documentElement.dataset.photoDragging; }, [stopScroll]);

  /* ── the others make way (FLIP), unless motion is reduced ──────────── */
  const rects = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { x: number; y: number }>();
    grid.querySelectorAll<HTMLElement>("[data-sort-key]").forEach((el) => {
      const k = el.dataset.sortKey!;
      const now = { x: el.offsetLeft, y: el.offsetTop };
      next.set(k, now);
      const prev = rects.current.get(k);
      if (!reduced && prev && (prev.x !== now.x || prev.y !== now.y)) {
        el.style.transition = "none";
        el.style.transform = `translate(${prev.x - now.x}px, ${prev.y - now.y}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 180ms cubic-bezier(.2,.7,.2,1)";
          el.style.transform = "";
        });
      }
    });
    rects.current = next;
  });

  return {
    drag, order, gridRef,
    handlers: { onPointerDown, onTouchStart, onKeyDown },
    /** Call from the tile's onClick: true = this click ended a drag, ignore it. */
    consumeClick: () => swallowClick.current,
  };
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

function gridColumns(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const cells = [...grid.querySelectorAll<HTMLElement>("[data-sort-slot]")];
  if (cells.length === 0) return 1;
  const top = cells[0]!.offsetTop;
  const n = cells.filter((c) => c.offsetTop === top).length;
  return Math.max(1, n);
}
