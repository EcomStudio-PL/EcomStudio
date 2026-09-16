"use client";
import type { GalleryItem } from "@/lib/server/gallery";

/**
 * WHAT THE LIBRARY ALREADY KNOWS — a cache that survives leaving the page.
 *
 * The library used to be a server component that re-queried, re-signed and
 * re-rendered its whole collection on every visit. Going to a tool and coming
 * back meant waiting for the same rows and the same pictures again, with a
 * blank page in between. What the customer expects is the shelf they left.
 *
 * So the pages a session has already fetched live here, in the module, keyed
 * by the filter that produced them. Returning to the library paints from this
 * instantly, and the first page is re-fetched in the background: stale first,
 * fresh a moment later, no spinner in between. It also remembers the scroll
 * offset, because a grid you have paged through four times is not the same
 * place after it jumps back to the top.
 *
 * IT EXPIRES ON PURPOSE. The URLs in it are signed for an hour, so an entry
 * older than `MAX_AGE_MS` is not stale — it is broken — and is discarded
 * rather than shown. That is the one thing a cache here must never get wrong:
 * a picture that 403s is worse than a picture that takes a moment.
 *
 * Module scope, not `sessionStorage`: this is one tab's working set, it holds
 * signed URLs that have no business being written to disk, and a full reload
 * SHOULD start clean — the server renders the first page into the HTML
 * anyway, so a reload is fast without any of this.
 */

export type LibrarySnapshot = {
  items: GalleryItem[];
  cursor: string | null;
  /** Where the page was scrolled to when the customer left. */
  scrollY: number;
  /** When the signed URLs in `items` were minted. */
  stamp: number;
};

/** Signed URLs live an hour; stop trusting them well before that. */
const MAX_AGE_MS = 45 * 60 * 1000;

const store = new Map<string, LibrarySnapshot>();

/** The identity of a view: two different filters are two different shelves. */
export function libraryKey(parts: Record<string, string | boolean | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k}=${v === true ? "1" : v}`)
    .sort()
    .join("&") || "default";
}

export function readLibrary(key: string): LibrarySnapshot | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.stamp > MAX_AGE_MS) { store.delete(key); return null; }
  return hit;
}

export function writeLibrary(key: string, snap: Omit<LibrarySnapshot, "stamp"> & { stamp?: number }): void {
  store.set(key, { ...snap, stamp: snap.stamp ?? Date.now() });
}

/** Update every cached view in place — used by favourite and delete, which
 *  change one item without invalidating a single page of anything. */
export function patchLibrary(fn: (items: GalleryItem[]) => GalleryItem[]): void {
  for (const [key, snap] of store) store.set(key, { ...snap, items: fn(snap.items) });
}

export function dropLibrary(): void {
  store.clear();
}
