import type { LucideIcon } from "lucide-react";
import { Images, Shirt, ShoppingBag, Sparkles, Wand2, Video } from "lucide-react";
import { CATEGORIES, VIDEO_CREATE_WF, offeredWorkflows, type Category } from "./categories";
import { TOOL_CARDS, WORKFLOW_MOTIF, motifForCategory, type ToolCardDef } from "./tool-cards";
import {
  menuBadge, menuVisible, allDefaults, featureForHref,
  type AvailabilityMap, type MenuBadge,
} from "./features";
import type { ToolMotif } from "@/components/tools/tool-thumb";

/**
 * WHAT THE PRODUCT HOMEPAGE SHOWS — derived, never typed.
 *
 * "/" is the product: the same catalogue the signed-in menu offers, laid out
 * so a stranger can read it. That only works if the catalogue is the SAME
 * catalogue. Everything below is assembled from the three registries the
 * application already runs on —
 *
 *     lib/features.ts     which modules exist and whether they are switched on
 *     lib/categories.ts   the six category workspaces and their workflows
 *     lib/tool-cards.ts   every card the /tools hub draws
 *
 * — so a tool that does not exist cannot appear here, a tool an operator
 * marked "Wkrótce" cannot appear as ready, and a tool added to those files
 * appears here with no edit to this one. A hand-written list on the homepage
 * would be a fourth registry, wrong within a month, and wrong in the one place
 * where being wrong means promising a stranger something the product cannot do.
 *
 * ─── WHY STATE IS ON EVERY CARD ─────────────────────────────────────────────
 *
 * `menuVisible` / `menuBadge` already answer "may a customer see this" and
 * "what does the badge say". They are applied HERE, once, rather than in each
 * of the eight places that render a card, so the page cannot disagree with
 * itself about whether Wideo is ready.
 *
 * A COMING_SOON card is still rendered — the brief for this page is that a
 * visitor gets to see the whole product — but it is rendered inert, badged,
 * and with drawn art rather than a photograph. Which brings us to:
 *
 * ─── WHY ONLY SOME CARDS CARRY A PHOTOGRAPH ─────────────────────────────────
 *
 * components/tools/tool-thumb.tsx states the rule this file obeys: "a stock
 * shot next to 'Usuń tło' would be claiming an output GrovBase did not
 * produce". A photograph on a card is a CLAIM about what comes out of that
 * tool. So a card gets one only when the tool behind it actually runs today;
 * everything else keeps the drawn motif, which states the OPERATION in
 * geometry and claims nothing.
 *
 * The photographs in `public/showcase` were produced for exactly the tool they
 * sit on — a ghost-mannequin shot on the ghost-mannequin card, a relit product
 * on the relight card — and nothing here reuses one picture for two tools.
 */

/** Where a card's picture comes from. */
export type CardArt =
  /** A picture shipped with the build, under public/. */
  | { kind: "photo"; src: string; ratio: "4/5" | "16/9" }
  /** The drawn geometry the tool catalogue already uses. Claims nothing. */
  | { kind: "motif"; motif: ToolMotif };

export type HomeCard = {
  key: string;
  /** The REAL route. Never a placeholder, never a hash. */
  href: string;
  icon: LucideIcon;
  /** Full i18n key of the label. */
  titleKey: string;
  /** Full i18n key of the one-liner, when the card has room for one. */
  subKey?: string;
  art: CardArt;
  /** null = ready. Anything else is rendered as a pill and makes the card
   *  inert: a visitor may look at it and may not open it. */
  badge: MenuBadge;
  /** Whether a signed-out visitor pressing this should be asked to sign in.
   *  True for every destination inside the application, which is all of them —
   *  the routes themselves bounce to /login, and being asked politely on the
   *  homepage is better than being bounced by middleware. */
  gated: boolean;
};

export type HomeSection = {
  key: string;
  /** i18n key of the heading, e.g. "home2.sec.ecommerce". */
  titleKey: string;
  subKey: string;
  icon: LucideIcon;
  /** "Zobacz wszystkie" target — a real route, or null when there is none. */
  seeAll: string | null;
  cards: readonly HomeCard[];
  /** Every card in this section is inert. The section renders, quieter, with
   *  one honest line instead of a "see all" link into a door that is shut. */
  soon: boolean;
};

/* ── THE PHOTOGRAPHS ────────────────────────────────────────────────────────
 *
 * SEVEN FILES, AND THE LIST IS EXHAUSTIVE ON PURPOSE.
 *
 * `public/showcase` holds exactly the examples below. Every other card on this
 * page falls through to its drawn motif, and that is a deliberate floor rather
 * than an unfinished job:
 *
 *   · a motif states the OPERATION in geometry over the brand gradient. It is
 *     the same art the /tools catalogue has always shipped, so a page mixing
 *     the two reads as one system rather than as a page with holes in it.
 *   · a photograph is a CLAIM about output. Borrowing one tool's example for
 *     another tool's card would be exactly the claim components/tools/
 *     tool-thumb.tsx refuses to make, so no file is mapped to two unrelated
 *     keys here. `white_bg` shares the packshot because a white background IS
 *     what that shot is; `shadow` and `ai_shadow` share one because they are
 *     the same operation at two prices.
 *
 * ADDING A PICTURE NEEDS NO CODE. An operator who puts one in the card's media
 * slot (/admin/media, the system migration 0090 already ships) overrides both
 * the photograph and the motif — see components/home/card-art.tsx for the
 * order. That is the intended way this page gains imagery over time.
 */
const SHOT = (name: string, ratio: "4/5" | "16/9" = "4/5"): CardArt =>
  ({ kind: "photo", src: `/showcase/${name}.webp`, ratio });

const PHOTO: Readonly<Record<string, CardArt>> = {
  // E-commerce workflows — the category is ACTIVE, so its outputs are real.
  "ecommerce.packshot": SHOT("ecommerce-packshot"),
  "ecommerce.thumbnail": SHOT("ecommerce-thumbnail"),
  "ecommerce.set": SHOT("ecommerce-set"),
  // Moda — the category is ACTIVE. Its five TOOLS are a separate question and
  // are badged from the registry like everything else.
  "moda.ghostMannequin": SHOT("moda-ghost"),
  ghost_mannequin: SHOT("moda-ghost"),
  // Edit tools that run today.
  white_bg: SHOT("ecommerce-packshot"),
  ai_shadow: SHOT("tool-shadow"),
  shadow: SHOT("tool-shadow"),
  relight: SHOT("tool-relight"),
  // The generator itself.
  generator: SHOT("grovshot-studio"),
};

/**
 * THE THREE FRAMES IN THE BANNER.
 *
 * Three finishes of the same job — a clean studio shot, a family of products,
 * a relit one — which is what the generator's style directives actually
 * change. The labels under them name the finish, not a product, so nothing
 * here claims three frames are three renders of one bottle.
 */
export const GROVSHOT_SHOTS = [
  "/showcase/grovshot-studio.webp",
  "/showcase/ecommerce-set.webp",
  "/showcase/tool-relight.webp",
] as const;

/**
 * The sample thumbnails under the start box. The SAME files the cards use, so
 * a visitor who presses one has already seen that result a moment earlier.
 * Four rather than five: there is no fifth example, and inventing one by
 * repeating a file would make the row look like a rendering bug.
 */
export const SAMPLE_PRODUCTS = [
  "/showcase/ecommerce-packshot.webp",
  "/showcase/tool-relight.webp",
  "/showcase/ecommerce-set.webp",
  "/showcase/moda-ghost.webp",
] as const;

/* ── CARD BUILDERS ────────────────────────────────────────────────────────── */

function art(key: string, motif: ToolMotif, badge: MenuBadge): CardArt {
  // AN INERT CARD NEVER CARRIES A PHOTOGRAPH. The picture would be a promise
  // about output from a module that is not running, which is the one thing a
  // "Wkrótce" badge exists to prevent.
  if (badge !== null) return { kind: "motif", motif };
  return PHOTO[key] ?? { kind: "motif", motif };
}

function workflowCard(c: Category, w: { key: string; icon: LucideIcon; tool?: boolean }, avail: AvailabilityMap): HomeCard {
  // A Moda TOOL has its own feature key and its own switch; a preset inherits
  // the category's. `featureForHref` resolves both through the same route
  // table, so neither needs a special case here.
  const href = w.tool ? `/k/${c.slug}/${w.key}` : `/k/${c.slug}?wf=${w.key}`;
  const badgeHref = w.tool ? href : `/k/${c.slug}`;
  const badge = menuBadge(avail, badgeHref);
  const id = `${c.key}.${w.key}`;
  return {
    key: id,
    href,
    icon: w.icon,
    titleKey: `wf.${c.key}.${w.key}.name`,
    subKey: `wf.${c.key}.${w.key}.sub`,
    art: art(id, WORKFLOW_MOTIF[id] ?? motifForCategory(c.key), badge),
    badge,
    gated: true,
  };
}

function toolCardOf(card: ToolCardDef, avail: AvailabilityMap): HomeCard {
  // `soon` on the catalogue row and the registry's own state are two different
  // facts and BOTH make a card inert: the row says "there is no backend", the
  // registry says "an operator switched it off". Either one is a no.
  const badge: MenuBadge = card.soon ? "soon" : menuBadge(avail, card.href);
  return {
    key: card.key,
    href: card.href,
    icon: card.icon,
    titleKey: card.titleKey,
    subKey: card.bodyKey,
    art: art(card.key, card.motif, badge),
    badge,
    gated: true,
  };
}

/* WORKFLOW_MOTIF and motifForCategory live in lib/tool-cards.ts now: the
 * /tools hub draws the same workflows and must draw them the same way, so the
 * table has one home rather than two copies drifting apart. */

/* ── THE TOP ROW ──────────────────────────────────────────────────────────── */

/**
 * THE DISCOVERY RAIL under the header: the handful of destinations a seller
 * arriving for the first time should see before they scroll.
 *
 * Hand-ordered because it is an EDITORIAL choice — what to lead with — but
 * every entry resolves through the registry below, so an entry whose module is
 * switched off is badged and inert like anywhere else, and one whose module is
 * DISABLED disappears entirely.
 */
const RAIL: readonly { key: string; href: string; icon: LucideIcon; titleKey: string; photo?: string }[] = [
  { key: "generator", href: "/prompts", icon: Sparkles, titleKey: "mega.createImage", photo: "generator" },
  { key: "ghostMannequin", href: "/k/moda/ghostMannequin", icon: Shirt, titleKey: "wf.moda.ghostMannequin.name", photo: "moda.ghostMannequin" },
  { key: "thumbnail", href: "/k/ecommerce", icon: ShoppingBag, titleKey: "wf.ecommerce.thumbnail.name", photo: "ecommerce.thumbnail" },
  { key: "ai_shadow", href: "/tools/ai_shadow", icon: Wand2, titleKey: "tools.ai_shadow.name", photo: "ai_shadow" },
  { key: "moda", href: "/k/moda", icon: Shirt, titleKey: "cats.moda", photo: "moda.onModel" },
  { key: "retouch", href: "/retusz", icon: Images, titleKey: "tools.retouch.name", photo: "retouch" },
  { key: "video", href: "/wideo", icon: Video, titleKey: "video.title" },
] as const;

export function railCards(avail: AvailabilityMap, isAdmin = false): HomeCard[] {
  return RAIL
    .filter((e) => menuVisible(avail, e.href, isAdmin))
    .map((e) => {
      const badge = menuBadge(avail, e.href);
      return {
        key: e.key,
        href: e.href,
        icon: e.icon,
        titleKey: e.titleKey,
        art: art(e.photo ?? e.key, "spark", badge),
        badge,
        gated: true,
      };
    });
}

/* ── THE CATEGORY CHIPS ───────────────────────────────────────────────────── */

/** The quick-start row under the upload box. The six real categories, in
 *  registry order, minus anything an admin has taken off the menu. */
export function categoryChips(avail: AvailabilityMap, isAdmin = false): HomeCard[] {
  return CATEGORIES
    .filter((c) => menuVisible(avail, `/k/${c.slug}`, isAdmin))
    .map((c) => ({
      key: c.key,
      href: `/k/${c.slug}`,
      icon: c.icon,
      titleKey: `cats.${c.key}`,
      subKey: `cats.${c.key}Sub`,
      art: { kind: "motif", motif: motifForCategory(c.key) } as CardArt,
      badge: menuBadge(avail, `/k/${c.slug}`),
      gated: true,
    }));
}

/* ── "WYBIERZ EFEKT" ──────────────────────────────────────────────────────── */

/**
 * The effect grid: what a seller can turn a photograph INTO, pulled from the
 * offered workflows of every category that is on the menu, live ones first.
 *
 * `offeredWorkflows` is what filters the retired Moda presets — reading
 * `category.workflows` directly would put "Na modelce" back on the homepage
 * after the product deliberately withdrew it.
 */
export function effectCards(avail: AvailabilityMap, isAdmin = false, limit = 12): HomeCard[] {
  const cards = CATEGORIES
    .filter((c) => menuVisible(avail, `/k/${c.slug}`, isAdmin))
    .flatMap((c) => offeredWorkflows(c).map((w) => workflowCard(c, w, avail)));
  // Ready first. A grid that opens on four "Wkrótce" tiles describes a product
  // that does not exist yet; the same tiles after the live ones describe one
  // that is growing.
  const ready = cards.filter((c) => c.badge === null);
  const soon = cards.filter((c) => c.badge !== null);
  return [...ready, ...soon].slice(0, limit);
}

/* ── THE SECTIONS ─────────────────────────────────────────────────────────── */

/**
 * The body of the page, in order. Each section is one real part of the
 * product; a section whose every card is inert says so once, in a line, rather
 * than pretending.
 *
 * A section with NO cards at all is dropped — an empty heading is worse than
 * no heading, the same rule `groupHasVisible` applies to the menus.
 */
export function homeSections(avail: AvailabilityMap, isAdmin = false): HomeSection[] {
  const byKey = new Map(TOOL_CARDS.map((c) => [c.key, c]));
  const pick = (keys: readonly string[]): HomeCard[] =>
    keys
      .map((k) => byKey.get(k))
      .filter((c): c is ToolCardDef => Boolean(c))
      .filter((c) => menuVisible(avail, c.href, isAdmin))
      .map((c) => toolCardOf(c, avail));

  const category = (c: Category, icon: LucideIcon): HomeSection => {
    const cards = offeredWorkflows(c).map((w) => workflowCard(c, w, avail));
    return {
      key: c.key,
      titleKey: `cats.${c.key}`,
      subKey: `cats.${c.key}Lead`,
      icon,
      seeAll: `/k/${c.slug}`,
      cards,
      soon: cards.length > 0 && cards.every((x) => x.badge !== null),
    };
  };

  const sections: HomeSection[] = [];

  for (const c of CATEGORIES) {
    if (!menuVisible(avail, `/k/${c.slug}`, isAdmin)) continue;
    // Matching has no engine and no workflows worth a full row of its own; it
    // stays in the chips above rather than claiming a section.
    if (c.key === "matching") continue;
    sections.push(category(c, c.icon));
  }

  // THE PHOTO WORKSHOP — the operations that act on a seller's own file
  // rather than generating a new one. Everything here runs today.
  sections.push({
    key: "workshop",
    titleKey: "home2.sec.workshop",
    subKey: "home2.sec.workshopSub",
    icon: Wand2,
    seeAll: "/tools",
    cards: pick([
      "retouch", "remove_bg", "white_bg", "ai_background", "ai_shadow",
      "relight", "beautify", "upscale", "expand", "watermark",
    ]),
    soon: false,
  });

  // WIDEO — no engine exists. The section is real, the cards are inert, and
  // the line under the heading says so in the product's own words.
  if (menuVisible(avail, "/wideo", isAdmin)) {
    // The MAKING workflows only, exactly as this row has always shown them. The
    // /tools catalogue now also lists the two video-editing entries; this
    // public page is not part of that change.
    const cards = pick(VIDEO_CREATE_WF.map((w) => `video_${w.key}`));
    sections.push({
      key: "video",
      titleKey: "video.title",
      subKey: "video.sub",
      icon: Video,
      seeAll: "/wideo",
      cards,
      soon: true,
    });
  }

  return sections.filter((s) => s.cards.length > 0);
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
