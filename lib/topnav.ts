import type { LucideIcon } from "lucide-react";
import {
  Crop, Gauge, Maximize2, PenLine, Scaling, Scissors, SlidersHorizontal, Square, Stamp,
  Sun, Sparkles, WandSparkles, Wrench,
} from "lucide-react";
import { CATEGORIES, VIDEO_CREATE_WF, VIDEO_EDIT_WF, VIDEO_ICON, categoryHref, type CategoryAccent } from "./categories";

/**
 * TOP NAVIGATION TREE — the customer app's information architecture: a
 * horizontal bar with two mega-menus (Image / Video), each split into TWÓRZ
 * (generation categories) and EDYTUJ (operations on an existing asset).
 *
 * Categories resolve to their own workspace pages (`/k/{slug}`), not to a
 * query string on one shared form. Anything without a working backend is
 * marked `soon` and rendered disabled — never as a dead link.
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
};

/**
 * TWÓRZ — the generator itself, then the six category workspaces.
 *
 * "Własny prompt" leads this column rather than sitting in the row of buttons
 * underneath, where it used to compete with the tools hub for the same slot.
 * It belongs here on the merits: it CREATES an image, which is what this
 * column is for, and a seller who knows exactly what they want should not have
 * to read past six categories to find the blank prompt.
 */
export const IMAGE_CREATE: readonly MegaEntry[] = [
  { key: "custom", href: "/generator", icon: PenLine, labelKey: "mega.custom", subKey: "mega.customSub" },
  ...CATEGORIES.map((c) => ({
    key: c.key,
    href: categoryHref(c),
    icon: c.icon,
    accent: c.accent,
    soon: c.soon,
  })),
];

/**
 * The two buttons under the create column: the guided generator, and the way
 * out to everything else.
 *
 * "Wszystkie narzędzia" is HERE and nowhere else. It used to be the last row
 * of the EDYTUJ list as well, so the same destination appeared twice in one
 * panel — once as a peer of Kompresja, once as a footer. A hub is not a peer
 * of the tools it lists.
 */
export const IMAGE_MODES: readonly MegaEntry[] = [
  { key: "engine", href: "/prompts", icon: Sparkles },
  { key: "allTools", href: "/tools", icon: Wrench, labelKey: "nav.allTools" },
] as const;

/**
 * EDYTUJ — four destinations, not one row per dial.
 *
 * The menu used to list ten entries because every operation had a page of its
 * own. Background, white background, shadow and format are now sections of the
 * editor or of the resize screen, so listing them here would be a table of
 * contents for pages that no longer exist. What stays is the four places a
 * photo can actually be taken to; the hub for everything else is the button
 * under the create column, once.
 */
export const IMAGE_EDIT: readonly MegaEntry[] = [
  { key: "retouch", href: "/retusz", icon: WandSparkles },
  { key: "editor", href: "/tools/editor", icon: SlidersHorizontal, labelKey: "nav.editor" },
  { key: "resize", href: "/tools/resize", icon: Scaling, labelKey: "nav.resize" },
  { key: "compress", href: "/tools/compress", icon: Gauge },
] as const;

/**
 * The tools the menu no longer carries. They are still real pages — three keep
 * their own batch queue, three moved into the editor — so search must still
 * find them by name even though only the hub lists them.
 */
export const IMAGE_EDIT_MORE: readonly MegaEntry[] = [
  { key: "upscale", href: "/tools/upscale", icon: Maximize2 },
  { key: "expand", href: "/tools/expand", icon: Crop },
  { key: "watermark", href: "/tools/watermark", icon: Stamp },
  { key: "remove_bg", href: "/tools/editor?tool=remove-background", icon: Scissors },
  { key: "white_bg", href: "/tools/editor?tool=white-background", icon: Square },
  { key: "shadow", href: "/tools/editor?tool=shadow", icon: Sun },
] as const;

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

/** Homepage category tiles — the same six categories as the Image mega-menu. */
export const HOME_CATEGORIES = IMAGE_CREATE;
