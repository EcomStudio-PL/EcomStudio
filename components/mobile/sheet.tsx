"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * BOTTOM SHEET — the phone's answer to a dropdown.
 *
 * Settings used to expand INLINE above the toolbar, which grew the page and
 * pushed the form around. A sheet floats over the page instead: the content
 * behind it never moves, the sheet scrolls inside its own box, and it closes
 * on the X, on the backdrop and on Escape. Body scroll is locked while it is
 * open and restored when it closes, so the page behind cannot drift.
 */
export function BottomSheet({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="scrim animate-fade absolute inset-0 backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={panelRef}
        className={cn(
          "overlay animate-sheet relative flex w-full flex-col rounded-t-3xl sm:max-w-lg sm:rounded-2xl",
          "sheet",
        )}
      >
        {/* Grab handle: the affordance that says "this came from the bottom". */}
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[rgb(var(--ink)/0.18)] sm:hidden" />
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-3">
          <p className="overline">{title}</p>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
            className="-mr-1 flex h-10 w-10 items-center justify-center rounded-xl text-faint transition-colors duration-200 hover:bg-raised hover:text-ink">
            <X size={17} aria-hidden />
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
