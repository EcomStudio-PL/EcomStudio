import type { LucideIcon } from "lucide-react";
import {
  Crop, Gauge, Maximize2, PenLine, Scissors, Square, Stamp, Sun, SwatchBook,
  Wand2, Sparkles, WandSparkles,
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

/** EDYTUJ — the existing image toolbox, one entry per real tool. */
export const IMAGE_EDIT: readonly MegaEntry[] = [
  { key: "retouch", href: "/retusz", icon: WandSparkles },
  { key: "remove_bg", href: "/tools/remove_bg", icon: Scissors },
  { key: "white_bg", href: "/tools/white_bg", icon: Square },
  { key: "upscale", href: "/tools/upscale", icon: Maximize2 },
  { key: "format", href: "/tools/format", icon: Crop },
  { key: "shadow", href: "/tools/shadow", icon: Sun },
  { key: "expand", href: "/tools/expand", icon: Wand2 },
  { key: "compress", href: "/tools/compress", icon: Gauge },
  { key: "watermark", href: "/tools/watermark", icon: Stamp },
  { key: "recolor", href: "/tools", icon: SwatchBook, soon: true },
] as const;

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
