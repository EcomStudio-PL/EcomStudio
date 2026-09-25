import { VIDEO_CREATE_WF } from "./categories";

/**
 * THE START PAGE'S CURATED PICKS — which items lead the page, which sit as
 * chips under the upload box, which are the "Wybierz efekt" finishes and what
 * the video row holds. Keys only: every card is resolved from the registries
 * by lib/home-sections.ts.
 *
 * A module of its own, with nothing but data in it, because two modules need
 * these lists and one of them is needed by the other: lib/home-sections.ts
 * draws them, and lib/tool-layout.ts derives each item's default "show on
 * Start" flag from them. Kept here, neither has to import the other.
 *
 * `cat:<key>` picks are category cards, governed by the category's switch;
 * every other pick is a catalogue item (lib/tool-cards.ts CATALOG_ITEMS).
 */
export type Pick = string;

/**
 * THE TOP RAIL — six destinations a seller should see before they scroll.
 * Wideo UGC leads, as the reference layout has it; it has no engine yet, so it
 * leads badged and inert rather than being dropped or faked. "Niewidzialny
 * manekin" is the running edit tool, not the Moda workflow of the same name
 * that is still "Wkrótce".
 */
export const RAIL: readonly Pick[] = [
  "video_ugc", "generator", "ghost_mannequin", "ecommerce.thumbnail", "ai_shadow", "cat:moda",
];

/**
 * THE QUICK CHIPS under the upload box. "Lifestyle" in the reference is the
 * E-commerce workflow that puts a product in its natural surroundings, and it
 * keeps its own name ("W kontekście") — a chip must say what it opens.
 */
export const CHIPS: readonly Pick[] = [
  "white_bg", "ecommerce.packshot", "ecommerce.context", "ecommerce.thumbnail",
  "video_ugc", "cat:social", "cat:moda", "cat:mailing",
];

/** "WYBIERZ EFEKT" — eight finishes, one row on a desktop. */
export const EFFECTS: readonly Pick[] = [
  "white_bg", "ai_background", "ai_shadow", "ecommerce.context",
  "ghost_mannequin", "cat:moda", "video_ugc", "social.ads",
];

/** The last row: the video workflows, exactly the making half the video menu
 *  and /wideo list. No engine exists, so every card is badged. */
export const VIDEO_ROW: readonly Pick[] = VIDEO_CREATE_WF.map((w) => `video_${w.key}`);

/** Every catalogue item the curated rows name (category cards excluded). */
export const START_PICKED_ITEMS: readonly string[] = [
  ...new Set([...RAIL, ...CHIPS, ...EFFECTS, ...VIDEO_ROW].filter((p) => !p.startsWith("cat:"))),
];
