"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A HORIZONTAL RAIL OF CARDS — /home's carousels.
 *
 * Plain native scrolling, so a mouse wheel, a trackpad, a touch swipe and the
 * browser's own momentum all just work; `scroll-snap` lands every move on a
 * card's edge. The arrows step one viewport's worth of whole cards and switch
 * off at either end (hidden, not just greyed, so nothing invites a press that
 * does nothing). ←/→ on a focused card move focus to its neighbour, which the
 * browser scrolls into view.
 *
 * How many cards show is CSS, per breakpoint, through two custom properties
 * the caller sets on `className`:
 *   --rail-cols   cards across, fractions allowed ("3.5" = three and a half)
 *   --rail-gap    the gap between cards
 * A card is then exactly (100% − whole gaps) ÷ cols wide, so "3.5" really
 * shows three cards and half of the fourth.
 *
 * Only the rail's own box scrolls sideways; the page never does. A focused
 * card's outline is drawn inside its edge, so the rail's clipping never cuts
 * it off.
 */
export function Rail({ label, role, prevLabel, nextLabel, landmark = true, className, arrowTop = "50%", children }: {
  label: string;
  /** What a screen reader calls the widget ("karuzela"), translated. */
  role: string;
  prevLabel: string;
  nextLabel: string;
  /** A region landmark of its own (the first carousel), or a plain group
   *  inside a section that already is one. */
  landmark?: boolean;
  /** Sets --rail-cols / --rail-gap per breakpoint. */
  className?: string;
  /** Where the arrows sit vertically (e.g. the middle of the pictures,
   *  above the captions). */
  arrowTop?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // No arrows until measured: the server cannot know whether the row overflows.
  const [edge, setEdge] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft >= max - 2;
    // The arrow about to disappear may hold the keyboard focus: hand it to
    // the other arrow (or the first / last card) instead of dropping it.
    const active = document.activeElement;
    if ((end && active === nextRef.current) || (start && active === prevRef.current)) {
      const other = end ? prevRef.current : nextRef.current;
      const cards = Array.from(el.children) as HTMLElement[];
      const card = end ? cards[cards.length - 1] : cards[0];
      const fallback = card?.matches("a[href], [tabindex='0']") ? card : card?.querySelector<HTMLElement>("a[href], [tabindex='0']");
      (other && !(start && end) ? other : fallback)?.focus({ preventScroll: true });
    }
    setEdge({ start, end });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro?.disconnect(); };
  }, [measure]);

  const step = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const unit = card ? card.getBoundingClientRect().width + gap : el.clientWidth;
    // Whole cards that fit, at least one.
    const n = Math.max(1, Math.floor((el.clientWidth + gap) / unit));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * n * unit, behavior: reduce ? "auto" : "smooth" });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    // A control inside a card owns its arrows (the before/after divider).
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const items = Array.from(ref.current?.children ?? []) as HTMLElement[];
    const at = items.findIndex((it) => it.contains(document.activeElement));
    if (at < 0) return;
    // The card itself may be the link; a card that does not open (yet) has
    // nothing to focus and is stepped over.
    const focusable = "a[href], button:not([disabled]), [tabindex='0']";
    const step = e.key === "ArrowRight" ? 1 : -1;
    let target: HTMLElement | null = null;
    for (let i = at + step; i >= 0 && i < items.length && !target; i += step) {
      const it = items[i];
      target = it.matches(focusable) ? it : it.querySelector<HTMLElement>(focusable);
    }
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  const arrow = "absolute z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[rgb(var(--glass-border)/0.22)] bg-[rgb(var(--surface)/0.82)] text-ink shadow-[0_8px_24px_-10px_rgb(0_0_0/0.45)] backdrop-blur-md transition-[opacity,transform] duration-200 hover:scale-105 sm:flex motion-reduce:transition-none motion-reduce:hover:scale-100";

  return (
    <div className="relative" role={landmark ? "region" : "group"} aria-roledescription={role} aria-label={label}>
      <div ref={ref} onKeyDown={onKey}
        className={cn(
          "flex snap-x snap-mandatory gap-[var(--rail-gap)] overflow-x-auto overscroll-x-contain scroll-smooth pb-1 pt-1 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden",
          "[&_a:focus-visible]:outline-offset-[-3px] [&>*:focus-visible]:outline-offset-[-3px]",
          "[&>*]:w-[calc((100%_-_(var(--rail-cols)_-_1)_*_var(--rail-gap))_/_var(--rail-cols))] [&>*]:shrink-0 [&>*]:snap-start",
          className,
        )}>
        {children}
      </div>
      {!edge.start && (
        <button ref={prevRef} type="button" onClick={() => step(-1)} aria-label={prevLabel} data-rail-prev
          className={cn(arrow, "left-2")} style={{ top: arrowTop }}>
          <ChevronLeft size={18} aria-hidden />
        </button>
      )}
      {!edge.end && (
        <button ref={nextRef} type="button" onClick={() => step(1)} aria-label={nextLabel} data-rail-next
          className={cn(arrow, "right-2")} style={{ top: arrowTop }}>
          <ChevronRight size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
