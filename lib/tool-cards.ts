import type { LucideIcon } from "lucide-react";
import {
  Boxes, Contrast, Crop, Gauge, Lightbulb, Mail, Maximize2, Megaphone, Palette,
  PencilRuler, Scaling, Scissors, Shirt, ShoppingBag, SlidersHorizontal, Sparkles,
  Square, Stamp, Sun, Video, Wand2, WandSparkles,
} from "lucide-react";
import { VIDEO_CREATE_WF } from "./categories";
// Type-only, so nothing of the component reaches this module at runtime; the
// motif names belong with the thing that draws them.
import type { ToolMotif } from "@/components/tools/tool-thumb";
import type { ToolSlug } from "./images/tools";

/**
 * THE TOOL CATALOGUE — every card on /tools, as data.
 *
 * This list used to live inside app/(app)/tools/page.tsx, which meant it could
 * only be read by rendering the page. It is now a registry for the same reason
 * lib/features.ts and lib/categories.ts are registries: more than one part of
 * the product needs to know what tools exist.
 *
 * WHY IT IS NOT FEATURE_REGISTRY. That registry answers "may this module be
 * opened", and its keys are modules — `tools`, `editor`, `retouch`. The
 * catalogue answers "what does a seller see and choose", and six of its cards
 * (`ai_background`, `relight`, `ai_shadow`, `beautify`, `uncrop`,
 * `ghost_mannequin`) are distinct tools that all live behind the single
 * `tools` module key. Deriving card-level anything from FEATURE_REGISTRY would
 * silently collapse those six into one.
 *
 * TEXT IS KEYS, NOT STRINGS. The page applies `t()`; nothing here is
 * user-facing prose, so this file stays usable from anywhere — including the
 * admin's media screen, which lists these cards without rendering them.
 */

export type ToolCardDef = {
  /** Stable identifier. Also the entity id of this card's media slot. */
  key: string;
  href: string;
  icon: LucideIcon;
  motif: ToolMotif;
  titleKey: string;
  bodyKey: string;
  /** The catalogue row that prices it. Places (the editor, a category) have none. */
  slug?: ToolSlug;
  /** No backend yet: shown, badged, never clickable. */
  soon?: boolean;
  /**
   * A card that is an entry point into a CATEGORY rather than a tool. Its
   * picture is already the category's own, so it gets no second slot — one
   * thing must not have two admin screens.
   */
  category?: boolean;
};

export type ToolSectionDef = {
  key: string;
  icon: LucideIcon;
  titleKey: string;
  /** Where "Zobacz wszystkie" goes; omitted when the section shows everything. */
  seeAll?: string;
  cards: readonly ToolCardDef[];
};

export const TOOL_SECTIONS: readonly ToolSectionDef[] = [
  {
    key: "edit", icon: PencilRuler, titleKey: "hub.sec.edit", seeAll: "/tools/editor",
    cards: [
      { key: "retouch", href: "/retusz", icon: WandSparkles, motif: "wipe",
        titleKey: "tools.retouch.name", bodyKey: "tools.retouch.body" },
      { key: "remove_bg", href: "/tools/editor?tool=remove-background", icon: Scissors, motif: "cutout",
        titleKey: "tools.remove_bg.name", bodyKey: "hub.card.remove_bg", slug: "remove_bg" },
      { key: "white_bg", href: "/tools/editor?tool=white-background", icon: Square, motif: "frame",
        titleKey: "tools.white_bg.name", bodyKey: "hub.card.white_bg" },
      { key: "background", href: "/tools/editor?tool=background", icon: Sparkles, motif: "spark",
        titleKey: "editor.bg.color", bodyKey: "hub.card.background" },
      { key: "shadow", href: "/tools/editor?tool=shadow", icon: Sun, motif: "shadow",
        titleKey: "tools.shadow.name", bodyKey: "hub.card.shadow" },
      { key: "adjust", href: "/tools/editor?tool=adjust", icon: Contrast, motif: "swatch",
        titleKey: "editor.s.adjust", bodyKey: "hub.card.adjust" },
      // The generative edits sit beside the local ones rather than in a
      // section of their own: a seller is choosing what to DO to a photo, not
      // shopping for a backend. Each card carries its own price badge, which
      // is where the difference actually shows.
      { key: "ai_background", href: "/tools/ai_background", icon: Palette, motif: "spark",
        titleKey: "tools.ai_background.name", bodyKey: "tools.ai_background.body", slug: "ai_background" },
      { key: "relight", href: "/tools/relight", icon: Lightbulb, motif: "swatch",
        titleKey: "tools.relight.name", bodyKey: "tools.relight.body", slug: "relight" },
      { key: "ai_shadow", href: "/tools/ai_shadow", icon: Sun, motif: "shadow",
        titleKey: "tools.ai_shadow.name", bodyKey: "tools.ai_shadow.body", slug: "ai_shadow" },
      { key: "beautify", href: "/tools/beautify", icon: Wand2, motif: "wipe",
        titleKey: "tools.beautify.name", bodyKey: "tools.beautify.body", slug: "beautify" },
      { key: "ghost_mannequin", href: "/tools/ghost_mannequin", icon: Shirt, motif: "cutout",
        titleKey: "tools.ghost_mannequin.name", bodyKey: "tools.ghost_mannequin.body", slug: "ghost_mannequin" },
    ],
  },
  {
    key: "create", icon: Sparkles, titleKey: "hub.sec.create", seeAll: "/prompts",
    cards: [
      { key: "generator", href: "/prompts", icon: Sparkles, motif: "spark",
        titleKey: "mega.createImage", bodyKey: "hub.card.generator" },
      { key: "moda", href: "/k/moda", icon: Shirt, motif: "grid",
        titleKey: "cats.moda", bodyKey: "cats.modaSub", category: true },
      { key: "ecommerce", href: "/k/ecommerce", icon: ShoppingBag, motif: "cutout",
        titleKey: "cats.ecommerce", bodyKey: "cats.ecommerceSub", category: true },
      { key: "social", href: "/k/social", icon: Megaphone, motif: "wipe",
        titleKey: "cats.social", bodyKey: "cats.socialSub", category: true },
      { key: "mailing", href: "/k/mailing", icon: Mail, motif: "frame",
        titleKey: "cats.mailing", bodyKey: "cats.mailingSub", category: true },
      { key: "inne", href: "/k/inne", icon: Boxes, motif: "swatch",
        titleKey: "cats.inne", bodyKey: "cats.inneSub", category: true },
    ],
  },
  {
    key: "prepare", icon: Scaling, titleKey: "hub.sec.prepare",
    cards: [
      { key: "resize", href: "/tools/resize", icon: Scaling, motif: "scale",
        titleKey: "resize.title", bodyKey: "resize.sub", slug: "format" },
      { key: "compress", href: "/tools/compress", icon: Gauge, motif: "compress",
        titleKey: "compress.title", bodyKey: "compress.sub", slug: "compress" },
      { key: "upscale", href: "/tools/upscale", icon: Maximize2, motif: "scale",
        titleKey: "tools.upscale.name", bodyKey: "tools.upscale.body", slug: "upscale" },
      { key: "expand", href: "/tools/expand", icon: Crop, motif: "frame",
        titleKey: "tools.expand.name", bodyKey: "tools.expand.body", slug: "expand" },
      { key: "uncrop", href: "/tools/uncrop", icon: Maximize2, motif: "frame",
        titleKey: "tools.uncrop.name", bodyKey: "tools.uncrop.body", slug: "uncrop" },
      { key: "watermark", href: "/tools/watermark", icon: Stamp, motif: "stamp",
        titleKey: "tools.watermark.name", bodyKey: "tools.watermark.body", slug: "watermark" },
      { key: "editor", href: "/tools/editor", icon: SlidersHorizontal, motif: "swatch",
        titleKey: "nav.editor", bodyKey: "hub.card.editor" },
    ],
  },
  {
    key: "video", icon: Video, titleKey: "hub.sec.video", seeAll: "/wideo",
    // No video backend exists. Every card says so and none of them opens —
    // the architecture is in place, the promise is not faked.
    cards: VIDEO_CREATE_WF.map((w) => ({
      key: `video_${w.key}`, href: "/wideo", icon: w.icon, motif: "video" as ToolMotif,
      titleKey: `video.wf.${w.key}.name`, bodyKey: `video.wf.${w.key}.sub`, soon: true,
    })),
  },
] as const;

/** Every card, flat. The order is the catalogue's own. */
export const TOOL_CARDS: readonly ToolCardDef[] =
  TOOL_SECTIONS.flatMap((s) => s.cards);

export function toolCard(key: string): ToolCardDef | undefined {
  return TOOL_CARDS.find((c) => c.key === key);
}
