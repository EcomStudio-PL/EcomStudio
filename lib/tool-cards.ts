import type { LucideIcon } from "lucide-react";
import {
  Contrast, Crop, Gauge, Lightbulb, Maximize2, Palette, PenLine,
  PencilRuler, Scaling, Scissors, Shirt, SlidersHorizontal, Sparkles,
  Square, Stamp, Sun, Video, Wand2, WandSparkles,
} from "lucide-react";
import {
  CATEGORIES, VIDEO_CREATE_WF, VIDEO_EDIT_WF, categoryPath, offeredWorkflows, workflowHref,
  type Category, type Workflow,
} from "./categories";
// Type-only, so nothing of the component reaches this module at runtime; the
// motif names belong with the thing that draws them.
import type { ToolMotif } from "@/components/tools/tool-thumb";
import type { ToolSlug } from "./images/tools";

/**
 * THE TOOL CATALOGUE — every card on /tools, as data.
 *
 * /tools is the ONE place that holds every tool the product has. It is built
 * from two registries and from nothing else: the catalogue's own sections
 * below (`TOOL_SECTIONS`) and the categories' workflows (lib/categories.ts),
 * each category drawn as a section of its own (`HUB_SECTIONS`). A category is
 * a SECTION here, never a card: Moda is where Niewidzialny manekin lives, not
 * a tool beside it.
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
    // No "Zobacz wszystkie": with the categories moved out into sections of
    // their own, the generator is this section's only card, and a link to the
    // same place beside it would do nothing the card does not.
    key: "create", icon: Sparkles, titleKey: "hub.sec.create",
    // The categories used to sit here as five more cards, each opening a page
    // of its own. They are sections of this hub now (HUB_SECTIONS below), so
    // a card for one would be a second door into the same tools.
    cards: [
      { key: "generator", href: "/prompts", icon: Sparkles, motif: "spark",
        titleKey: "mega.createImage", bodyKey: "hub.card.generator" },
      // The custom-prompt mode of the same generator, at its own existing
      // address (/generator). A card, not a new tool: the catalogue lists it
      // so the layout can place it — see lib/tool-layout.ts.
      { key: "custom", href: "/generator", icon: PenLine, motif: "spark",
        titleKey: "mega.custom", bodyKey: "mega.customSub" },
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
    // the architecture is in place, the promise is not faked. Both halves of
    // the video menu are here, making and editing, because both are listed
    // there and on /wideo: the hub must not know less than the menu does.
    cards: [...VIDEO_CREATE_WF, ...VIDEO_EDIT_WF].map((w) => ({
      key: `video_${w.key}`, href: "/wideo", icon: w.icon, motif: "video" as ToolMotif,
      titleKey: `video.wf.${w.key}.name`, bodyKey: `video.wf.${w.key}.sub`, soon: true,
    })),
  },
] as const;

/** Every card of the catalogue's own sections, flat. The order is the
 *  catalogue's own. The categories' workflows are NOT here — they are keyed,
 *  slotted and switched as workflows, see `HUB_SECTIONS`. */
export const TOOL_CARDS: readonly ToolCardDef[] =
  TOOL_SECTIONS.flatMap((s) => s.cards);

export function toolCard(key: string): ToolCardDef | undefined {
  return TOOL_CARDS.find((c) => c.key === key);
}

/** A VIDEO tool: the video module's cards, keyed `video_<workflow>` (see the
 *  "video" section above). Their thumbnails are vertical 9:16 on Start and in
 *  /tools; every other card's is a photo frame. The one test both ask. */
export function isVideoCard(key: string): boolean {
  return key.startsWith("video_");
}

/** A ROW's frame: vertical 9:16 when most of its cards are video tools (the
 *  Start's video row, /tools → Wideo AI), the photo frame otherwise. So a row
 *  is always level: a video tool placed among photo tools (the rail, "Wybierz
 *  efekt") takes the photo frame, keeps its play mark and is shown whole. */
export function majorityVideo(flags: readonly boolean[]): boolean {
  return flags.filter(Boolean).length * 2 > flags.length;
}

/* ── THE HUB: THE CATALOGUE PLUS EVERY CATEGORY ──────────────────────────── */

/** One card of the hub: a catalogue tool, or one workflow of a category. */
export type HubCardDef = ToolCardDef & {
  /**
   * Set on a category's workflow — the pair its media slot and its screen are
   * keyed on. Its `key` is then `<category>.<workflow>`, the same id the
   * workflow's media slot already carries, so the two can never disagree.
   */
  workflow?: { category: string; key: string };
  /**
   * Every route whose switch governs this card, when that is more than its own
   * href. A Moda tool has a switch of its own AND lives inside Moda: either one
   * switched off closes the card, exactly as either one closes the screen.
   */
  gates?: readonly string[];
};

export type HubSectionDef = {
  /** Also the section's anchor and the value of `?category=` that opens it. */
  key: string;
  icon: LucideIcon;
  titleKey: string;
  seeAll?: string;
  cards: readonly HubCardDef[];
  /** A category's section: the route whose switch decides whether the section
   *  exists at all for this viewer. */
  gates?: readonly string[];
  /** Set on a category's section — which category it is. */
  category?: string;
};

/**
 * ONE MOTIF PER WORKFLOW, chosen for what that workflow DOES.
 *
 * The motif is the floor a card falls to when no picture has been put in its
 * slot, and most cards are on that floor. A section where every tile is the
 * same drawing does not read as "art we have not shot yet"; it reads as one
 * tile that failed to load, repeated. So each workflow takes the motif that
 * describes it, and neighbours take different ones. Keys are
 * `<category>.<workflow>`; a workflow added to lib/categories.ts and not here
 * falls back to its category's motif rather than to nothing.
 *
 * Shared with the public product homepage (lib/home-sections.ts), which draws
 * the same workflows and must draw them the same way.
 */
export const WORKFLOW_MOTIF: Readonly<Record<string, ToolMotif>> = {
  // Moda — a garment lifted off its background, laid flat, de-creased, reworn.
  "moda.ghostMannequin": "cutout",
  "moda.flatlay": "grid",
  "moda.iron": "wipe",
  "moda.changePerson": "spark",
  "moda.changeFace": "stamp",
  // E-commerce — the marketplace shapes.
  "ecommerce.packshot": "cutout",
  "ecommerce.thumbnail": "frame",
  "ecommerce.context": "wipe",
  "ecommerce.set": "grid",
  "ecommerce.scale": "scale",
  // Social — vertical video first, then the feed shapes.
  "social.reels": "video",
  "social.feed": "grid",
  "social.ads": "spark",
  "social.ugc": "stamp",
  "social.carousel": "frame",
  // Mailing — a banner, an offer, a block, a season.
  "mailing.header": "frame",
  "mailing.promo": "spark",
  "mailing.newsletter": "grid",
  "mailing.seasonal": "swatch",
  // Inne — print and packaging.
  "inne.label": "stamp",
  "inne.packaging": "cutout",
  "inne.leaflet": "frame",
  "inne.icons": "grid",
  "inne.free": "swatch",
  // Matching — style taken from a reference.
  "matching.fromInspiration": "spark",
  "matching.brandStyle": "swatch",
  "matching.series": "grid",
};

/** One motif per category — the fallback for a workflow that has not been
 *  given its own above. */
export function motifForCategory(categoryKey: string): ToolMotif {
  switch (categoryKey) {
    case "moda": return "grid";
    case "ecommerce": return "cutout";
    case "social": return "wipe";
    case "mailing": return "frame";
    case "inne": return "swatch";
    default: return "spark";
  }
}

/** One workflow of a category, as a card: the route, the art, the badge. */
function workflowCard(c: Category, w: Workflow): HubCardDef {
  const id = `${c.key}.${w.key}`;
  const href = workflowHref(c, w);
  return {
    key: id,
    href,
    icon: w.icon,
    motif: WORKFLOW_MOTIF[id] ?? motifForCategory(c.key),
    titleKey: `wf.${c.key}.${w.key}.name`,
    bodyKey: `wf.${c.key}.${w.key}.sub`,
    soon: Boolean(w.soon || c.soon),
    workflow: { category: c.key, key: w.key },
    gates: [categoryPath(c), href],
  };
}

/**
 * A category as a section: the workflows it OFFERS, in its own order.
 * `offeredWorkflows` is what keeps the retired Moda presets out of the
 * category's own switcher. The /tools page no longer draws these sections
 * directly — lib/tool-layout.ts decides what /tools shows — but the category's
 * own set of jobs is still a fact other screens ask for.
 */
function categorySection(c: Category): HubSectionDef {
  return {
    key: c.slug,
    icon: c.icon,
    titleKey: `cats.${c.key}`,
    category: c.key,
    gates: [categoryPath(c)],
    cards: offeredWorkflows(c).map((w) => workflowCard(c, w)),
  };
}

/** The sections a category contributes, in registry order. */
export const CATEGORY_SECTIONS: readonly HubSectionDef[] = CATEGORIES.map(categorySection);

/**
 * A category with no engine at all ("Matching") is ONE item — the category
 * itself, at its own address, badged "Wkrótce" — rather than three cards for
 * workflows none of which can run. Its workflows keep their definitions in
 * lib/categories.ts; they are simply not offered as separate tools.
 */
function categoryItem(c: Category): HubCardDef {
  return {
    key: c.key,
    href: categoryPath(c),
    icon: c.icon,
    motif: motifForCategory(c.key),
    titleKey: `cats.${c.key}`,
    bodyKey: `cats.${c.key}Sub`,
    soon: true,
    gates: [categoryPath(c)],
  };
}

/**
 * EVERY ITEM THE CATALOGUE CAN SHOW — the tools' own cards, every workflow of
 * every category (the retired Moda presets included: they are real, working
 * routes an operator may place again), and one item per category that has no
 * engine yet. One entry per existing destination, keyed by the key its media
 * slot already uses. Which of them /tools actually shows, where and in what
 * order is not decided here: that is the layout (lib/tool-layout.ts).
 */
export const CATALOG_ITEMS: readonly HubCardDef[] = (() => {
  const items: HubCardDef[] = [...TOOL_CARDS];
  for (const c of CATEGORIES) {
    if (c.soon) items.push(categoryItem(c));
    else for (const w of c.workflows) items.push(workflowCard(c, w));
  }
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
})();

/** Every item, flat — what the Start page and the search resolve keys against. */
export const HUB_CARDS: readonly HubCardDef[] = CATALOG_ITEMS;

const ITEM_BY_KEY = new Map(CATALOG_ITEMS.map((c) => [c.key, c]));

/** One catalogue item by key, or undefined for a key nothing defines. */
export function catalogItem(key: string): HubCardDef | undefined {
  return ITEM_BY_KEY.get(key);
}
