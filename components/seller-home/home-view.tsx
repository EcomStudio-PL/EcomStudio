import { cn } from "@/lib/utils";
import {
  gridMedia, ownText, pairMedia, refSlotKey,
  type GridListKey, type HomeToolEntry, type ToolListKey,
} from "@/lib/home-layout";
import type { Industry, MediaPair, MediaSrc } from "@/lib/seller-home-config";
import type { ItemState } from "@/lib/seller-home-model";
import type { SellerHomeData } from "@/lib/server/seller-home";
import { catalogItem } from "@/lib/tool-cards";
import { itemLabelKey } from "@/lib/tool-layout";

/**
 * /home's LISTS, RESOLVED FOR ONE VIEWER — from the layout (lib/home-layout.ts)
 * and the tools' states (lib/server/seller-home.ts). One rule for every
 * section:
 *
 *   a customer   sees an item only when it is not hidden and its tool is
 *                offered to them (no state = not offered: left out, taking no
 *                place in a row, a slide or a grid);
 *   an admin     sees what a customer sees plus, as before, tools a customer
 *                would not (badged) — and in „Edytuj stronę” every item,
 *                hidden ones included, marked „Ukryty element” /
 *                „Narzędzie ukryte” so they can be edited and brought back.
 *
 * Server-safe and hook-free.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;
export type EditFlag = "item" | "tool";

/** The name a tool goes by when the layout gives an item no name of its own. */
export function toolLabel(item: string, t: T): string {
  if (item.startsWith("cat:")) return t(`cats.${item.slice(4)}`);
  const def = catalogItem(item);
  return def ? t(itemLabelKey(def)) : item;
}
/** …and its one line. */
export function toolLine(item: string, t: T): string {
  if (item.startsWith("cat:")) return t(`cats.${item.slice(4)}Sub`);
  const def = catalogItem(item);
  return def ? t(def.bodyKey) : "";
}

function flagsOf(hidden: boolean | undefined, state: ItemState | undefined, editing: boolean): EditFlag[] {
  if (!editing) return [];
  const f: EditFlag[] = [];
  if (hidden) f.push("item");
  if (state?.customerHidden) f.push("tool");
  return f;
}

export type ToolTile = {
  id: string;
  item: string;
  state: ItemState;
  name: string;
  sub: string;
  /** The tile's config key (`data-config-key`): the editor finds it by this. */
  media: MediaSrc;
  flags: EditFlag[];
};

/** A tool list's tiles (carousel, Moda tools), in the layout's order. */
export function toolTiles(list: ToolListKey, data: SellerHomeData, t: T, locale: string, size: { width: number; height: number }): ToolTile[] {
  // A default tile's own page texts (literal namespaces, so the i18n scope
  // scan sees them): the carousel's name/desc, the Moda tools' name/sub.
  const nameKey = (from: string) => (list === "carousel" ? `sellerHome.tool.${from}.name` : `sellerHome.featured.${from}.name`);
  const lineKey = (from: string) => (list === "carousel" ? `sellerHome.tool.${from}.desc` : `sellerHome.featured.${from}.sub`);
  return data.layout[list].flatMap((e: HomeToolEntry) => {
    if (e.hidden && !data.editing) return [];
    const base = data.items[e.item];
    if (!base) return [];
    // The admin's own link wins only on a tool that opens at all.
    const state = e.href && base.status === "live" ? { ...base, href: e.href } : base;
    return [{
      id: e.id,
      item: e.item,
      state,
      name: ownText(e.name, locale) ?? (e.from ? t(nameKey(e.from)) : toolLabel(e.item, t)),
      sub: ownText(e.sub, locale) ?? (e.from ? t(lineKey(e.from)) : toolLine(e.item, t)),
      media: { configKey: `homeMedia.${list}.${e.from ?? e.id}`, kind: "image", src: null, ...size },
      flags: flagsOf(e.hidden, base, data.editing),
    }];
  });
}

export type PairCard = {
  id: string; n: number; key: string; item: string; state: ItemState; name: string; industry: Industry; media: MediaPair; flags: EditFlag[];
};

export function pairCards(data: SellerHomeData, t: T, locale: string): PairCard[] {
  return data.layout.beforeAfter.flatMap((e) => {
    if (e.hidden && !data.editing) return [];
    const state = data.items[e.item];
    if (!state) return [];
    return [{
      id: e.id, n: e.n, key: `ba${e.n}`, item: e.item, state, industry: e.industry, media: pairMedia(e.n),
      name: ownText(e.name, locale) ?? (e.from ? t(`sellerHome.tool.${e.from}.name`) : toolLabel(e.item, t)),
      flags: flagsOf(e.hidden, state, data.editing),
    }];
  });
}

export type GridTile = { id: string; media: MediaSrc; refKey: string; flags: EditFlag[] };

/** A photo grid's tiles; a photo is bound to no tool, so only its own switch hides it. */
export function gridTiles(k: GridListKey, data: SellerHomeData): GridTile[] {
  return data.layout[k].flatMap((e) => {
    if (e.hidden && !data.editing) return [];
    const media = gridMedia(k, e.n);
    return [{ id: e.id, media, refKey: refSlotKey(media.configKey), flags: flagsOf(e.hidden, undefined, data.editing) }];
  });
}

/** Edit mode's marks on a tile: why a customer would not see it. */
export function EditFlags({ flags, t, className }: { flags: readonly EditFlag[]; t: T; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <span data-home-flags className={cn("pointer-events-none absolute right-2 top-2 z-[3] flex flex-col items-end gap-1", className)}>
      {flags.map((f) => (
        <span key={f} data-home-flag={f}
          className="rounded-full bg-[rgb(20_14_28/0.82)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white ring-1 ring-white/25 backdrop-blur-sm">
          {t(f === "tool" ? "sellerHome.edit.toolHidden" : "sellerHome.edit.itemHidden")}
        </span>
      ))}
    </span>
  );
}

/** The dimming of a marked tile (edit mode only). */
export const flagged = (flags: readonly EditFlag[]) => (flags.length > 0 ? "opacity-55 saturate-50" : undefined);
