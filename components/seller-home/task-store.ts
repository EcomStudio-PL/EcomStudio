"use client";
import { useSyncExternalStore } from "react";
import type { HeroTaskKey } from "@/lib/seller-home-config";

/**
 * Which hero task is selected — shared by the hero (the radio cards, the
 * credits line, the "Generuj" button) and the gallery's "Zrób to samo",
 * which live in different sections of the page. A tiny module store rather
 * than a context so the server-rendered sections between them stay server
 * components. `null` = nothing chosen yet → the page's default applies.
 */

let selected: HeroTaskKey | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setSelectedTask(key: HeroTaskKey): void {
  if (selected === key) return;
  selected = key;
  listeners.forEach((fn) => fn());
}

export function useSelectedTask(fallback: HeroTaskKey | null): HeroTaskKey | null {
  const value = useSyncExternalStore(subscribe, () => selected, () => null);
  return value ?? fallback;
}

/** The hero's id and its upload's id — "Zrób to samo" goes to both. */
export const HERO_ID = "seller-hero";
export const UPLOAD_ID = "seller-upload";

/**
 * "Zrób to samo": select the task, bring the hero into view, then put focus
 * on the upload so the next key press (or tap) adds the photo. Smooth only
 * when the seller has not asked for reduced motion — the global CSS cannot
 * reach a scroll started from script.
 */
export function chooseTaskAndFocusUpload(key: HeroTaskKey): void {
  setSelectedTask(key);
  const hero = document.getElementById(HERO_ID);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  hero?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const upload = document.getElementById(UPLOAD_ID);
  window.setTimeout(() => upload?.focus({ preventScroll: true }), reduce ? 0 : 420);
}
