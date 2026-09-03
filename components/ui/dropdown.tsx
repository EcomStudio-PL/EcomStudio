"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE ONE DROPDOWN.
 *
 * Format, resolution, quality and engine are four different lists but one
 * control: same trigger, same panel, same border, radius, shadow, spacing,
 * hover, selected state, check, animation and stacking. A native <select>
 * cannot be any of that — it paints the operating system's own white menu
 * over a dark premium panel — so the list is ours, and every picker in the
 * generator comes through here rather than growing its own.
 *
 * The panel is PORTALLED and positioned against the viewport, because the
 * generator's left column is a scroll container with `overflow: hidden` on
 * desktop: an in-flow menu would be clipped by the very panel it belongs to.
 * It flips above the trigger when there is no room below, never leaves the
 * viewport sideways, and follows the trigger while scrolling.
 *
 * Below `sm` it is a bottom sheet instead: a 240px list floating next to a
 * 44px control is a phone anti-pattern, and the thumb is at the bottom.
 */

export type DropdownOption<T extends string> = {
  value: T;
  /** Main line — what the customer is choosing. */
  label: string;
  /** Right-hand technical value (e.g. "1:1", "4 kr."). */
  meta?: string;
  /** Second line under the label, used sparingly. */
  sub?: string;
  /** Leading visual (ratio glyph, engine tile, sparkle). */
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Small note after the label, e.g. "≈" for a nearest-fit format. */
  note?: string;
};

export function Dropdown<T extends string>({
  label, value, options, onChange, ariaLabel, className, triggerClassName,
  renderValue, panelWidth = 260, testId,
}: {
  /** Small caption above the trigger; omit for a bare control. */
  label?: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
  /** Custom trigger content; defaults to the selected option's own row. */
  renderValue?: (option: DropdownOption<T> | undefined) => React.ReactNode;
  panelWidth?: number;
  testId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; drop: "down" | "up" } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** Anchor the panel to the trigger, inside the viewport, above or below. */
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(Math.max(panelWidth, r.width), window.innerWidth - margin * 2);
    const estimated = Math.min(options.length * 44 + 12, 320);
    const below = window.innerHeight - r.bottom;
    const drop: "down" | "up" = below < estimated + margin && r.top > below ? "up" : "down";
    setPos({
      top: drop === "down" ? r.bottom + 6 : Math.max(margin, r.top - 6 - estimated),
      left: Math.min(Math.max(margin, r.left), window.innerWidth - width - margin),
      width,
      drop,
    });
  }, [options.length, panelWidth]);

  useLayoutEffect(() => { if (open && !mobile) place(); }, [open, mobile, place]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => {
          const step = e.key === "ArrowDown" ? 1 : -1;
          for (let n = 1; n <= options.length; n++) {
            const next = (i + step * n + options.length * n) % options.length;
            if (!options[next]?.disabled) return next;
          }
          return i;
        });
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const opt = options[active];
        if (opt && !opt.disabled) { e.preventDefault(); onChange(opt.value); setOpen(false); triggerRef.current?.focus(); }
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Reposition rather than close: the column scrolls under the panel, and
    // a menu that vanishes on the smallest wheel nudge is unusable.
    const onScroll = () => { if (!mobile) place(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, options, active, value, onChange, place, mobile]);

  // The phone sheet covers the page; the page behind it must not scroll.
  useEffect(() => {
    if (!open || !mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, mobile]);

  const rows = (
    <div role="listbox" aria-label={ariaLabel ?? label} id={listId}
      className="thin-scroll max-h-[min(320px,60dvh)] overflow-y-auto overscroll-contain p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} type="button" role="option" aria-selected={on} disabled={o.disabled}
            data-dropdown-option={o.value}
            onMouseEnter={() => setActive(i)}
            onClick={() => { if (o.disabled) return; onChange(o.value); setOpen(false); triggerRef.current?.focus(); }}
            className={cn(
              // 44px rows on the phone sheet — a thumb, not a mouse pointer,
              // is picking here; the desktop panel keeps its compact rhythm.
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150",
              "min-h-[44px] sm:min-h-0",
              o.disabled ? "cursor-not-allowed opacity-40" : "hover:bg-raised",
              !o.disabled && i === active && "bg-raised",
              on && "bg-accent-soft/45",
            )}>
            {o.icon && <span className={cn("flex w-6 shrink-0 items-center justify-center", on ? "text-accent" : "text-muted")}>{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className={cn("flex items-baseline gap-1.5 truncate text-[13px] font-semibold", on ? "text-ink" : "text-ink/90")}>
                {o.label}
                {o.note && <span className="shrink-0 text-[10.5px] font-medium text-faint">{o.note}</span>}
              </span>
              {o.sub && <span className="mt-0.5 block truncate text-[11px] leading-snug text-faint">{o.sub}</span>}
            </span>
            {o.meta && <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-faint">{o.meta}</span>}
            <span className="w-3.5 shrink-0">
              {on && <Check size={13} strokeWidth={3} aria-hidden className="text-accent" />}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={cn("min-w-0", className)}>
      {label && <span className="mb-0.5 block text-[10.5px] font-semibold text-faint">{label}</span>}
      <button
        ref={triggerRef} type="button" data-dropdown-trigger={testId}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg py-1 text-left transition-colors duration-150",
          "text-[13px] font-semibold text-ink hover:text-ink",
          triggerClassName,
        )}>
        <span className="min-w-0 flex-1">
          {renderValue ? renderValue(selected) : <span className="block truncate">{selected?.label ?? "—"}</span>}
        </span>
        <ChevronDown size={13} aria-hidden
          className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && !mobile && pos && createPortal(
        <div ref={panelRef} data-dropdown-panel
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="workspace overlay animate-pop z-[80] rounded-xl">
          {rows}
        </div>,
        document.body,
      )}

      {open && mobile && createPortal(
        <div className="workspace fixed inset-0 z-[80] flex items-end" role="dialog" aria-modal="true"
          aria-label={ariaLabel ?? label} data-dropdown-sheet>
          <button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)}
            className="scrim absolute inset-0 cursor-default backdrop-blur-[3px]" />
          <div ref={panelRef}
            className="overlay animate-sheet relative w-full rounded-t-2xl pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-[rgb(var(--ink)/0.18)]" />
            {label && <p className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</p>}
            {rows}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * The shape of a format, drawn to scale. A picker that prints "9:16" asks
 * the customer to do the arithmetic; a tall rectangle does not. Every glyph
 * is normalised to the same box so the row heights stay even.
 */
export function RatioGlyph({ w, h, size = 15, className }: {
  w: number; h: number; size?: number; className?: string;
}) {
  const scale = size / Math.max(w, h);
  return (
    <span aria-hidden className={cn("inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}>
      <span className="block rounded-[2px] border-[1.5px] border-current"
        style={{ width: Math.max(4, Math.round(w * scale)), height: Math.max(4, Math.round(h * scale)) }} />
    </span>
  );
}
