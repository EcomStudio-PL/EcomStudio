import type { LucideIcon } from "lucide-react";
import { CATEGORIES, categoryGates, categoryPath, type Category } from "./categories";
import { HUB_CARDS, isVideoCard, motifForCategory, type HubCardDef } from "./tool-cards";
import {
  menuBadge, menuVisible, routeReachable, allDefaults, featureForHref,
  type AvailabilityMap, type MenuBadge,
} from "./features";
import { MEDIA_SLOTS, categorySlotKey, toolSlotKey, workflowSlotKey } from "./media-slots";
import { CHIPS, EFFECTS, RAIL, VIDEO_ROW, type Pick } from "./home-picks";
import { DEFAULT_LAYOUT, startExtras, startOn, type ToolsLayout } from "./tool-layout";
import type { ToolMotif } from "@/components/tools/tool-thumb";

/**
 * WHAT THE HOME / START PAGE SHOWS — chosen here, resolved through the registries.
 *
 * ONE PAGE, THREE ADDRESSES. /start, the signed-in Start (/home) and — once
 * the CMS flags it — "/" all render components/home/product-home.tsx, and that
 * component takes every card from this file. There is no second list anywhere.
 *
 * THE CHOICE IS EDITORIAL, THE CARDS ARE NOT. Which six tiles lead the page,
 * which eight chips sit under the upload box and which eight effects follow is
 * a decision about emphasis, so it is written down below as a short list of
 * KEYS. Everything a card says about itself — its route, its name, its icon,
 * its drawn motif, its media slot, whether it is open — is looked up from the
 * registries the application already runs on:
 *
 *     lib/tool-cards.ts   HUB_CARDS: every tool and every category workflow
 *                         /tools draws, with the routes and gates it uses
 *     lib/categories.ts   the categories themselves
 *     lib/features.ts     the live availability switchboard
 *
 * So a key that names nothing is dropped rather than drawn, a module switched
 * off disappears here exactly as it does from the menu, a module marked
 * "Wkrótce" is drawn badged and inert, and a card links where /tools links —
 * never to a placeholder, never to a query string a page ignores.
 *
 * ─── WHY ONLY SOME CARDS CARRY A PHOTOGRAPH ─────────────────────────────────
 *
 * components/tools/tool-thumb.tsx states the rule this file obeys: "a stock
 * shot next to 'Usuń tło' would be claiming an output GrovBase did not
 * produce". A photograph on a card is a CLAIM about what comes out of that
 * tool. So a card gets one only when the tool behind it actually runs today;
 * everything else keeps the drawn motif, which states the OPERATION in
 * geometry and claims nothing. An operator's own picture in the card's media
 * slot outranks both — see components/home/card-art.tsx.
 */

/** Where a card's picture comes from when its media slot is empty. */
export type CardArt =
  /** A picture shipped with the build, under public/. */
  | { kind: "photo"; src: string }
  /** The drawn geometry the tool catalogue already uses. Claims nothing. */
  | { kind: "motif"; motif: ToolMotif };

export type HomeCard = {
  /** Unique on the page. The registry key of the thing the card opens. */
  key: string;
  /** The REAL route — the one /tools and the menus use for the same thing. */
  href: string;
  icon: LucideIcon;
  /** Full i18n key of the label. */
  titleKey: string;
  /** Full i18n key of the one-liner. */
  subKey?: string;
  art: CardArt;
  /** The media slot an operator dresses this card with. Always a key
   *  lib/media-slots.ts declares, so filling it in Admin → Media shows here. */
  slot: string;
  /** null = open. Anything else is drawn as a pill and makes the card inert:
   *  a visitor may look at it and may not open it. */
  badge: MenuBadge;
  /** A video tool — the tile carries the play mark and a vertical 9:16 frame. */
  video: boolean;
};

/* ── THE PHOTOGRAPHS ────────────────────────────────────────────────────────
 *
 * SEVEN FILES, AND THE LIST IS EXHAUSTIVE ON PURPOSE. `public/showcase` holds
 * exactly the examples below, each produced for the tool it sits on. A card
 * not listed here falls through to its drawn motif, which is a deliberate
 * floor rather than an unfinished job. `white_bg` shares the packshot because
 * a white background IS what that shot is; the ghost-mannequin tool and the
 * Moda workflow of the same name are the same operation.
 */
const SHOT = (name: string): CardArt => ({ kind: "photo", src: `/showcase/${name}.webp` });

const PHOTO: Readonly<Record<string, CardArt>> = {
  "ecommerce.packshot": SHOT("ecommerce-packshot"),
  "ecommerce.thumbnail": SHOT("ecommerce-thumbnail"),
  "ecommerce.set": SHOT("ecommerce-set"),
  ghost_mannequin: SHOT("moda-ghost"),
  white_bg: SHOT("ecommerce-packshot"),
  ai_shadow: SHOT("tool-shadow"),
  relight: SHOT("tool-relight"),
  generator: SHOT("grovshot-studio"),
};

/**
 * THE FRAMES BESIDE THE GROVSHOT BANNER, on a wide screen, while the banner's
 * own art slot is empty. Three finishes of the same job — a clean studio shot,
 * a family of products, a relit one — which is what the generator's style
 * directives actually change. The same shipped example files the cards use;
 * an operator's art in `home.grovshot.art` replaces them.
 */
export const GROVSHOT_SHOTS = [
  "/showcase/grovshot-studio.webp",
  "/showcase/ecommerce-set.webp",
  "/showcase/tool-relight.webp",
] as const;

/**
 * The sample thumbnails under the upload box. The SAME files the cards use.
 * Four rather than five: there is no fifth example, and inventing one by
 * repeating a file would make the row look like a rendering bug.
 */
export const SAMPLE_PRODUCTS = [
  "/showcase/ecommerce-packshot.webp",
  "/showcase/tool-relight.webp",
  "/showcase/ecommerce-set.webp",
  "/showcase/moda-ghost.webp",
] as const;

/* ── RESOLVING A KEY ──────────────────────────────────────────────────────── */

/**
 * What a list below may name:
 *   · a HUB CARD by its key — a catalogue tool ("ai_shadow", "video_ugc") or a
 *     category's workflow ("ecommerce.packshot");
 *   · a CATEGORY by its key, prefixed "cat:" ("cat:moda").
 */
const HUB_BY_KEY = new Map(HUB_CARDS.map((c) => [c.key, c]));

function art(key: string, motif: ToolMotif, badge: MenuBadge): CardArt {
  // AN INERT CARD NEVER CARRIES A PHOTOGRAPH. The picture would be a promise
  // about output from a module that is not running, which is the one thing a
  // "Wkrótce" badge exists to prevent.
  if (badge !== null) return { kind: "motif", motif };
  return PHOTO[key] ?? { kind: "motif", motif };
}

/**
 * An item's card, when this viewer may be shown it here.
 *
 * With a LAYOUT (what the page draws), the item's own "show on Start" switch
 * decides whether it is promoted at all, and the status decides whether it may
 * be shown: a DISABLED module is gone, "Wkrótce" stays badged. Without one (the
 * page's primary action, which only asks where a door is open), the
 * switchboard alone decides, as it always has.
 */
function hubCard(c: HubCardDef, avail: AvailabilityMap, isAdmin: boolean, layout?: ToolsLayout): HomeCard | null {
  const gates = c.gates ?? c.href;
  if (layout) {
    if (!startOn(layout, c.key) || !routeReachable(avail, gates, isAdmin)) return null;
  } else if (!menuVisible(avail, gates, isAdmin)) {
    return null;
  }
  // `soon` on the catalogue row and the switchboard's own state are two
  // different facts and BOTH make a card inert: the row says "there is no
  // backend", the switchboard says "an operator switched it off".
  const badge: MenuBadge = c.soon ? "soon" : menuBadge(avail, gates);
  return {
    key: c.key,
    href: c.href,
    icon: c.icon,
    titleKey: c.titleKey,
    subKey: c.bodyKey,
    art: art(c.key, c.motif, badge),
    slot: c.workflow ? workflowSlotKey(c.workflow.category, c.workflow.key) : toolSlotKey(c.key),
    badge,
    video: isVideoCard(c.key),
  };
}

/**
 * A category opens through /k/<slug>, the one address that asks the
 * switchboard on the link's behalf and forwards to the category's section of
 * /tools (or to the Start when the hub itself is off) — see
 * app/(app)/k/[cat]/page.tsx.
 */
function categoryCard(c: Category, avail: AvailabilityMap, isAdmin: boolean): HomeCard | null {
  const gates = categoryGates(c);
  if (!menuVisible(avail, gates, isAdmin)) return null;
  const badge: MenuBadge = c.soon ? "soon" : menuBadge(avail, gates);
  return {
    key: `cat:${c.key}`,
    href: categoryPath(c),
    icon: c.icon,
    titleKey: `cats.${c.key}`,
    subKey: `cats.${c.key}Sub`,
    art: { kind: "motif", motif: motifForCategory(c.key) },
    slot: categorySlotKey(c.key),
    badge,
    video: false,
  };
}

function resolve(picks: readonly Pick[], avail: AvailabilityMap, isAdmin: boolean, layout?: ToolsLayout): HomeCard[] {
  return picks
    .map((p) => {
      if (p.startsWith("cat:")) {
        const c = CATEGORIES.find((x) => x.key === p.slice(4));
        return c ? categoryCard(c, avail, isAdmin) : null;
      }
      const card = HUB_BY_KEY.get(p);
      return card ? hubCard(card, avail, isAdmin, layout) : null;
    })
    .filter((c): c is HomeCard => c !== null);
}

/* ── THE LISTS ────────────────────────────────────────────────────────────── */

// The curated picks live in lib/home-picks.ts (lib/tool-layout.ts derives
// each item's default "show on Start" switch from them); re-exported so the
// page and the tests keep one import.
export { RAIL, CHIPS, EFFECTS, VIDEO_ROW };

export function railCards(avail: AvailabilityMap, isAdmin = false, layout: ToolsLayout = DEFAULT_LAYOUT): HomeCard[] {
  return resolve(RAIL, avail, isAdmin, layout);
}

export function chipCards(avail: AvailabilityMap, isAdmin = false, layout: ToolsLayout = DEFAULT_LAYOUT): HomeCard[] {
  return resolve(CHIPS, avail, isAdmin, layout);
}

/**
 * "Wybierz efekt": the curated finishes, then every item an admin switched
 * onto Start that no curated row names — appended here, in /tools order, so
 * that switch always puts the item somewhere real. The row is a carousel on a
 * phone and wraps on a wider screen, so a longer list never overflows.
 */
export function effectCards(avail: AvailabilityMap, isAdmin = false, layout: ToolsLayout = DEFAULT_LAYOUT): HomeCard[] {
  return resolve([...EFFECTS, ...startExtras(layout)], avail, isAdmin, layout);
}

export function videoCards(avail: AvailabilityMap, isAdmin = false, layout: ToolsLayout = DEFAULT_LAYOUT): HomeCard[] {
  return resolve(VIDEO_ROW, avail, isAdmin, layout);
}

/**
 * WHERE THE PAGE'S ACTIONS GO. One place, so the upload box, the banner and
 * every "Wypróbuj za darmo" lead through the same doors.
 */
export const HOME_ROUTES = {
  /** The in-page anchor "Zobacz przykłady" scrolls to. */
  examples: "#packshoty",
} as const;

/**
 * WHERE THE PAGE'S PRIMARY ACTIONS GO — the upload box, the samples, the
 * GrovShot button and every "Wypróbuj za darmo".
 *
 * Generator Grovshot (the registry's `generator` card, /prompts) when it is
 * open to this viewer; otherwise the tool hub, when THAT is open — the same
 * fallback the old Start's button had; otherwise nowhere, and the actions are
 * drawn inert like any other closed door. A button on this page never leads
 * into a "Wkrótce" or maintenance screen, and never into a 404.
 */
export function startHref(avail: AvailabilityMap, isAdmin = false): string | null {
  const [generator] = resolve(["generator"], avail, isAdmin);
  if (generator && generator.badge === null) return generator.href;
  if (menuVisible(avail, "/tools", isAdmin) && menuBadge(avail, "/tools") === null) return "/tools";
  return null;
}

/**
 * The route a section's own button should open: the named card's, when that
 * card is open to this viewer, otherwise the page's primary action — where
 * every one of these finishes can be made anyway — or nothing at all.
 */
export function openHref(pick: Pick, avail: AvailabilityMap, isAdmin = false): string | null {
  const [card] = resolve([pick], avail, isAdmin);
  return card && card.badge === null ? card.href : startHref(avail, isAdmin);
}

/** Everything the page draws for one viewer, resolved once. */
export type HomeModel = {
  rail: HomeCard[];
  chips: HomeCard[];
  effects: HomeCard[];
  video: HomeCard[];
  /** The video module's UGC workflow, which the Wideo UGC band advertises —
   *  null when the switchboard has taken video off the menu, and the band
   *  goes with it. Its badge is the band's badge. */
  ugc: HomeCard | null;
  /** The primary action (startHref); null draws the actions inert. */
  startHref: string | null;
  /** Where the Packshoty section's own button goes; null hides it. */
  packshotHref: string | null;
  /** Every media slot the page can paint — the cards' own slots and the
   *  galleries'. The loader asks for exactly these, in one read. */
  slotKeys: string[];
};

export function homeModel(avail: AvailabilityMap, isAdmin = false, layout: ToolsLayout = DEFAULT_LAYOUT): HomeModel {
  const rail = railCards(avail, isAdmin, layout);
  const chips = chipCards(avail, isAdmin, layout);
  const effects = effectCards(avail, isAdmin, layout);
  const video = videoCards(avail, isAdmin, layout);
  const gallery = MEDIA_SLOTS.filter((s) => s.entityType === "section" && s.entityId === "home").map((s) => s.key);
  return {
    rail, chips, effects, video,
    ugc: resolve(["video_ugc"], avail, isAdmin, layout)[0] ?? null,
    startHref: startHref(avail, isAdmin),
    packshotHref: openHref("ecommerce.packshot", avail, isAdmin),
    slotKeys: [...new Set([...rail, ...effects, ...video].map((c) => c.slot).concat(gallery))],
  };
}

/** Convenience for surfaces that have no availability map to hand (tests, the
 *  admin preview): every module at its registry default. */
export function defaultAvailability(): AvailabilityMap {
  return allDefaults();
}

/** Is this destination one the feature switchboard governs at all? Used by the
 *  tests to prove every card on the page is a registered feature and not a
 *  route somebody invented. */
export function isRegisteredDestination(href: string): boolean {
  return featureForHref(href) !== null;
}
