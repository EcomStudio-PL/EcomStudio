import { trackEvent } from "@/components/analytics/google-analytics";
import type { EventParams, PrelaunchEvent } from "@/lib/analytics/ga";

/**
 * THE LANDING PAGE'S FUNNEL EVENTS — and when they are NOT sent.
 *
 * Every event goes through trackEvent (components/analytics/google-analytics.tsx),
 * the app's one GA integration point. On top of that, the landing page stays
 * silent in two situations that are not visitors:
 *
 *  - FRAMED. The builder's device preview and the visual editor's "Podgląd PC /
 *    Telefon" render "/" in an iframe. An admin checking a layout is not a
 *    page view, a form start or a gallery interaction.
 *  - ?preview. The admin draft preview (`/?preview=waitlist&draft=1`), framed
 *    or not.
 *
 * A browser that refuses to answer whether it is framed counts as framed: the
 * cost of a missed event is nothing, the cost of a fake one is a wrong funnel.
 */

export function launchAnalyticsMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }
  try {
    return new URLSearchParams(window.location.search).has("preview");
  } catch {
    return true;
  }
}

export function launchTrack(name: PrelaunchEvent, params?: EventParams): void {
  if (launchAnalyticsMuted()) return;
  trackEvent(name, params);
}

/** Reduced motion asked for: jumps instead of glides. */
export function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/**
 * Bring a signup form into view — the gallery and sticky calls to action.
 * A smooth glide unless the visitor asked for reduced motion, then the
 * e-mail field takes focus WITHOUT a second scroll, so a keyboard or screen
 * reader user lands where the eye does.
 */
export function goToForm(id: string = "zapis"): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  const field = target.querySelector<HTMLInputElement>("input[type=email]");
  field?.focus({ preventScroll: true });
}
