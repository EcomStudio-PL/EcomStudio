import { cn } from "@/lib/utils";
import { CAROUSEL, SECTION_COPY, SHIPPED_TOOL_PHOTO, TOOL_TILE, ratioOf } from "@/lib/seller-home-config";
import type { SellerHomeData } from "@/lib/server/seller-home";
import { MediaSlot } from "./media-slot";
import { Rail } from "./rail";
import { StatusBadge, ToolLink } from "./parts";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * 1 — THE TOOL CAROUSEL, the first thing under the header and no heading
 * above it: pictures first, so a seller sees what this place makes before
 * being told anything. Three and a half tiles on a desktop, two and a half on
 * a tablet, one and a bit on a phone; arrows, swipe, wheel and keyboard.
 *
 * Every tile is the tool's own picture in the catalogue's 2336×1744 frame —
 * from the config, else the admin's card picture of that tool, else the
 * shipped example of a live tool, else the quiet empty slot — with its name
 * and one line under it. A live tool's whole tile opens it; any other is
 * drawn with its badge and opens nothing.
 */
export function ToolCarousel({ data, t }: { data: SellerHomeData; t: T }) {
  const tiles = CAROUSEL.flatMap((def, index) => {
    const state = data.items[def.item];
    return state ? [{ def, state, index }] : [];
  });
  if (tiles.length === 0) return null;
  const hint = t("sellerHome.slot.size", { w: TOOL_TILE.width, h: TOOL_TILE.height });

  return (
    <section className="relative" data-seller-carousel>
      <Rail label={t(SECTION_COPY.carousel)} prevLabel={t("sellerHome.carousel.prev")} nextLabel={t("sellerHome.carousel.next")}
        role={t("sellerHome.carousel.role")} arrowTop="calc(50% - 1.1rem)"
        className="[--rail-cols:1.18] [--rail-gap:10px] sm:[--rail-cols:2.5] sm:[--rail-gap:12px] lg:[--rail-cols:3.5] lg:[--rail-gap:14px]">
        {tiles.map(({ def, state, index }) => {
          const name = t(def.nameKey);
          const live = state.status === "live";
          const slot = data.toolSlots[def.item];
          return (
            <ToolLink key={def.item} state={state} ariaLabel={name} data-carousel-tile={def.item}
              className="group block min-w-0 rounded-xl outline-offset-2">
              <span className={cn("relative block overflow-hidden rounded-xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]",
                live && "transition-shadow duration-300 group-hover:shadow-[0_16px_34px_-18px_rgb(var(--accent)/0.7)]")}>
                <MediaSlot media={def.media} ratio={ratioOf(TOOL_TILE)} tone={index}
                  admin={slot ? { slot, slots: data.slots } : null}
                  shipped={live ? SHIPPED_TOOL_PHOTO[def.item] ?? null : null}
                  dim={!live} label={name} hint={hint} priority={index < 3}
                  sizes="(max-width: 639px) 84vw, (max-width: 1023px) 40vw, 29vw"
                  className={cn("rounded-xl", live && "transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100")} />
                <StatusBadge status={state.status} t={t} className="absolute left-2 top-2" />
              </span>
              <span className="mt-2 block truncate px-0.5 text-[13px] font-semibold leading-tight text-ink">{name}</span>
              <span className="mt-0.5 block truncate px-0.5 text-[12px] leading-snug text-muted">{t(def.subKey)}</span>
            </ToolLink>
          );
        })}
      </Rail>
    </section>
  );
}
