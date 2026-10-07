"use client";
import { useEffect, type RefObject } from "react";

/**
 * Focus for the /home dialogs (the shared Modal is left as it is): on open,
 * focus moves to the first control inside `ref`; on close it returns to
 * whatever had it before — the button that opened the dialog, typically.
 */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = window.requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>("a[href], button:not([disabled])")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
