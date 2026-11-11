import type { LucideIcon } from "lucide-react";
import { PACKSHOT_PATH } from "@/lib/tool-routes";
import {
  Crop, Gauge, Maximize2, Palette, Scaling, Scissors, SlidersHorizontal, Square, Stamp,
  Sun, Sparkles, WandSparkles, Wrench,
} from "lucide-react";
import {
  CATEGORIES, VIDEO_CREATE_WF, VIDEO_EDIT_WF, VIDEO_ICON, categoryGates, categoryHref, categoryPath,
  type CategoryAccent,
} from "./categories";
import { menuBadge, menuVisible, type AvailabilityMap, type MenuBadge, type MenuGate } from "./features";
import { catalogItem } from "./tool-cards";
import { DEFAULT_LAYOUT, itemLabelKey, menuItemKeys } from "./tool-layout";

/**
 * TOP NAVIGATION TREE — the customer app's information architecture: a
 * horizontal bar with two mega-menus (Image / Video), each split into TWÓRZ
 * (generation categories) and EDYTUJ (operations on an existing asset).
 *
 * Categories resolve to their own SECTION of the /tools hub
 * (`/tools?category={slug}`), which holds every tool the product has — the
 * categories are how that page is organised, not pages of their own. Anything
 * without a working backend is marked `soon` and rendered disabled — never as
 * a dead link.
 */

export type MegaEntry = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Per-category accent, used for the icon tile inside menus and tiles. */
  accent?: CategoryAccent;
  /**
   * Full i18n key for the label. Only destinations that are NOT a row of the
   * tool catalogue need it — the editor, the resize screen and the hub are
   * places, not tools, so they have no `tools.<slug>.name` to be named by.
   */
  labelKey?: string;
  /** Full i18n key for the one-liner under the label, when the entry is not a
   *  category (categories take theirs from `cats.<key>Sub`). */
  subKey?: string;
  /** No backend yet — rendered with a "Wkrótce" badge, not clickable. */
  soon?: boolean;
  /**
   * The routes whose switches govern this entry, when `href` alone cannot say
   * — a category's link opens a section of /tools, and the query string that
   * names the section never decides anything in the feature table. Read it
   * through `entryGate`, never `href`, wherever availability is asked.
   */
  gates?: readonly string[];
  /** The path whose screens count as "here" for this entry, when `href` is a
   *  view rather than a path: a category's row is the current one on every
   *  screen of its workflows (/k/moda/…). */
  match?: string;
};

/** What to ask the availability switchboard about an entry. */
export function entryGate(e: MegaEntry): MenuGate {
  return e.gates ?? e.href;
}

/**
 * THE CATEGORIES — each a link into its section of /tools. No longer drawn in
 * the header menu (the launch menu is the compact „Obrazy” list below); kept
 * for the search, the active-link rule and the admin panel's map of where a
 * category is reachable — the /tools hub still shows them as sections.
 *
 * "Własny prompt" is NOT a tile here. It is a MODE of the generator, not a
 * separate product: the generator's mode tabs sit at the top of both `/prompts`
 * and `/generator`, so the blank prompt is one click from the generator
 * itself. Listing it in the menu as a seventh peer of the categories said the
 * opposite — that GrovBase ships two generators — and it took the slot next to
 * the categories that a category deserves.
 */
export const IMAGE_CREATE: readonly MegaEntry[] = [
  ...CATEGORIES.map((c) => ({
    key: c.key,
    href: categoryHref(c),
    gates: categoryGates(c),
    match: categoryPath(c),
    icon: c.icon,
    accent: c.accent,
    soon: c.soon,
  })),
];

/**
 * The generator and the hub as destinations (the active-link rule reads their
 * routes). In the menu itself the generator is a row of `imageMenuEntries` and
 * the hub is `ALL_TOOLS_ENTRY`. Historically: the two buttons under the create
 * column: make an image, or go to the whole toolbox. Both are destinations the panel already contains — the second is
 * the same `/tools` hub the EDYTUJ column ends with, kept in both places on
 * request, because a seller who came for "the other tools" looks either at the
 * bottom of the panel or at the end of the list, not reliably at both.
 */
export const IMAGE_MODES: readonly MegaEntry[] = [
  // The CTA carries the product's own name — "Generator Grovshot" — because
  // it is now the ONE door into making an image: the custom prompt lives
  // behind it as a mode, not beside it as a tile. `mega.engine` stays the
  // internal name used by the admin registry, the home screen's continue
  // button and the mode switch itself.
  { key: "engine", href: "/prompts", icon: Sparkles, labelKey: "mega.createImage" },
  { key: "allTools", href: "/tools", icon: Wrench, labelKey: "nav.allTools" },
] as const;

/**
 * THE EDITING DESTINATIONS (search icons, the active-link rule). The header
 * menu no longer has an EDYTUJ column — its rows come from
 * `imageMenuEntries`. Historically: EDYTUJ — five destinations, not one row
 * per dial.
 *
 * The menu used to list ten entries because every operation had a page of its
 * own. Background, white background, shadow and format are now sections of the
 * editor or of the resize screen, so listing them here would be a table of
 * contents for pages that no longer exist. What stays is the four places a
 * photo can actually be taken to, and then the hub that holds the rest.
 */
export const IMAGE_EDIT: readonly MegaEntry[] = [
  { key: "retouch", href: PACKSHOT_PATH, icon: WandSparkles, subKey: "mega.sub.retouch" },
  { key: "editor", href: "/tools/editor", icon: SlidersHorizontal, labelKey: "nav.editor", subKey: "mega.sub.editor" },
  { key: "resize", href: "/tools/resize", icon: Scaling, labelKey: "nav.resize", subKey: "mega.sub.resize" },
  { key: "compress", href: "/tools/compress", icon: Gauge, subKey: "mega.sub.compress" },
  // The hub is the last row of the column, not a footer: it is where the four
  // above stop and everything else begins.
  { key: "allTools", href: "/tools", icon: Wrench, labelKey: "nav.allTools", subKey: "mega.sub.allTools" },
] as const;

/**
 * The tools the menu no longer carries. They are still real pages — three keep
 * their own batch queue, four are the photo tools — so search must still find
 * them by name even though only the hub lists them.
 */
export const IMAGE_EDIT_MORE: readonly MegaEntry[] = [
  { key: "upscale", href: "/tools/upscale", icon: Maximize2 },
  { key: "expand", href: "/tools/expand", icon: Crop },
  { key: "watermark", href: "/tools/watermark", icon: Stamp },
  // The four photo tools — screens of their own, each its own feature, so
  // the search lists them as tools (not editor sections) with these icons.
  { key: "remove_bg", href: "/tools/remove_bg", icon: Scissors },
  { key: "white_bg", href: "/tools/white_bg", icon: Square },
  { key: "ai_background", href: "/tools/ai_background", icon: Palette },
  { key: "ai_shadow", href: "/tools/ai_shadow", icon: Sun },
] as const;

/**
 * THE „OBRAZY” LIST — what the header's image menu draws, one row per item
 * whose "menu" switch is on, in `menuItemKeys` order (MENU_ORDER first — see
 * lib/tool-layout.ts, the one place the order is decided). The phone drawer
 * draws the same rows.
 *
 * Every row is an item of the tool catalogue: its route, its icon and its
 * gates come from there (lib/tool-cards.ts), so a row can never point at a
 * different screen than the card on /tools. Only the words differ — the menu
 * names a destination and says in one line what it does — and the four launch
 * tools carry their own (`MENU_ROW_TEXT`). An item an admin switches in later
 * gets its /tools name and one-liner, with no code change.
 *
 * Whether a CUSTOMER sees a row is the feature switchboard's answer
 * (`routeReachable` / `menuVisible`), asked by the menu itself; an admin sees
 * every row, the ones customers cannot see marked „Ukryte”. The hub link
 * („Wszystkie narzędzia”, `ALL_TOOLS_ENTRY`) is not a row: the menu draws it
 * once, at the bottom.
 */
const MENU_ROW_TEXT: Readonly<Record<string, { labelKey: string; subKey: string }>> = {
  generator: { labelKey: "mega.createImage", subKey: "mega.sub.generator" },
  "ecommerce.thumbnail": { labelKey: "wf.ecommerce.thumbnail.name", subKey: "mega.sub.thumbnail" },
  retouch: { labelKey: "tools.retouch.name", subKey: "mega.sub.retouch" },
  custom: { labelKey: "mega.createPhoto", subKey: "mega.sub.custom" },
  editor: { labelKey: "nav.editor", subKey: "mega.sub.editor" },
  resize: { labelKey: "nav.resize", subKey: "mega.sub.resize" },
  compress: { labelKey: "tools.compress.name", subKey: "mega.sub.compress" },
};

export function imageMenuEntries(menuItems: readonly string[] = menuItemKeys(DEFAULT_LAYOUT)): MegaEntry[] {
  const out: MegaEntry[] = [];
  for (const key of menuItems) {
    const item = catalogItem(key);
    if (!item) continue;
    const text = MENU_ROW_TEXT[key];
    out.push({
      key, href: item.href, icon: item.icon,
      labelKey: text?.labelKey ?? itemLabelKey(item),
      subKey: text?.subKey ?? item.bodyKey,
      soon: item.soon, gates: item.gates,
    });
  }
  return out;
}

/**
 * THE „OBRAZY” ROWS THIS VIEWER GETS, and the badge each carries.
 *
 * A customer gets the rows the switchboard shows them (`menuVisible`: not
 * DISABLED, not hidden from menus — every gate of the row asked), with the
 * „Wkrótce” / „Prace techniczne” pill where that applies. An admin gets every
 * row, and the ones a customer would not see say „Ukryte” — the admin's
 * access and the public offer are two facts and the menu shows both. Shared
 * with the phone drawer, so the two lists cannot drift apart.
 */
export type MenuRowBadge = MenuBadge | "hidden";

export function imageMenuRows(avail: AvailabilityMap, isAdmin: boolean, menuItems?: readonly string[]): { entry: MegaEntry; badge: MenuRowBadge }[] {
  return imageMenuEntries(menuItems).flatMap((entry): { entry: MegaEntry; badge: MenuRowBadge }[] => {
    const gate = entryGate(entry);
    if (!menuVisible(avail, gate, isAdmin)) return [];
    if (isAdmin && !menuVisible(avail, gate, false)) return [{ entry, badge: "hidden" }];
    return [{ entry, badge: menuBadge(avail, gate) }];
  });
}

/** The menu's one link to the whole toolbox, drawn once under the rows. */
export const ALL_TOOLS_ENTRY: MegaEntry = { key: "allTools", href: "/tools", icon: Wrench, labelKey: "nav.allTools" };

/** Where an EDYTUJ entry takes its label from: its own key when it is a
 *  destination, the tool catalogue when it is one of the tools. */
export function editLabelKey(entry: MegaEntry): string {
  return entry.labelKey ?? `tools.${entry.key}.name`;
}

/** VIDEO — the mirror structure. No video backend exists yet, so every entry
 *  routes to the video workspace, which states plainly that generation is not
 *  available. The architecture is in place; the promise is not faked. */
export const VIDEO_CREATE: readonly MegaEntry[] = VIDEO_CREATE_WF.map((w) => ({
  key: w.key, href: `/wideo#${w.key}`, icon: w.icon, soon: true,
}));

export const VIDEO_EDIT: readonly MegaEntry[] = VIDEO_EDIT_WF.map((w) => ({
  key: w.key, href: `/wideo#${w.key}`, icon: w.icon, soon: true,
}));

export { VIDEO_ICON };

