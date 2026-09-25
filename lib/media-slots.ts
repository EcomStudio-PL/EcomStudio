import { CATEGORIES, offeredWorkflows } from "./categories";
import { TOOL_CARDS } from "./tool-cards";

/**
 * EVERY PLACE IN GROVBASE WHERE AN ADMIN MAY PUT A PICTURE.
 *
 * A "slot" is one named position in the interface — the Moda card on the
 * dashboard, the hero of the Retusz tool, the promo banner above the tool
 * catalogue. The admin fills a slot; the interface renders whatever is in it,
 * and falls back to what it drew before if the slot is empty.
 *
 * THE LIST IS DERIVED, NOT TYPED. Categories come from lib/categories.ts and
 * tools from FEATURE_REGISTRY — the same two registries the product itself
 * runs on. A category added there gains its slots here with no edit, and a
 * tool withdrawn there loses them. A hand-maintained list would be a third
 * registry to keep in step with the other two, and it would be wrong within a
 * month.
 *
 * WHAT IS DELIBERATELY NOT A SLOT. Two kinds of visual are excluded because a
 * photograph there would be a downgrade, not a feature:
 *
 *   · the TOOL CATALOGUE MOTIFS (components/tools/tool-thumb.tsx) are drawn
 *     geometry — a diagonal wipe for a before/after, a checkerboard for a
 *     cut-out. They state the OPERATION. A stock photo beside "Usuń tło"
 *     would claim an output GrovBase did not produce. The motif therefore
 *     stays as the fallback and the slot is offered as an OPTIONAL override,
 *     not as an empty box demanding to be filled.
 *   · the lucide ICONS on category chips and menu rows. They are 17px. There
 *     is no picture that works at 17px that an icon does not already do
 *     better, so they have no slot at all.
 *
 * KEY SHAPE: `<surface>.<entity-id>.<slot>`, dot-separated. The middle segment
 * is the registry key of the thing it points at, VERBATIM — which means it is
 * camelCase wherever that registry is (`category.moda.workflow.ghostMannequin
 * .card`). Lowercasing it would be prettier and would break the only property
 * that matters: the key is a stable identifier that survives a rename of the
 * thing it names, because it is built from `key` values and never from display
 * names, and it must map back to those keys without a translation table.
 */

export type SlotEntity = "category" | "workflow" | "tool" | "banner" | "section" | "global";

/** Which shape the slot is painted in, so the admin preview and the renderer
 *  agree without either guessing. */
export type SlotRatio = "5/4" | "16/10" | "16/9" | "4/3" | "4/5" | "1/1" | "3/1" | "21/9";

export type SlotDef = {
  key: string;
  entityType: SlotEntity;
  entityId: string;
  slotName: string;
  /** i18n key of the human name shown in the admin. */
  labelKey: string;
  /** Values for the label's placeholders — the tile number in a gallery, so
   *  twelve slots of one gallery read as twelve places rather than one name
   *  repeated. Absent for every slot that is the only one of its kind. */
  labelVars?: Record<string, string | number>;
  /** The aspect ratio the surface actually paints it at. */
  ratio: SlotRatio;
  /** Whether a video makes sense here. A 96px avatar does not want one. */
  video: boolean;
  /** What the interface draws when the slot is empty, in words, so the admin
   *  knows what they are replacing before they replace it. */
  fallbackKey: string;
};

const slot = (
  key: string, entityType: SlotEntity, entityId: string, slotName: string,
  labelKey: string, ratio: SlotRatio, video: boolean, fallbackKey: string,
  labelVars?: Record<string, string | number>,
): SlotDef => ({
  key, entityType, entityId, slotName, labelKey, ratio, video, fallbackKey,
  ...(labelVars ? { labelVars } : {}),
});

/* ── CATEGORIES ──────────────────────────────────────────────────────────
 *
 * A category's own pictures: its card, and its hero. These are the ONLY slots
 * the admin's Kategorie tab lists — a category is not a tool, and its tools'
 * pictures are on the Narzędzia tab.
 *
 * The keys are the ones they always had, including `dashboard.` on the card:
 * a key is an identifier, not a description, and renaming it would orphan
 * whatever an operator already put there.
 *
 * WHERE THEY ARE PAINTED NOW — stated plainly, because it changed. The card
 * used to be the dashboard's category tile and the hero the header of the
 * category's own page (/k/<key>). Both surfaces were retired when the
 * categories became sections of /tools: the dashboard lost its category grid
 * and /k/<key> forwards to the hub. Today the card is painted by the Home /
 * Start (components/home/product-home.tsx — /home, /start, and "/" when the
 * CMS flags it) wherever a category is one of its cards: the top rail and
 * "Wybierz efekt". The hero is painted by nothing. The slots
 * are KEPT regardless — they are the category's pictures, an operator may
 * already have set them, and dropping a declared slot would hide its row from
 * the admin. Where a category's picture should appear inside the hub is a
 * design decision of its own, not something this registry should guess.
 */
const CATEGORY_SLOTS: SlotDef[] = CATEGORIES.flatMap((c) => [
  slot(categorySlotKey(c.key), "category", c.key, "card",
    "media.slot.categoryCard", "5/4", true, "media.fb.ownWork"),
  slot(categoryHeroKey(c.key), "category", c.key, "hero",
    "media.slot.categoryHero", "21/9", true, "media.fb.gradient"),
]);

/** The category's card and its hero. Both exported so the surfaces ask for
 *  the keys this file declares rather than spelling them out and drifting. */
export function categorySlotKey(categoryKey: string): string {
  return `dashboard.category.${categoryKey}.card`;
}

export function categoryHeroKey(categoryKey: string): string {
  return `category.${categoryKey}.hero`;
}

/* ── WORKFLOWS INSIDE A CATEGORY ─────────────────────────────────────────
 *
 * Only the ones the category actually OFFERS. `offeredWorkflows` already
 * filters the hidden ones — a workflow kept in the file but withdrawn from the
 * product must not acquire an admin screen.
 *
 * A workflow is a TOOL — Niewidzialny manekin, Packshot — that happens to
 * belong to a category. Its slot is therefore listed on the admin's Narzędzia
 * tab, next to the other tools, and never on Kategorie. The `workflow` entity
 * type and the key shape stay exactly as they were: rows already written under
 * these keys keep their pictures, and nothing has to be migrated.
 */
const WORKFLOW_SLOTS: SlotDef[] = CATEGORIES.flatMap((c) =>
  offeredWorkflows(c).map((w) =>
    // 5/4, the shape every tool thumbnail is painted at (TOOL_THUMB_RATIO in
    // components/tools/tool-thumb.tsx) — the same as every other tool's. The
    // workflow's own ratio chip says what the OUTPUT will be, which is a
    // different thing from the size of the thumbnail.
    slot(workflowSlotKey(c.key, w.key), "workflow", `${c.key}.${w.key}`, "card",
      "media.slot.workflowCard", "5/4", false, "media.fb.motif")));

export function workflowSlotKey(categoryKey: string, workflowKey: string): string {
  return `category.${categoryKey}.workflow.${workflowKey}.card`;
}

/* ── TOOLS ───────────────────────────────────────────────────────────────
 *
 * ONE SLOT PER CARD THE CATALOGUE ACTUALLY DRAWS, from lib/tool-cards.ts.
 *
 * Not from FEATURE_REGISTRY, which was the first attempt and was wrong: that
 * registry's keys are MODULES, and six distinct tools (Tło AI, Przeoświetlenie,
 * Cień AI, Upiększanie, Odkadrowanie, Manekin-duch) all live behind the single
 * `tools` key. Deriving from it produced slots for things the catalogue never
 * paints and no slot at all for six things it does.
 *
 * ONLY `.card`. A tool's catalogue thumbnail is a real surface that a picture
 * can replace. A "hero" and an "empty state" are NOT offered, because most
 * tool pages have neither — /tools/resize deliberately has no hero and the
 * empty states are per-workbench icons. Offering a slot that nothing renders
 * would be a control that silently does nothing, which is worse than not
 * having it.
 */
const TOOL_SLOTS: SlotDef[] = TOOL_CARDS
  .map((c) => slot(toolSlotKey(c.key), "tool", c.key, "card",
    "media.slot.toolCard", "5/4", false, "media.fb.motif"));

/** The key of a catalogue card's picture. Exported so the catalogue asks for
 *  exactly the keys this file declares, rather than spelling them itself. */
export function toolSlotKey(cardKey: string): string {
  return `tools.${cardKey}.card`;
}

/* ── THE HOME / START PAGE ───────────────────────────────────────────────
 *
 * The showcase parts of the shared Home (components/home/product-home.tsx):
 * the GrovShot banner's art, the Packshoty gallery, the Wideo UGC banner and
 * its three clips, and the Reklamy i Social gallery. Its CARDS — the rail,
 * the chips, "Wybierz efekt" — are not here: each of those is a tool, a
 * workflow or a category, and wears that thing's own slot, so one picture
 * dresses it on the Home and in /tools alike.
 *
 * Every one of these starts EMPTY and stays empty until an operator fills it.
 * The page draws the neutral motif in the meantime — never a borrowed photo —
 * because a gallery of pictures GrovBase did not make would be a claim about
 * output, and these galleries exist to show output.
 *
 * The gallery shapes are the shapes the page paints, so the admin crop preview
 * and the live tile agree: square packshots over wide ones, tall adverts, and
 * portrait clips in the UGC banner. Two are approximate by nature, and the
 * admin is told so by nothing better than this note — so, plainly:
 *   · the two BANNER ARTS are backgrounds, cover-cropped to a band whose
 *     height follows its copy: very wide on a desktop (about 6:1), close to
 *     square on a phone. 3/1 is the middle of that range; a picture meant for
 *     phones belongs in the slot's own mobile override.
 *   · the two stacked Reklamy cards take their height from the creatives
 *     beside them — about 2:1 on a desktop, 5:3 below it. 16/9 is between.
 */
export const HOME_SLOT = {
  grovshotArt: "home.grovshot.art",
  ugcArt: "home.ugc.art",
  packshot: (n: number) => `home.packshots.${n}.media`,
  ugc: (n: number) => `home.ugc.${n}.media`,
  ad: (n: number) => `home.ads.${n}.media`,
} as const;

/** How many tiles each gallery has. The page and the registry read the same
 *  numbers, so a tile can never exist without a slot or the other way round. */
export const HOME_GALLERY = {
  /** Squares, then the same number of wide frames under them. */
  packshotSquares: 6,
  packshotWide: 6,
  ugcClips: 3,
  /** Tall creatives, then the two wide cards stacked beside them. */
  adsTall: 5,
  adsWide: 2,
} as const;

function homeSlots(): SlotDef[] {
  const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  const g = HOME_GALLERY;
  return [
    slot(HOME_SLOT.grovshotArt, "section", "home", "grovshot",
      "media.slot.homeGrovshotArt", "3/1", true, "media.fb.homeBanner"),
    ...range(1, g.packshotSquares).map((n) => slot(HOME_SLOT.packshot(n), "section", "home",
      `packshot${n}`, "media.slot.homePackshot", "1/1", true, "media.fb.motif", { n })),
    ...range(g.packshotSquares + 1, g.packshotWide).map((n) => slot(HOME_SLOT.packshot(n), "section", "home",
      `packshot${n}`, "media.slot.homePackshot", "16/10", true, "media.fb.motif", { n })),
    slot(HOME_SLOT.ugcArt, "section", "home", "ugc",
      "media.slot.homeUgcArt", "3/1", true, "media.fb.homeBanner"),
    ...range(1, g.ugcClips).map((n) => slot(HOME_SLOT.ugc(n), "section", "home",
      `ugc${n}`, "media.slot.homeUgcClip", "4/5", true, "media.fb.motif", { n })),
    ...range(1, g.adsTall).map((n) => slot(HOME_SLOT.ad(n), "section", "home",
      `ad${n}`, "media.slot.homeAd", "4/5", true, "media.fb.motif", { n })),
    ...range(g.adsTall + 1, g.adsWide).map((n) => slot(HOME_SLOT.ad(n), "section", "home",
      `ad${n}`, "media.slot.homeAd", "16/9", true, "media.fb.motif", { n })),
  ];
}

/* ── APPLICATION SECTIONS ────────────────────────────────────────────────
 *
 * Named places that belong to no single tool. The generator's two session
 * previews are here because they ALREADY WORK this way — app_settings
 * .generator_ui holds a URL per slot and an admin swaps it from /admin/system
 * (lib/server/generator-ui.ts). Bringing them in means one mechanism instead
 * of two; the old setting is read as the fallback, so nothing breaks on the
 * day this ships and nothing has to be migrated by hand.
 */
const SECTION_SLOTS: SlotDef[] = [
  // `dashboard.hero.art` USED TO BE FIRST HERE: the illustration beside the
  // old dashboard's greeting. That dashboard is gone — the signed-in Start is
  // the shared Home now (components/home/product-home.tsx) — so nothing paints
  // the slot, and a slot nothing paints is a control that silently does
  // nothing. No row was ever written under it (neither database has one), so
  // retiring it loses no picture.
  slot("generator.session.advertising.preview", "section", "generator", "advertising",
    "media.slot.sessionAdvertising", "16/10", true, "media.fb.generatorUi"),
  slot("generator.session.lifestyle.preview", "section", "generator", "lifestyle",
    "media.slot.sessionLifestyle", "16/10", true, "media.fb.generatorUi"),
  // NOT HERE, ON PURPOSE:
  //   · the ONBOARDING welcome modal already takes a picture from this same
  //     library, set at /admin/settings/onboarding. A second control for the
  //     same image would be the two-systems problem this feature exists to
  //     avoid.
  //   · the LIBRARY's empty shelf is three different sentences about three
  //     different situations (no work yet, no favourites, no videos) and has
  //     no picture to replace. One slot could not tell them apart.
  ...homeSlots(),
];

/* ── BANNERS ─────────────────────────────────────────────────────────────
 *
 * A banner is a row in `app_banners` — it has a link, a schedule and an order,
 * which a slot does not. Its PICTURE is a slot like any other, so there is one
 * media pipeline rather than a second uploader bolted onto the banner editor.
 * These keys are generated per banner, not fixed, so they live in a helper
 * rather than in the list above.
 */
export function bannerSlotKey(bannerKey: string): string {
  return `banner.${bannerKey}.media`;
}

export function bannerSlotDef(bannerKey: string): SlotDef {
  return slot(bannerSlotKey(bannerKey), "banner", bannerKey, "media",
    "media.slot.bannerMedia", "3/1", true, "media.fb.none");
}

/* ── THE REGISTRY ────────────────────────────────────────────────────────── */

export const MEDIA_SLOTS: SlotDef[] = [
  ...CATEGORY_SLOTS,
  ...WORKFLOW_SLOTS,
  ...TOOL_SLOTS,
  ...SECTION_SLOTS,
];

const BY_KEY = new Map(MEDIA_SLOTS.map((s) => [s.key, s]));

export function slotDef(key: string): SlotDef | undefined {
  return BY_KEY.get(key) ?? (key.startsWith("banner.") && key.endsWith(".media")
    ? bannerSlotDef(key.slice("banner.".length, -".media".length))
    : undefined);
}

/** Is this a key the product actually declares? The admin may only write to a
 *  slot that exists, so a stale bookmark or a typed URL cannot create one. */
export function isKnownSlot(key: string): boolean {
  return slotDef(key) !== undefined;
}

/** Every slot belonging to one entity, in the order the admin screen shows
 *  them. `tools.retouch.card` before `.hero` before `.empty`. */
export function slotsFor(entityType: SlotEntity, entityId: string): SlotDef[] {
  return MEDIA_SLOTS.filter((s) => s.entityType === entityType && s.entityId === entityId);
}

/** The distinct entities of one type, for the admin's list screens. */
export function entitiesOf(entityType: SlotEntity): string[] {
  const seen = new Set<string>();
  for (const s of MEDIA_SLOTS) if (s.entityType === entityType) seen.add(s.entityId);
  return [...seen];
}

/* ── VALUES AN ADMIN MAY CHOOSE ──────────────────────────────────────────
 *
 * Closed lists, like the CMS style presets: what an operator picks becomes a
 * CSS value, so it must never be free text. `object-position` in particular is
 * a property that accepts almost anything, including things that are not
 * positions at all.
 */
export const OBJECT_FITS = ["cover", "contain"] as const;
export type ObjectFit = (typeof OBJECT_FITS)[number];

/** The nine cells of the position picker, in reading order. */
export const OBJECT_POSITIONS = [
  "left top", "center top", "right top",
  "left center", "center center", "right center",
  "left bottom", "center bottom", "right bottom",
] as const;
export type ObjectPosition = (typeof OBJECT_POSITIONS)[number];

export const isObjectFit = (v: unknown): v is ObjectFit =>
  typeof v === "string" && (OBJECT_FITS as readonly string[]).includes(v);

export const isObjectPosition = (v: unknown): v is ObjectPosition =>
  typeof v === "string" && (OBJECT_POSITIONS as readonly string[]).includes(v);

export type SlotMediaType = "image" | "video";
export const isSlotMediaType = (v: unknown): v is SlotMediaType =>
  v === "image" || v === "video";
