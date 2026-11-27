import { cn } from "@/lib/utils";
import { SECTION_COPY, SHIPPED_TOOL_PHOTO, TOOL_TILE, ratioOf } from "@/lib/seller-home-config";
import type { SellerHomeData } from "@/lib/server/seller-home";
import { MediaSlot } from "./media-slot";
import { LoopRail } from "./loop-rail";
import { Rail } from "./rail";
import { StatusBadge, ToolLink } from "./parts";
import { EditFlags, flagged, toolTiles, type ToolTile } from "./home-view";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** More tools than a desktop view holds (4.5): only then is there a loop. */
const LOOP_MIN = 5;

/**
 * THE RAIL'S SHAPE FOR n TILES A CUSTOMER SEES (27.11.2026). Each breakpoint
 * keeps its carousel — 1.18 tiles on a phone, 2.5 on a tablet (sm), 4.5 on a
 * desktop (lg) — but a list that fits in one view no longer leaves the rest of
 * it empty: its tiles share the whole width equally (cols = n), with the same
 * gaps. Only whole tiles count as "fits": 1 on a phone, 2 on a tablet, 4 on a
 * desktop; one more and that breakpoint scrolls as it always did. Five or more
 * is the loop (LoopRail), unchanged.
 *
 * Literal class strings, one per count, so Tailwind sees every one of them.
 */
const RAIL_SHAPE: Record<1 | 2 | 3 | 4, string> = {
  1: "[--rail-cols:1] [--rail-gap:10px] sm:[--rail-cols:1] sm:[--rail-gap:12px] lg:[--rail-cols:1] lg:[--rail-gap:14px]",
  2: "[--rail-cols:1.18] [--rail-gap:10px] sm:[--rail-cols:2] sm:[--rail-gap:12px] lg:[--rail-cols:2] lg:[--rail-gap:14px]",
  3: "[--rail-cols:1.18] [--rail-gap:10px] sm:[--rail-cols:2.5] sm:[--rail-gap:12px] lg:[--rail-cols:3] lg:[--rail-gap:14px]",
  4: "[--rail-cols:1.18] [--rail-gap:10px] sm:[--rail-cols:2.5] sm:[--rail-gap:12px] lg:[--rail-cols:4] lg:[--rail-gap:14px]",
};
/** The carousel as it has always been (five tiles or more). */
const LOOP_SHAPE = "[--rail-cols:1.18] [--rail-gap:10px] sm:[--rail-cols:2.5] sm:[--rail-gap:12px] lg:[--rail-cols:4.5] lg:[--rail-gap:14px]";

/** How wide one tile is drawn, per breakpoint, for the browser's file choice. */
function tileSizes(n: number): string {
  const phone = n === 1 ? 100 : 84;
  const tablet = n <= 2 ? Math.round(100 / n) : 40;
  const desktop = n >= 1 && n <= 4 ? Math.round(100 / n) : 22;
  return `(max-width: 639px) ${phone}vw, (max-width: 1023px) ${tablet}vw, ${desktop}vw`;
}

/** A tile a customer would see: not switched off in the layout, its tool
 *  offered to customers. Edit mode's greyed tiles and an admin's badged
 *  tools are drawn, but they are not the customer's count. */
export const customerTile = (x: Pick<ToolTile, "flags" | "state">): boolean =>
  !x.flags.includes("item") && !x.state.customerHidden;

/**
 * 1 — THE TOOL CAROUSEL, the first thing under the header and no heading
 * above it: pictures first, so a seller sees what this place makes before
 * being told anything. Four and a half tiles on a desktop, two and a half on
 * a tablet, one and a bit on a phone; arrows, swipe, wheel and keyboard, and
 * no end either way — after the last tool comes the first (./loop-rail.tsx).
 * Too few tools to fill more than a view (under five) and it is the plain
 * Rail: nothing to go round, no copies — and when they all fit in the view
 * they fill its width (RAIL_SHAPE), with no arrows (the Rail shows them only
 * while there is something to scroll to).
 *
 * Every tile is the tool's own picture in the catalogue's 2336×1744 frame —
 * from the config, else the admin's card picture of that tool, else the
 * shipped example of a live tool, else the quiet empty slot — with its name
 * and one line under it. A live tool's whole tile opens it; any other is
 * drawn with its badge and opens nothing.
 */
export function ToolCarousel({ data, t, locale }: { data: SellerHomeData; t: T; locale: string }) {
  // The layout's tiles (lib/home-layout.ts): hidden ones and tools a customer
  // is not offered take no place at all — the loop and the rail count only
  // what is drawn.
  const tiles = toolTiles("carousel", data, t, locale, TOOL_TILE).map((tile, index) => ({ tile, index }));
  if (tiles.length === 0) return null;
  // The customer's count decides the shape; edit mode still draws every tile
  // (hidden ones greyed, after or between them) so they can be brought back.
  // (A customer is handed only their own tiles, so for them visible ===
  // tiles.length; none → no section, no gap, as before.)
  const visible = tiles.filter((x) => customerTile(x.tile)).length;
  const loop = visible >= LOOP_MIN;
  const shape = loop || visible === 0 ? LOOP_SHAPE : RAIL_SHAPE[visible as 1 | 2 | 3 | 4];
  const sizes = tileSizes(loop || visible === 0 ? LOOP_MIN : visible);
  const hint = t("sellerHome.slot.size", { w: TOOL_TILE.width, h: TOOL_TILE.height });
  const home = data.homeSlots ? { slots: data.homeSlots, locale } : null;

  // One tile; `copy` draws it again for the loop's copies — the same picture
  // and link, but out of the Tab order (and, by LoopRail, of the
  // accessibility tree), with no data-carousel-tile of its own.
  const tile = ({ tile: x, index }: { tile: ToolTile; index: number }, copy: boolean) => {
    const live = x.state.status === "live";
    const slot = data.toolSlots[x.item];
    return (
      <ToolLink key={x.id} state={x.state} ariaLabel={x.name} tabIndex={copy && live ? -1 : undefined}
        {...(copy ? { "data-carousel-clone": x.item } : { "data-carousel-tile": x.item, "data-home-item": `carousel:${x.id}` })}
        className={cn("group block min-w-0 rounded-xl outline-offset-2", flagged(x.flags))}>
        <span className={cn("relative block overflow-hidden rounded-xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]",
          live && "transition-shadow duration-300 group-hover:shadow-[0_16px_34px_-18px_rgb(var(--accent)/0.7)]")}>
          {/* The tile's own /home picture first (its slot, 27.11.2026), then
              its tool's card picture shared with /tools, the shipped example,
              the placeholder. A loop copy never fetches ahead: SlotVideo
              loads only near the viewport, <img> lazily. */}
          <MediaSlot media={x.media} ratio={ratioOf(TOOL_TILE)} tone={index}
            home={home} tile
            admin={slot ? { slot, slots: data.slots } : null}
            shipped={live ? SHIPPED_TOOL_PHOTO[x.item] ?? null : null}
            dim={!live} label={x.name} hint={hint} priority={!copy && index < 5}
            sizes={sizes}
            className={cn("rounded-xl", live && "transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100")} />
          <StatusBadge status={x.state.status} t={t} className="absolute left-2 top-2" />
          {!copy && <EditFlags flags={x.flags} t={t} />}
        </span>
        <span className="mt-2 block truncate px-0.5 text-[13px] font-semibold leading-tight text-ink">{x.name}</span>
        <span className="mt-0.5 block truncate px-0.5 text-[12px] leading-snug text-muted">{x.sub}</span>
      </ToolLink>
    );
  };
  const rail = {
    label: t(SECTION_COPY.carousel),
    prevLabel: t("sellerHome.carousel.prev"),
    nextLabel: t("sellerHome.carousel.next"),
    role: t("sellerHome.carousel.role"),
    arrowTop: "calc(50% - 1.1rem)",
    className: shape,
  };

  return (
    <section className="relative" data-seller-carousel data-carousel-visible={visible} data-carousel-mode={loop ? "loop" : "rail"}>
      {loop
        ? <LoopRail {...rail} items={tiles.map((x) => tile(x, false))} clones={tiles.map((x) => tile(x, true))} />
        : <Rail {...rail}>{tiles.map((x) => tile(x, false))}</Rail>}
    </section>
  );
}
