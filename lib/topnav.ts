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
  /** No backend yet — rendered with a "Wkrótce" badge, not clickable. */
  soon?: boolean;
};

/** TWÓRZ — image generation categories, each its own workspace. */
export const IMAGE_CREATE: readonly MegaEntry[] = CATEGORIES.map((c) => ({
  key: c.key,
  href: categoryHref(c),
  icon: c.icon,
  accent: c.accent,
  soon: c.soon,
}));

/** The two working modes of the one Generator (AI Studio is not a separate
 *  application — it is the advanced mode of the Generator). */
export const IMAGE_MODES: readonly MegaEntry[] = [
  { key: "engine", href: "/prompts", icon: Sparkles },
  { key: "custom", href: "/generator", icon: PenLine },
] as const;

/**
 * EDYTUJ — five destinations, not one row per dial.
 *
 * The menu used to list ten entries because every operation had a page of its
 * own. Background, white background, shadow and format are now sections of the
 * editor or of the resize screen, so listing them here would be a table of
 * contents for pages that no longer exist. What stays is the four places a
 * photo can actually be taken to, plus the hub for everything else.
 */
export const IMAGE_EDIT: readonly MegaEntry[] = [
  { key: "retouch", href: "/retusz", icon: WandSparkles },
  { key: "editor", href: "/tools/editor", icon: SlidersHorizontal, labelKey: "nav.editor" },
  { key: "resize", href: "/tools/resize", icon: Scaling, labelKey: "nav.resize" },
  { key: "compress", href: "/tools/compress", icon: Gauge },
  { key: "allTools", href: "/tools", icon: Wrench, labelKey: "nav.allTools" },
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
