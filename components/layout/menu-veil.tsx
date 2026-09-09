"use client";
import { createPortal } from "react-dom";

/**
 * THE FOCUS VEIL — one veil for every menu that opens out of the top bar.
 *
 * While a top-bar menu is open the page behind it dims and blurs, the same
 * idea the drawer, the modal and the command palette already use, at a lighter
 * dose: `blur(6px)` and the shared `--scrim` token at just over half its modal
 * strength. The panel stays completely sharp; the bar stays readable.
 *
 * WHY z-30, AND WHY A PORTAL
 * The bar is `sticky z-40`. Painting the veil at `z-30` on the body puts it
 * under the header and over the page, which is exactly the picture we want:
 * the header remains legible, everything below it softens, and the panel —
 * `z-50` inside the header's own stacking context — is never touched. A veil
 * rendered inline inside the header would instead have to out-paint its own
 * siblings, and would blur nothing at all on a page whose content sits in a
 * separate stacking context.
 *
 * WHY IT MUST BE A SIBLING OF THE HOVER ZONE
 * A React portal keeps its parentage in the React tree wherever the DOM node
 * lands, so a veil rendered INSIDE an element that carries `onMouseEnter` /
 * `onMouseLeave` makes the whole viewport part of that hover zone: the pointer
 * can never leave, and a hover-opened menu never closes on its own. Every
 * caller renders `<MenuVeil>` beside its hover zone, never within it.
 *
 * Closing needs nothing here. Each menu already closes on an outside
 * mousedown, and the veil is outside the menu — so a click on it counts.
 */
export function MenuVeil({ open }: { open: boolean }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div aria-hidden
      className="animate-fade fixed inset-0 z-30 bg-[rgb(var(--scrim)/calc(var(--scrim-alpha)*0.55))] backdrop-blur-[6px]" />,
    document.body,
  );
}
