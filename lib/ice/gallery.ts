import { canonicalJson } from "@/lib/cms";
import { GALLERY_MAX_ITEMS, type GalleryItem } from "@/lib/launch/gallery";
import { groupPairs, type BulkFile, type BulkProblem, type BulkUnit } from "./pairs";

/**
 * THE LAUNCH PAGE'S GALLERIES IN THE VISUAL EDITOR — the pure part.
 *
 * What a gallery panel and the server both need to agree on, kept free of
 * React, of the DOM and of the database so the unit tests hold it directly
 * (scripts/launch-gallery-tests.ts):
 *
 *   · when two states of a gallery are "the same" (the history lists each
 *     distinct state once, newest first — every inline text save writes a
 *     whole-page version, and twenty identical copies of a gallery are not a
 *     history);
 *   · how a pair moves when it is dragged or nudged with ↑ / ↓;
 *   · which dropped files become pairs, and why the others do not.
 */

/* ── identity ─────────────────────────────────────────────────────────── */

/**
 * The text a gallery state is identified by: its section switch and its
 * pairs, key order normalised (jsonb hands objects back in its own order).
 * The server hashes it (sha256) into the version's `fingerprint`.
 */
export function galleryIdentity(visible: boolean, items: readonly GalleryItem[]): string {
  return canonicalJson({ visible, items });
}

/**
 * Each distinct gallery state once — the NEWEST occurrence of it kept, the
 * input order (newest first) preserved — and at most `max` of them.
 */
export function dedupeVersions<V extends { fingerprint: string }>(newestFirst: readonly V[], max = 20): V[] {
  const seen = new Set<string>();
  const out: V[] = [];
  for (const v of newestFirst) {
    if (seen.has(v.fingerprint)) continue;
    seen.add(v.fingerprint);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/* ── order ────────────────────────────────────────────────────────────── */

/**
 * Drag the item at `from` and drop it on the item at `to`: it takes that
 * place, everything between shifts by one (the builder's section list does
 * the same). Out-of-range or no-op moves return an unchanged copy, so a
 * stale drag (the list changed under it) can never lose or duplicate a pair.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** ↑ / ↓ — the same move, one place, for a keyboard or a touch screen. */
export function moveBy<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  return moveItem(list, index, index + delta);
}

/* ── many files at once ───────────────────────────────────────────────── */

/** The picture formats a gallery takes from a drop: JPEG, PNG and WebP. */
export const GALLERY_BULK_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
/** For the file input: extensions too, so the picker greys out the rest. */
export const GALLERY_BULK_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export type GalleryBulkFile = BulkFile & { type: string };

export type GalleryBulkPlan<F extends GalleryBulkFile> = {
  /** Complete pairs that fit, in natural order of their names. */
  pairs: BulkUnit<F>[];
  /** Files that could not be paired (no suffix, a half missing, two of a half). */
  problems: BulkProblem<F>[];
  /** Files of a format a gallery does not take. */
  rejected: F[];
  /** Complete pairs past the gallery's limit — reported, never added. */
  overflow: BulkUnit<F>[];
};

/**
 * Dropped files → the pairs a gallery would gain. `room` is how many pairs
 * still fit (GALLERY_MAX_ITEMS minus what the gallery holds). Nothing is
 * guessed: a lone "-przed" stays out and is reported, exactly like the /home
 * bulk upload does it.
 */
export function planGalleryBulk<F extends GalleryBulkFile>(files: readonly F[], room: number): GalleryBulkPlan<F> {
  const rejected = files.filter((f) => !GALLERY_BULK_MIMES.includes(f.type));
  const usable = files.filter((f) => GALLERY_BULK_MIMES.includes(f.type));
  const { pairs, problems } = groupPairs(usable);
  const fits = Math.max(0, Math.min(Math.floor(room), GALLERY_MAX_ITEMS));
  return { pairs: pairs.slice(0, fits), problems, rejected, overflow: pairs.slice(fits) };
}
