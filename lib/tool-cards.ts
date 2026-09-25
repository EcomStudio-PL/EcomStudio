import type { LucideIcon } from "lucide-react";
import {
  Contrast, Crop, Gauge, Lightbulb, Maximize2, Palette,
  PencilRuler, Scaling, Scissors, Shirt, SlidersHorizontal, Sparkles,
  Square, Stamp, Sun, Video, Wand2, WandSparkles,
} from "lucide-react";
import {
  CATEGORIES, VIDEO_CREATE_WF, VIDEO_EDIT_WF, categoryPath, offeredWorkflows, workflowHref,
  type Category,
} from "./categories";
// Type-only, so nothing of the component reaches this module at runtime; the
// motif names belong with the thing that draws them.
import type { ToolMotif } from "@/components/tools/tool-thumb";
import type { ToolSlug } from "./images/tools";
import { featureForHref, menuVisible, routeReachable, type AvailabilityMap } from "./features";

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

/**
 * A category as a section of the hub: the workflows it OFFERS, in its own
 * order. `offeredWorkflows` is what keeps the retired Moda presets out — they
 * still resolve at their old URLs, they are just not offered. A workflow that
 * has no engine yet (or a category that has none) is a card with a "Wkrótce"
 * badge, never a link.
 */
function categorySection(c: Category): HubSectionDef {
  return {
    key: c.slug,
    icon: c.icon,
    titleKey: `cats.${c.key}`,
    category: c.key,
    gates: [categoryPath(c)],
    cards: offeredWorkflows(c).map((w) => {
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
    }),
  };
}

/** The sections a category contributes, in registry order. */
export const CATEGORY_SECTIONS: readonly HubSectionDef[] = CATEGORIES.map(categorySection);

/**
 * EVERYTHING /tools DRAWS, IN THE ORDER IT DRAWS IT.
 *
 * The categories take the place their entry cards used to hold — straight
 * after the generator — so the page reads: edit a photo, make one, make one
 * for a purpose, prepare the files, video.
 */
export const HUB_SECTIONS: readonly HubSectionDef[] = (() => {
  const own = TOOL_SECTIONS.map((s): HubSectionDef => ({ ...s }));
  const at = own.findIndex((s) => s.key === "create") + 1;
  return [...own.slice(0, at), ...CATEGORY_SECTIONS, ...own.slice(at)];
})();

/** Every card the hub draws, flat — catalogue tools and workflows alike. */
export const HUB_CARDS: readonly HubCardDef[] = HUB_SECTIONS.flatMap((s) => s.cards);

/** The section a `?category=` value opens, when it names one. Unknown values
 *  open nothing: a stale or mistyped link lands on the top of the hub. */
export function hubSection(key: string | null | undefined): HubSectionDef | null {
  if (!key) return null;
  return HUB_SECTIONS.find((s) => s.key === key) ?? null;
}

/**
 * The hub as ONE viewer may see it — the availability switchboard applied,
 * exactly as the menus apply it.
 *
 * A category's section is LISTED when its category is visible in the menu —
 * the same rule its entry card on this page always had. A category that is
 * merely hidden from the menu is not listed, but the section still opens when
 * the URL asks for it (`?category=<slug>`, which is also where its old
 * /k/<slug> address forwards): hidden-from-the-menu has always meant "not
 * advertised", never "unreachable". A DISABLED category opens for nobody but
 * an admin.
 *
 * A card is drawn when its OWN switch allows it; a card whose route is
 * governed by the very switch its section answers to (a category's preset)
 * follows the section's decision rather than repeating it. A section left
 * with no cards is dropped rather than shown as an empty heading. What is
 * merely restricted — "Wkrótce", maintenance — stays, and carries its badge
 * for customers. Admins are shown everything, open, as the catalogue has always
 * shown them (tools-catalogue.tsx gives admins no module badge): they are the
 * ones who switch modules back on, and the page itself tells them what a
 * customer gets (FeatureGate's preview strip on the module they open).
 */
export function hubSectionsFor(avail: AvailabilityMap, isAdmin: boolean, requested?: string | null): HubSectionDef[] {
  return HUB_SECTIONS
    .filter((s) => !s.gates || menuVisible(avail, s.gates, isAdmin)
      || (s.key === requested && routeReachable(avail, s.gates, isAdmin)))
    .map((s) => {
      const sectionFeature = s.gates ? featureForHref(s.gates[s.gates.length - 1]) : null;
      return {
        ...s,
        cards: s.cards.filter((c) => {
          const own = c.gates ? c.gates[c.gates.length - 1] : c.href;
          if (sectionFeature && featureForHref(own) === sectionFeature) return true;
          return menuVisible(avail, c.gates ?? c.href, isAdmin);
        }),
      };
    })
    .filter((s) => s.cards.length > 0);
}
