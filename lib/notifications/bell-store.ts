"use client";
import { useSyncExternalStore } from "react";
import { loadBellAction } from "@/app/actions/notifications";
import { EMPTY_BELL, type BellPayload } from "@/lib/notifications/catalog";

/**
 * ONE copy of the bell's state for the whole page, and ONE refresh loop.
 *
 * The bell in the header, the bar under it and the "ready" toast all read
 * this store, so the page polls once — every 60 s while something is
 * listening, and again when the tab becomes visible — instead of once per
 * component. Every refresh REPLACES the state with the server's answer (rows
 * keyed by id), so nothing is ever counted twice.
 *
 * Optimistic changes (mark read, close the bar) bump a version; a refresh
 * that started before one is discarded, and the action's own answer — the
 * fresh state from the server — is what corrects the optimistic guess.
 */

const POLL_MS = 60_000;

let state: BellPayload = EMPTY_BELL;
let seeded = false;
let version = 0;
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

function onVisible() { if (document.visibilityState === "visible") void refreshBell(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    timer = setInterval(() => { if (document.visibilityState === "visible") void refreshBell(); }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** The server render's state, taken once — layouts persist across client
 *  navigation, so a later render's (stale) copy must not overwrite live data.
 *  BROWSER ONLY: on the server this module is shared by every request, so it
 *  must never hold anyone's notifications (see useBell's server snapshot). */
function seed(initial: BellPayload | undefined) {
  if (typeof window === "undefined") return;
  if (!seeded && initial) { state = initial; seeded = true; }
}

export function refreshBell(): Promise<void> {
  if (inflight) return inflight;
  const started = version;
  inflight = loadBellAction()
    .then((next) => {
      if (next && started === version) { state = next; seeded = true; emit(); }
    })
    .catch(() => { /* keep what is shown; the next tick tries again */ })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Change what is shown now; `confirm` is the server's answer to the same act. */
export function applyBell(change: (s: BellPayload) => BellPayload, confirm?: Promise<BellPayload | null>) {
  version += 1;
  const mine = version;
  const before = state;
  state = change(state);
  emit();
  confirm?.then((next) => {
    if (mine !== version) return;
    if (next) state = next; else state = before;
    emit();
  }).catch(() => {
    if (mine === version) { state = before; emit(); }
  });
}

export function useBell(initial?: BellPayload): BellPayload {
  seed(initial);
  // The server snapshot is THIS request's own copy, or nothing — never the
  // module's state, which on the server would be another visitor's.
  return useSyncExternalStore(subscribe, () => state, () => initial ?? EMPTY_BELL);
}

/** Whether the server's copy has arrived (or been fetched) yet. */
export function bellSeeded(): boolean {
  return seeded;
}
