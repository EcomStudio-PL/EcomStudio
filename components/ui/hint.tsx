"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE HELP GLYPH THAT ACTUALLY EXPLAINS.
 *
 * `title="…"` is not an explanation: it never appears on a touch screen, it
 * waits a second on a desktop and it is styled by the operating system. This
 * is a real popover — hover OR click on a pointer device, tap on a phone —
 * portalled so the generator's clipping scroll column cannot cut it off, and
 * clamped to the viewport so it can never open off-screen.
 *
 * It carries the sentences a panel should not wear permanently: what
 * inspiration photos do, what a setting changes. The panel stays quiet; the
 * explanation is one tap away.
 */
export function InfoHint({ text, label, className }: {
  /** The explanation. Plain text — this is a hint, not a document. */
  text: string;
  /** Accessible name for the trigger; defaults to the text itself. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Hover opens it; a CLICK pins it so it survives the pointer leaving — and
  // a second click closes it. Without the distinction, clicking a hint that
  // hover had already opened would toggle it shut, which is exactly what a
  // touch device does not want and a mouse user does not expect.
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    const width = Math.min(260, window.innerWidth - margin * 2);
    // Prefer below-left-aligned; flip above when the bottom is out of room.
    const estimated = 96;
    const below = window.innerHeight - r.bottom;
    setPos({
      top: below < estimated + margin ? Math.max(margin, r.top - 6 - estimated) : r.bottom + 6,
      left: Math.min(Math.max(margin, r.left - 8), window.innerWidth - width - margin),
      width,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPinned(false); setOpen(false); } };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setPinned(false);
      setOpen(false);
    };
    const onMove = () => place();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef} type="button" data-info-hint
        aria-label={label ?? text} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (pinned) { setPinned(false); setOpen(false); } else { setPinned(true); setOpen(true); }
        }}
        // Hover is a convenience on a mouse, never the only way in.
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={(e) => {
          if (pinned) return;
          const to = e.relatedTarget as Node | null;
          if (to && popRef.current?.contains(to)) return;
          setOpen(false);
        }}
        className={cn("inline-flex shrink-0 items-center text-faint transition-colors hover:text-accent", className)}>
        <HelpCircle size={13} aria-hidden />
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef} id={id} role="tooltip" data-info-hint-panel
          onMouseLeave={() => { if (!pinned) setOpen(false); }}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="workspace overlay animate-pop z-[85] rounded-xl px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
