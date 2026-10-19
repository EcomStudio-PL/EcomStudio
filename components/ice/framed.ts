"use client";
import { useSyncExternalStore } from "react";

/**
 * IS THIS PAGE INSIDE A FRAME?
 *
 * The visual editor's edit cookie for "/" is Path=/, so the browser sends it
 * with every same-site request — including the builder's device preview and
 * the gallery panel's "Podgląd PC / Telefon", both iframes of the same site.
 * A preview must show the page as a visitor sees it, so the launcher and the
 * editor render nothing in a frame.
 *
 * The server cannot know (a request does not say it is framed), so the server
 * answer is "framed": nothing is rendered there, and the browser decides after
 * hydration — no mismatch, no flash of an editor inside a preview. Comparing
 * window.top with window.self is allowed even across origins; anything that
 * throws counts as framed.
 */
const subscribe = () => () => {};

function framedNow(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

export function useFramed(): boolean {
  return useSyncExternalStore(subscribe, framedNow, () => true);
}
