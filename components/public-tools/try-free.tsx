"use client";
import { ArrowUp } from "lucide-react";

/**
 * "WYPRÓBUJ ZA DARMO" — back up to the panel, where the visitor's next step
 * is: adding a photo. The panel itself decides what Generate then does (the
 * sign-in dialog for a visitor, the waiting list while registration is shut);
 * this button only brings them to it, and puts the keyboard there too.
 */
export function TryFree({ label }: { label: string }) {
  const go = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // The panel's photo zone when it has one, else its first control.
    const target = document.querySelector<HTMLElement>("main [data-upload-zone], main button:not([disabled])");
    window.setTimeout(() => target?.focus({ preventScroll: true }), reduce ? 0 : 450);
  };
  return (
    <button type="button" onClick={go} data-tool-try-free
      className="cta inline-flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-semibold">
      <ArrowUp size={16} aria-hidden /> {label}
    </button>
  );
}
