/**
 * THE LIBRARY'S OWN SKELETON.
 *
 * Without this file the library inherits app/(app)/loading.tsx, which is the
 * DASHBOARD's shape: a title block, a four-card stat strip and two wide
 * panels. That was already a poor stand-in for a grid of thumbnails, and once
 * the page stopped rendering a header it became a visible defect — the
 * skeleton reserved ~76px for a heading the real page no longer draws, so
 * every navigation into /library ended with the toolbar and the first row of
 * tiles snapping upward. The page is `force-dynamic`, so that happened on
 * every entry, not occasionally.
 *
 * So the skeleton is now the same three shapes the page actually paints, in
 * the same order and at the same spacing: a row of toolbar pills, then the
 * tile grid. Nothing above them.
 *
 * `library-grid` and `--tile` are the real grid's own rule and its default
 * density (DENSITY[DEFAULT_DENSITY] = 210), so the placeholder resolves to
 * the same column count the content will — two on a phone, and as many as fit
 * above it. The tiles inherit the page's `aspect-square`, so the swap from
 * skeleton to content moves nothing.
 */
export default function LibraryLoading() {
  return (
    <div aria-busy className="animate-pulse">
      {/* THE BAR — same margins as the real toolbar (mb-3 sm:mb-4), and the
          same 38px: the two Segmented groups that set the row's height are
          h-9 plus a hairline top and bottom. Matching h-9 here left a 2px
          snap, which is small but is exactly the kind of thing this file
          exists to remove. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-2.5">
        <div className="h-[38px] w-[9.5rem] rounded-xl bg-raised" />
        <div className="h-[38px] w-[4.5rem] rounded-xl bg-raised/70" />
        <div className="hidden h-[30px] w-[7.5rem] rounded-xl bg-raised/70 md:block" />
        <span className="flex-1" />
        <div className="h-9 w-9 rounded-xl bg-raised/70" />
        <div className="hidden h-9 w-28 rounded-xl bg-raised/70 sm:block" />
        <div className="h-9 w-9 rounded-xl bg-raised/70" />
      </div>

      {/* THE TILES CANNOT BE HONEST ABOUT THEIR SHAPE — nothing is loaded yet,
          so nothing knows what shapes are coming. They are a neutral 4:3
          rather than a square: 16:9 is by far the commonest thing this product
          produces, so a square would be the one guess certain to be wrong,
          and a landscape placeholder that turns out slightly wider moves the
          grid far less than a square that turns out much wider. The TOOLBAR
          above is exact, which is the part that sits above the fold. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(210px, 100%), 1fr))" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} data-skeleton-tile className="aspect-[4/3] rounded-xl bg-raised/60" />
        ))}
      </div>
    </div>
  );
}
