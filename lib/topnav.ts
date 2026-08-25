import type { LucideIcon } from "lucide-react";
import {
  Boxes, Crop, Gauge, Layers, Mail, Maximize2, Megaphone, PenLine, Scissors,
  Shirt, ShoppingBag, Square, Stamp, Sun, SwatchBook, Video, Wand2, Clapperboard,
  Image as ImageIcon, Sparkles, Film, MessageSquareText,
} from "lucide-react";

/**
 * TOP NAVIGATION TREE — the customer app's information architecture from the
 * UX spec: a horizontal bar with two mega-menus (Image / Video), each split
 * into TWÓRZ (generation categories) and EDYTUJ (operations on an existing
 * asset). Entries carry real destinations; anything without a working
 * backend is marked `soon` and rendered disabled — never as a dead link.
 */

export type MegaEntry = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** No backend yet — rendered with a "Wkrótce" badge, not clickable. */
  soon?: boolean;
};

/** TWÓRZ — image generation categories. All real categories route into the
 *  Generator (EcomStudio engine) with the category preselected; Matching is
 *  a Phase-3 workflow and is honestly marked as coming soon. */
export const IMAGE_CREATE: readonly MegaEntry[] = [
  { key: "moda", href: "/prompts?cat=moda", icon: Shirt },
  { key: "ecommerce", href: "/prompts?cat=ecommerce", icon: ShoppingBag },
  { key: "social", href: "/prompts?cat=social", icon: Megaphone },
  { key: "mailing", href: "/prompts?cat=mailing", icon: Mail },
  { key: "inne", href: "/prompts?cat=inne", icon: Boxes },
  { key: "matching", href: "/prompts", icon: SwatchBook, soon: true },
] as const;

/** The two working modes of the one Generator (spec: AI Studio is not a
 *  separate application — it is the advanced mode of the Generator). */
export const IMAGE_MODES: readonly MegaEntry[] = [
  { key: "engine", href: "/prompts", icon: Sparkles },
  { key: "custom", href: "/generator", icon: PenLine },
] as const;

/** EDYTUJ — the existing image toolbox, one entry per real tool. */
export const IMAGE_EDIT: readonly MegaEntry[] = [
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

/** VIDEO — the mirror structure. No video backend exists yet, so every
 *  entry is an honest "Wkrótce": the architecture is in place, the promise
 *  is not faked. */
export const VIDEO_CREATE: readonly MegaEntry[] = [
  { key: "product", href: "/home", icon: Clapperboard, soon: true },
  { key: "fashion", href: "/home", icon: Shirt, soon: true },
  { key: "ecommerce", href: "/home", icon: ShoppingBag, soon: true },
  { key: "social", href: "/home", icon: Megaphone, soon: true },
  { key: "img2vid", href: "/home", icon: ImageIcon, soon: true },
  { key: "prompt2vid", href: "/home", icon: MessageSquareText, soon: true },
] as const;

export const VIDEO_EDIT: readonly MegaEntry[] = [
  { key: "captions", href: "/home", icon: Film, soon: true },
  { key: "thumbnail", href: "/home", icon: Layers, soon: true },
] as const;

export const VIDEO_ICON = Video;

/** Homepage category tiles — the same six categories as the Image mega-menu,
 *  with a one-line description key per tile. */
export const HOME_CATEGORIES = IMAGE_CREATE;
