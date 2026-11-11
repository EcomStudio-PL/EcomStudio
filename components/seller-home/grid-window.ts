/**
 * /home's PHOTO GRIDS, MEASURED FROM WHAT IS SHOWN — pure, so the tests hold it.
 *
 * A grid's window used to be sized for the tiles the config lists (20
 * Miniaturki: three rows on a phone, four on a desktop). With tiles hidden in
 * „Edytuj stronę” (or their tool switched off) that left empty rows, a fade on
 * nothing and a gap above the button. Every number below is taken from the
 * tiles THIS viewer gets — the layout already left the hidden ones out.
 */

/** The square grid at each breakpoint: columns, and the most rows the window shows. */
export const SQUARE_BREAKPOINTS = [
  { cols: 2, max: 3 }, // phone
  { cols: 3, max: 3 }, // sm
  { cols: 5, max: 4 }, // lg
] as const;

/** Rows the window shows for `n` tiles: as many as there are, never more than `max`. */
export const squareRows = (n: number, cols: number, max: number): number => (n <= 0 ? 0 : Math.min(max, Math.ceil(n / cols)));

/**
 * The fade over the LAST shown row — where that row starts, then down to
 * nothing at the bottom. One row (or none): no fade, the tiles are whole.
 * 3 rows and 4 rows give exactly the stops the page always had
 * (67/76/88/99 %, 75/82/91/99 %).
 */
export function fadeMask(rows: number): string {
  if (rows < 2) return "none";
  const s = Math.round(((rows - 1) / rows) * 100);
  const m1 = Math.round(s + (99 - s) * 0.28);
  const m2 = Math.round(s + (99 - s) * 0.66);
  return `linear-gradient(to bottom,black ${s}%,rgb(0 0 0/0.8) ${m1}%,rgb(0 0 0/0.4) ${m2}%,transparent 99%)`;
}

/** A masonry window: width:height of the most it shows at a breakpoint. */
export type WindowRatio = readonly [w: number, h: number];

/**
 * Whether masonry content of these tiles (each its own width:height) is
 * taller than a `ratio` window at `cols` columns — the server's first guess
 * (the browser then measures, components/seller-home/fade-window.tsx).
 * Columns balance, so the content is about sum(h/w) / cols² of the width.
 */
export function masonryCut(tiles: readonly { width: number; height: number }[], cols: number, ratio: WindowRatio): boolean {
  if (tiles.length === 0) return false;
  const content = tiles.reduce((sum, x) => sum + (x.width > 0 ? x.height / x.width : 1), 0) / (cols * cols);
  return content > ratio[1] / ratio[0];
}
