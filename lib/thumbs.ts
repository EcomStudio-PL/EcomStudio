/**
 * IMAGE DERIVATIVES — one definition of what each surface downloads.
 *
 * Three sizes, three jobs, and the customer's file is none of them:
 *
 *   GRID (`_t.webp`, 640px, q72)  — a tile is at most ~320 CSS px across at the
 *     widest density setting, so 640 covers it at 2× device pixels and costs
 *     roughly 40–70KB against the 2–6MB of a full render. That ratio — two
 *     orders of magnitude — is the whole performance story of the library;
 *     pagination, lazy loading and caching are arithmetic on top of it.
 *
 *   PREVIEW (`_p.webp`, 1400px, q82) — what the lightbox opens. Big enough to
 *     look right full-screen on a 2× laptop, ~200–400KB instead of the
 *     original's megabytes. One image at a time, but it is the image the
 *     customer actually stops to look at.
 *
 *   ORIGINAL — untouched. It is what a download hands over.
 *
 * THE DERIVATIVES ARE NEVER THE PRODUCT. Quality 72 and 82 apply to the copies
 * the UI paints; the file the customer paid for is never re-encoded, never
 * resized and never replaced. Making the library faster must not cost anyone a
 * single pixel of what they generated.
 *
 * PATHS ARE DERIVED, NOT STORED-AND-HOPED. `<dir>/<n>.png` becomes
 * `<dir>/<n>_t.webp` and `<dir>/<n>_p.webp`, so the backfill and the generator
 * agree on where a derivative lives without either reading the other's mind,
 * and a re-run overwrites rather than littering a second copy.
 */

/** Longest edge of a grid thumbnail, in pixels. */
export const THUMB_EDGE = 640;

/** WebP quality for thumbnails. Visually clean at tile scale. */
export const THUMB_QUALITY = 72;

/** Longest edge of the lightbox preview, in pixels. */
export const PREVIEW_EDGE = 1400;

/** WebP quality for previews — higher, because this one is looked at. */
export const PREVIEW_QUALITY = 82;

/** `<dir>/<n>.png` → `<dir>/<n><suffix>`, total on paths without an extension. */
function derive(storagePath: string, suffix: string): string {
  const cut = storagePath.lastIndexOf(".");
  const stem = cut > storagePath.lastIndexOf("/") ? storagePath.slice(0, cut) : storagePath;
  return `${stem}${suffix}`;
}

/** Where the grid thumbnail of `storagePath` lives. */
export function thumbPathFor(storagePath: string): string {
  return derive(storagePath, "_t.webp");
}

/** Where the lightbox preview of `storagePath` lives. */
export function previewPathFor(storagePath: string): string {
  return derive(storagePath, "_p.webp");
}
