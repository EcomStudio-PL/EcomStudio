"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORY_PARAM } from "@/lib/categories";

/**
 * THE DEEP LINK INTO ONE SECTION OF /tools — `/tools?category=<section>`.
 *
 * THE STATE IS THE URL. Which section is open is not remembered anywhere but in
 * the query string: the server reads it and renders that section as the active
 * one (tools-catalogue.tsx), and this component only brings it into view. So
 * everything that produces the URL produces the same screen — a menu click from
 * another page, a menu click on /tools itself, a refresh, a link pasted into a
 * new tab, and Back/Forward, which put the previous URL back and with it the
 * previous section.
 *
 * NO TIMERS. The section is in the server-rendered HTML before this runs, and
 * the effect runs after React has committed the page, so the element exists by
 * construction; there is nothing to wait for and nothing to retry. It follows
 * the `category` value itself, so a change of section — from the menu or from
 * the history — scrolls, and nothing else does.
 *
 * ONE CASE THE URL CANNOT SIGNAL: the link to the section you are already on.
 * The URL does not change, so the effect has no reason to run — yet the
 * seller, scrolled halfway down, pressed "Moda" to get back to Moda. Worse,
 * the router still performs a navigation to the same address, and when it
 * lands it resets the scroll to the top of the page (measured: the reveal ran,
 * then the view jumped to 0 as the navigation completed). So a click on a link
 * to the CURRENT section is answered here instead, before the router sees it:
 * the navigation is cancelled — there is nowhere to go — and the section is
 * brought into view. The link's own onClick still runs (Next's Link calls it
 * before it checks `defaultPrevented`), so the drawer and the menu still
 * close. It reads the link's own href, not a copy of the menu, so any link to
 * a section of this page behaves the same.
 */
export function ToolsDeepLink({ sections }: {
  /** The sections this viewer can actually see. A `?category=` naming one
   *  that is hidden from them (or not a section at all) opens nothing. */
  sections: readonly string[];
}) {
  const target = useSearchParams().get(CATEGORY_PARAM);
  const known = sections.join(" ");
  // The first reveal is part of loading the page: it jumps. Later ones happen
  // on a page the seller is already looking at: they glide, unless the system
  // asks for reduced motion.
  const loaded = useRef(false);

  useEffect(() => {
    const first = !loaded.current;
    loaded.current = true;
    if (target && known.split(" ").includes(target)) reveal(target, first ? "auto" : "smooth");
  }, [target, known]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only a plain primary click navigates in this tab; the others open a
      // new one and are none of this page's business.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      const here = new URL(window.location.href);
      if (url.origin !== here.origin || url.pathname !== here.pathname) return;
      const wanted = url.searchParams.get(CATEGORY_PARAM);
      if (!wanted || wanted !== here.searchParams.get(CATEGORY_PARAM)) return;
      if (!known.split(" ").includes(wanted)) return;
      e.preventDefault();
      reveal(wanted, "smooth");
    }
    // CAPTURE phase: this must run before the Link's own handler decides to
    // navigate, which is what makes `preventDefault` stop the router.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [known]);

  return null;
}

/** Scroll the section to the top of the view (its scroll margin clears the
 *  sticky bar) and move focus to it, so a keyboard or screen-reader user lands
 *  where the eye does. */
function reveal(id: string, motion: ScrollBehavior) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : motion });
  el.focus({ preventScroll: true });
}
