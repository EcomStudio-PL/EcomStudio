"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/components/seller-home/dialog-focus";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * THE FRAME both trial dialogs sit in.
 *
 * It opens OVER the image view, which is what makes it different from the
 * shared Modal:
 *   · rendered at <body> at z-[75] — the lightbox and the regenerate editor
 *     are z-[60], the shared Modal z-50, so anything lower would open behind
 *     the picture it is about;
 *   · Escape is taken in the CAPTURE phase and stopped there. The lightbox
 *     listens on `window` too and closes on any Escape; without this, closing
 *     the paywall would throw the customer out of their image as well. The
 *     arrows are held back for the same reason — they page the lightbox;
 *   · the page's previous `overflow` is restored on close, not reset to "":
 *     the lightbox underneath locked it first and still needs it locked.
 * Focus moves in on open, stays inside on Tab, and returns to the button that
 * opened it (useDialogFocus).
 */
export function TrialDialogShell({ label, onClose, locked = false, focusKey, wide = false, children }: {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** True while something must finish (an unlock in flight): no close. */
  locked?: boolean;
  /** Changes when the content is swapped, so focus is put back inside. */
  focusKey?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(true, panel);

  // The newest state of the two props the key handler needs, without
  // re-binding the listener on every render.
  const live = useRef({ onClose, locked });
  live.current = { onClose, locked };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.stopPropagation();
      if (e.key === "Escape" && !live.current.locked) live.current.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previous;
    };
  }, []);

  // A swapped step can remove the control that had focus; bring it back in.
  useEffect(() => {
    const el = panel.current;
    if (!el || el.contains(document.activeElement)) return;
    const raf = window.requestAnimationFrame(() => el.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(raf);
  }, [focusKey]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end justify-center sm:items-center sm:p-4" data-trial-dialog>
      <div aria-hidden onClick={() => !locked && onClose()}
        className="scrim animate-fade absolute inset-0 backdrop-blur-[3px]" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          "overlay thin-scroll animate-sheet relative flex w-full flex-col overflow-y-auto overscroll-contain",
          "max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] rounded-t-3xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4",
          "sm:max-h-[min(92dvh,820px)] sm:rounded-2xl sm:px-6 sm:pb-6 sm:pt-5",
          wide ? "sm:max-w-[760px]" : "sm:max-w-md",
        )}>
        <span aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-[rgb(var(--ink)/0.18)] sm:hidden" />
        <button type="button" onClick={onClose} disabled={locked} aria-label={t("common.close")}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 sm:right-4 sm:top-4">
          <X size={16} aria-hidden />
        </button>
        <div className="min-w-0">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
