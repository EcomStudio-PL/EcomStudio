"use client";
import { useEffect } from "react";

/**
 * THE SOFTWARE KEYBOARD, MADE VISIBLE TO THE LAYOUT.
 *
 * Why this exists — measured, not guessed: the auth shell is exactly one
 * viewport tall and centres its card. In a browser tab that is fine; the URL
 * bar collapses and the page can scroll. In an INSTALLED PWA (iOS WebKit in
 * particular) the layout viewport does NOT shrink when the keyboard opens —
 * only the visual viewport does. The document is then the same height as the
 * window, so there is nothing to scroll, and the field the customer just
 * tapped sits behind the keyboard: it looks exactly like "I can't type into
 * the login form".
 *
 * The fix is to tell the layout how much of the screen the keyboard covers.
 * `--kb` becomes the shell's bottom padding, which makes the document taller
 * than the visible area — so the page can scroll — and the focused field is
 * then brought into view. Nothing here blurs, intercepts or preventDefaults
 * anything: it only measures and scrolls.
 */
export function KeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      // What the keyboard (or any other overlay chrome) hides at the bottom.
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", `${Math.round(hidden)}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);

    /**
     * The field the customer is typing in stays on screen — centred in what
     * is actually VISIBLE, which is not what `scrollIntoView({block:"center"})`
     * does: that centres against the layout viewport, and with a keyboard
     * covering the lower half it parks the field neatly behind it. So the
     * target is computed against `window.innerHeight - keyboard` instead.
     *
     * `focusin` bubbles, so one listener covers every field on every auth
     * page, including ones reached with the keyboard's own "next" button.
     */
    const centre = (el: HTMLElement) => {
      const kb = parseFloat(getComputedStyle(root).getPropertyValue("--kb")) || 0;
      const visible = window.innerHeight - kb;
      const r = el.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= visible) return; // already comfortable
      const target = r.top + window.scrollY - Math.max(0, (visible - r.height) / 2);
      window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      // After the keyboard animation, not during it — a scroll issued mid
      // animation lands on the pre-keyboard geometry and undoes itself.
      window.setTimeout(() => {
        if (document.activeElement === el) centre(el);
      }, 300);
    };
    document.addEventListener("focusin", onFocus);

    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.removeEventListener("focusin", onFocus);
      root.style.removeProperty("--kb");
    };
  }, []);

  return null;
}
