"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MediaPair } from "@/lib/seller-home-config";
import { EmptySlot, SlotImage } from "./media-slot";

/**
 * BEFORE / AFTER WITH A DRAGGABLE DIVIDER.
 *
 * The control is a real <input type="range"> laid over the whole picture and
 * made invisible: a mouse drag, a touch drag and the keyboard (arrows,
 * Home/End, Page Up/Down) all move it natively, and a screen reader announces
 * it with its label and value. `touch-action: pan-y` keeps a vertical swipe
 * scrolling the page on a phone instead of being captured by the slider.
 *
 * Empty sides render the quiet MediaSlot placeholder, so the comparison works
 * (and can be tried) before any picture exists.
 */
export function BeforeAfter({ pair, labels, alt = "", sizes }: {
  pair: MediaPair;
  labels: { before: string; after: string; slider: string; emptyBefore: string; emptyAfter: string; hint: string };
  alt?: string;
  sizes: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div className="group/ba relative isolate aspect-[4/3] select-none overflow-hidden" data-before-after>
      {/* AFTER — the full frame underneath. */}
      <div className="absolute inset-0">
        {pair.after.src
          ? <SlotImage media={pair.after} alt={alt} sizes={sizes} />
          : (
            <div className="absolute inset-0 bg-[rgb(var(--ink)/0.06)] dark:bg-[rgb(var(--ink)/0.08)]">
              <div className="absolute inset-y-0 right-0 w-1/2"><EmptySlot label={labels.emptyAfter} hint={labels.hint} className="bg-transparent dark:bg-transparent" /></div>
            </div>
          )}
      </div>
      {/* BEFORE — the same frame, clipped to the divider. */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {pair.before.src
          ? <SlotImage media={pair.before} alt={alt} sizes={sizes} />
          : (
            <div className="absolute inset-0 bg-[rgb(var(--surface))]">
              <div aria-hidden className="absolute inset-0 bg-[rgb(var(--ink)/0.02)] dark:bg-[rgb(var(--ink)/0.03)]" />
              <div className="absolute inset-y-0 left-0 w-1/2"><EmptySlot label={labels.emptyBefore} hint={labels.hint} className="bg-transparent dark:bg-transparent" /></div>
            </div>
          )}
      </div>

      <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.12)]"
        style={{ left: `${pos}%` }} />
      <span aria-hidden
        className="pointer-events-none absolute top-1/2 z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[rgb(32_22_45)] shadow-[0_4px_14px_rgb(0_0_0/0.22)] transition-transform group-focus-within/ba:scale-110 group-focus-within/ba:ring-2 group-focus-within/ba:ring-[rgb(var(--accent))]"
        style={{ left: `${pos}%` }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4 2 8l4 4M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>

      <span className={cn(CAPTION, "left-2")}>{labels.before}</span>
      <span className={cn(CAPTION, "right-2")}>{labels.after}</span>

      <input type="range" min={0} max={100} step={1} value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={labels.slider}
        aria-valuetext={`${pos}%`}
        data-before-after-range
        className="absolute inset-0 z-20 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0 [touch-action:pan-y]" />
    </div>
  );
}

const CAPTION = "pointer-events-none absolute bottom-2 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white";
