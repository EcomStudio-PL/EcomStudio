"use client";

/**
 * A GALLERY OF MIXED SHAPES, PACKED, IN PURE CSS.
 *
 * The problem: put a 16:9 and a 9:16 in the same row of an equal-column grid
 * and the row is as tall as the tall one, leaving a hole under the wide one.
 *
 * THE FIRST ATTEMPT WAS CSS GRID WITH ROW SPANS, and it packed perfectly — but
 * a span is a pixel count, a pixel count needs the column's width, and a
 * column's width needs a measurement. The server has no measurement, so it
 * rendered one layout and the hydrated client rendered another: a cumulative
 * layout shift of 0.39 against a budget of 0.1, measured rather than guessed.
 * Reserving the right box for every picture and then moving every box on
 * hydration is not an improvement; it is the same defect one frame later.
 *
 * SO THERE IS NO MEASUREMENT. This is the justified layout every photo tool
 * uses, expressed in flexbox:
 *
 *   · each tile's `flex-basis` is `aspect × row`, so a wide tile asks for
 *     proportionally more of the row than a tall one;
 *   · each tile's `flex-grow` is its `aspect` as well, so when a row's free
 *     space is shared out, every tile in that row grows by the same FACTOR;
 *   · which means every tile in a row ends at the same HEIGHT, at its own
 *     width, with its own ratio intact.
 *
 * Rows come out exactly full, gutters stay equal, tiles keep document order
 * (newest first, left to right), and — because nothing is measured — the
 * server's HTML and the client's first paint are the same layout. No
 * ResizeObserver, no scroll work, no dependency, and no shift.
 *
 * `row` is what the density control sets: the nominal height of a row of
 * tiles. Larger means fewer, bigger tiles per row, and changes no tile's
 * shape — which is exactly what the brief asks a density control to do.
 */

export type RatioGrid = {
  /** Put this on the gallery element. */
  style: React.CSSProperties;
  /** The style for one tile, given its aspect ratio (width ÷ height). */
  itemStyle: (aspect: number) => React.CSSProperties;
};

export function useRatioGrid({ row, gap }: {
  /** Nominal row height in px — what the density slider sets. */
  row: number;
  /** The gutter, in px, between tiles and between rows. */
  gap: number;
}): RatioGrid {
  /**
   * THE INLINE STYLE CARRIES NUMBERS ONLY — never `display`, never the
   * wrapping. An inline style beats every stylesheet rule, so putting
   * `display: flex` here would make the phone's media query in globals.css
   * unable to switch the gallery to a two-column grid. It could not, and the
   * probe caught it: one tile per row at every phone width.
   */
  const style = {
    "--gallery-row-base": `${row}px`,
    "--gallery-gap": `${gap}px`,
  } as React.CSSProperties;

  const itemStyle = (aspect: number): React.CSSProperties => {
    const a = (aspect > 0 ? aspect : 1).toFixed(4);
    return {
      // `min(…, 100%)` so a very wide tile in a narrow gallery wraps rather
      // than overflowing.
      flexBasis: `min(calc(${a} * var(--gallery-row)), 100%)`,
      flexGrow: Number(a),
      // Never shrink below the basis: shrinking would break the "same factor,
      // same height" property that makes a row line up.
      flexShrink: 0,
      // THE LAST ROW has free space no other row has, and unchecked growth
      // would stretch a single leftover tile across the whole gallery. A
      // ceiling of 1.75 rows keeps it in the family.
      maxWidth: `calc(${a} * var(--gallery-row) * 1.75)`,
    };
  };

  return { style, itemStyle };
}
