"use client";
import { useRef, useState, type PointerEvent } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaPair, MediaSrc } from "@/lib/seller-home-config";
import { EmptyArt } from "./media-slot";

/**
 * BEFORE / AFTER WITH A DRAGGABLE DIVIDER.
 *
 * The VALUE lives in a real <input type="range"> — invisible, but focusable:
 * the keyboard (arrows, Home/End, Page Up/Down) moves it natively and a
 * screen reader announces its label and value.
 *
 * The POINTER is handled here, so the card still scrolls with its rail on a
 * phone: a mouse drags the divider from anywhere on the picture, a finger or
 * a pen only from the handle's 44px strip — a swipe anywhere else pans the
 * row (the range itself takes no pointer events, or it would swallow every
 * horizontal swipe). The strip is `touch-action: none`; the rest of the frame
 * keeps the browser's own panning.
 *
 * It is NOT inside a link: dragging the divider must never navigate. The card
 * around it links from its caption only.
 *
 * Empty sides render the quiet brand placeholder, so the comparison works
 * (and can be tried) before any picture exists.
 */
export function BeforeAfter({ pair, ratio, labels, sizes, tone = 0 }: {
  pair: MediaPair;
  /** CSS aspect-ratio of the frame ("1080/1350"). */
  ratio: string;
  labels: { before: string; after: string; slider: string; emptyBefore: string; emptyAfter: string; hint: string };
  sizes: string;
  tone?: number;
}) {
  const [pos, setPos] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setPos(Math.round(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100))));
  };
  const start = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLElement>) => { if (dragging.current) moveTo(e.clientX); };
  const stop = () => { dragging.current = false; };

  return (
    <div ref={frame} className="group/ba relative isolate w-full cursor-ew-resize select-none overflow-hidden" style={{ aspectRatio: ratio }} data-before-after
      onPointerDown={(e) => { if (e.pointerType === "mouse") start(e); }}
      onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>
      {/* AFTER — the full frame underneath. */}
      <div className="absolute inset-0">
        {pair.after.src
          ? <Picture media={pair.after} sizes={sizes} />
          : <EmptyHalf tone={tone + 1} at="right" label={labels.emptyAfter} hint={labels.hint} />}
      </div>
      {/* BEFORE — the same frame, clipped to the divider. */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {pair.before.src
          ? <Picture media={pair.before} sizes={sizes} />
          : (
            <span className="absolute inset-0 block grayscale-[.85]">
              <EmptyHalf tone={tone} at="left" label={labels.emptyBefore} hint={labels.hint} />
            </span>
          )}
      </div>

      <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.12)]"
        style={{ left: `${pos}%` }} />
      <span aria-hidden
        className="pointer-events-none absolute top-1/2 z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[rgb(32_22_45)] shadow-[0_4px_14px_rgb(0_0_0/0.22)] transition-transform group-focus-within/ba:scale-110 group-focus-within/ba:ring-2 group-focus-within/ba:ring-[rgb(var(--accent))] motion-reduce:transition-none"
        style={{ left: `${pos}%` }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4 2 8l4 4M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      {/* The touch grip: the handle's own strip, full height. */}
      <span aria-hidden data-before-after-grip
        className="absolute inset-y-0 z-30 w-11 -translate-x-1/2 cursor-ew-resize [touch-action:none]"
        style={{ left: `${pos}%` }}
        onPointerDown={(e) => { if (e.pointerType !== "mouse") { e.stopPropagation(); start(e); } }}
        onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />

      <span className={cn(CAPTION, "left-2")}>{labels.before}</span>
      <span className={cn(CAPTION, "right-2")}>{labels.after}</span>

      <input type="range" min={0} max={100} step={1} value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={labels.slider}
        aria-valuetext={`${pos}%`}
        data-before-after-range
        className="pointer-events-none absolute inset-0 z-20 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0" />
    </div>
  );
}

function Picture({ media, sizes }: { media: MediaSrc; sizes: string }) {
  if (!media.src) return null;
  const pos = { objectPosition: media.position ?? "center" };
  // Plain <img>: both halves must be the SAME pixels at the same place, and a
  // file the optimiser may not fetch (an external URL) must still show.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={media.src} alt={media.alt ?? ""} sizes={sizes} loading="lazy" decoding="async" draggable={false}
      className={cn("absolute inset-0 h-full w-full", media.fit === "contain" ? "object-contain" : "object-cover")} style={pos} />
  );
}

/** An empty side: the brand wash over the whole frame, and the slot's name and
 *  size centred in ITS half (a quarter in from its edge) — clear of the divider
 *  handle in the middle and of the PRZED / PO badges at the bottom. */
function EmptyHalf({ tone, at, label, hint }: { tone: number; at: "left" | "right"; label: string; hint: string }) {
  return (
    <>
      <EmptyArt tone={tone} label={label} hint={hint} bare icon={false} />
      <span aria-hidden className={cn(
        "absolute top-1/2 flex w-[42%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center",
        at === "left" ? "left-1/4" : "left-3/4",
      )}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface)/0.55)] text-[rgb(var(--ink)/0.45)] ring-1 ring-[rgb(var(--glass-border)/0.18)] backdrop-blur-sm">
          <ImageIcon size={14} strokeWidth={1.8} />
        </span>
        <span className="block max-w-full truncate text-[10px] leading-tight text-[rgb(var(--ink)/0.5)]">{label}</span>
        <span className="block text-[9.5px] leading-none tabular-nums text-[rgb(var(--ink)/0.38)]">{hint}</span>
      </span>
    </>
  );
}

const CAPTION = "pointer-events-none absolute bottom-2 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white";
