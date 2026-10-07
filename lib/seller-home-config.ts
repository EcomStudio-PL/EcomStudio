/**
 * THE SIGNED-IN START (/home) — ITS PRESENTATION, IN ONE PLACE.
 *
 * Everything /home SAYS and SHOWS lives here: which tasks the hero offers and
 * in what order, the i18n keys of every label, the image slots and the size
 * each picture should be, the before/after gallery, the industries, the
 * coming-soon list, the seller-channel → default-task map and the designer
 * reference prices of the price anchor.
 *
 * WHAT IS DELIBERATELY NOT HERE — each has its own source of truth and /home
 * only reads it:
 *   - what a generation COSTS        → ai_models / service_catalog, through the
 *                                      same helpers the tools use
 *                                      (lib/server/seller-home.ts)
 *   - whether a tool is AVAILABLE    → feature_availability + menuVisible() +
 *                                      the tool's own runtime check
 *   - the price of a credit on PRO   → subscription_plans (slug below)
 *   - the wallet balance             → credit_wallets
 *   - models, prompts, providers     → never touched by /home at all
 *
 * SWAPPING A PICTURE is one line: set `src` (a file in /public, e.g.
 * "/home/hero-allegro-after.webp") on the slot. An empty slot (`null`) renders
 * a quiet placeholder with the slot's name and recommended size. Ship files as
 * WebP (or AVIF) at the recommended size — next/image lazy-loads them with
 * explicit width/height, so nothing jumps.
 *
 * This is NOT /start and NOT "/": those render components/home/product-home.tsx
 * from lib/home-sections.ts, untouched.
 */

/* ── media slots ──────────────────────────────────────────────────────────*/

/** One picture the owner fills in later. `src` null = empty slot. */
export type MediaSrc = {
  /** Stable name of the slot — what the slot list in the report calls it. */
  configKey: string;
  /** A path under /public (or null while the picture is not ready). */
  src: string | null;
  /** Pixel size the file should have; also next/image's width/height. */
  width: number;
  height: number;
};

/** A before/after pair (both sides of one example). */
export type MediaPair = { before: MediaSrc; after: MediaSrc };

const SLOT_4_3 = { width: 1200, height: 900 } as const;
const SLOT_1_1 = { width: 1200, height: 1200 } as const;

const slot = (configKey: string, size: { width: number; height: number }, src: string | null = null): MediaSrc =>
  ({ configKey, src, ...size });
const pair = (base: string, size: { width: number; height: number } = SLOT_4_3): MediaPair => ({
  before: slot(`${base}.before`, size),
  after: slot(`${base}.after`, size),
});

/* ── the four hero tasks ──────────────────────────────────────────────────*/

export type HeroTaskKey = "allegro" | "packshot" | "lifestyle" | "mannequin" | "set";

export type HeroTaskDef = {
  key: HeroTaskKey;
  /**
   * Catalogue item keys (lib/tool-cards.ts `catalogItem`) that can run this
   * task, best first. The first one that is AVAILABLE to the viewer is used —
   * its route, its gate and its price. None available → `replaceWith`.
   */
  items: readonly string[];
  nameKey: string;
  /** One sentence: what the seller gets. */
  effectKey: string;
  /** The countable noun for "ok. N …" — sellerHome.unit.<unit>.one/few/many. */
  unit: "thumbnail" | "packshot" | "lifestyle" | "photo";
  /** A badge on the card ("Najczęściej wybierane"), if any. */
  badgeKey?: string;
  /** The card's before/after pair, 4:3. */
  media: MediaPair;
  /**
   * The request field that would carry "Dodatkowe uwagi", when the target
   * tool's CURRENT contract takes free text from its UI. Null for every task
   * today: the managed generator's `extraInfo` exists in the API but its UI
   * never sends it, and wiring it would change what reaches the model — so
   * the notes box is not shown as an input for these tasks.
   */
  notesField: null;
  /** Shown instead of this task when none of `items` is available. */
  replaceWith?: HeroTaskDef;
};

/** Shown in the 4th slot while the invisible-mannequin tools are not live. */
const SET_TASK: HeroTaskDef = {
  key: "set",
  items: ["ecommerce.set"],
  nameKey: "sellerHome.task.set.name",
  effectKey: "sellerHome.task.set.effect",
  unit: "photo",
  media: pair("homeMedia.hero.set"),
  notesField: null,
};

export const HERO_TASKS: readonly HeroTaskDef[] = [
  {
    key: "allegro",
    items: ["ecommerce.thumbnail"],
    nameKey: "sellerHome.task.allegro.name",
    effectKey: "sellerHome.task.allegro.effect",
    unit: "thumbnail",
    badgeKey: "sellerHome.task.popular",
    media: pair("homeMedia.hero.allegro"),
    notesField: null,
  },
  {
    key: "packshot",
    items: ["ecommerce.packshot"],
    nameKey: "sellerHome.task.packshot.name",
    effectKey: "sellerHome.task.packshot.effect",
    unit: "packshot",
    media: pair("homeMedia.hero.packshot"),
    notesField: null,
  },
  {
    key: "lifestyle",
    items: ["ecommerce.context"],
    nameKey: "sellerHome.task.lifestyle.name",
    effectKey: "sellerHome.task.lifestyle.effect",
    unit: "lifestyle",
    media: pair("homeMedia.hero.lifestyle"),
    notesField: null,
  },
  {
    key: "mannequin",
    // The Moda engine tool first (one model, published prompt), then the
    // edit-provider tool. Neither runs on PROD today, so the slot shows
    // `replaceWith` until an operator switches one on — then it appears by
    // itself, no deploy.
    items: ["moda.ghostMannequin", "ghost_mannequin"],
    nameKey: "sellerHome.task.mannequin.name",
    effectKey: "sellerHome.task.mannequin.effect",
    unit: "photo",
    media: pair("homeMedia.hero.mannequin"),
    notesField: null,
    replaceWith: SET_TASK,
  },
];

/** The task pre-selected for a seller with no recorded channel. */
export const DEFAULT_HERO_TASK: HeroTaskKey = "allegro";

/**
 * Routes whose screen takes the photo chosen on /home. They are rendered by
 * the generator workspace (components/genv3/workspace.tsx), which feeds a
 * handed-over photo into its OWN upload — same validation, same storage path,
 * same price and the same button the seller presses there. Any other route is
 * simply opened, and the photo is added on that screen. Retusz is never one.
 */
export const HANDOFF_ROUTES: readonly string[] = [
  "/k/ecommerce/thumbnail",
  "/k/ecommerce/packshot",
  "/k/ecommerce/context",
  "/k/ecommerce/set",
];

/* ── "Nie masz zdjęcia? Wypróbuj na przykładzie" ──────────────────────────*/

export type SampleDef = { key: string; labelKey: string; media: MediaSrc };

/**
 * Four example PRODUCT PHOTOS (inputs, not results). Empty until the owner
 * adds them — a sample with no file is shown as a placeholder and does
 * nothing. With a file, a click runs exactly what an upload runs.
 */
export const SAMPLES: readonly SampleDef[] = [1, 2, 3, 4].map((i) => ({
  key: `sample${i}`,
  labelKey: `sellerHome.sample.p${i}`,
  media: slot(`homeMedia.example.${i}`, SLOT_1_1),
}));

/* ── before / after gallery ───────────────────────────────────────────────*/

export const INDUSTRIES = ["all", "home_garden", "tools", "beauty", "fashion", "automotive", "pets"] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const industryKey = (i: Industry) => `sellerHome.industry.${i}`;

export type GalleryDef = {
  key: string;
  /** The hero task "Zrób to samo" selects. A card whose task is not
   *  available to the viewer is not shown. */
  task: HeroTaskKey;
  industry: Exclude<Industry, "all">;
  media: MediaPair;
};

export const GALLERY: readonly GalleryDef[] = [
  { key: "g1", task: "allegro", industry: "home_garden", media: pair("homeMedia.gallery.1") },
  { key: "g2", task: "packshot", industry: "beauty", media: pair("homeMedia.gallery.2") },
  { key: "g3", task: "lifestyle", industry: "home_garden", media: pair("homeMedia.gallery.3") },
  { key: "g4", task: "allegro", industry: "tools", media: pair("homeMedia.gallery.4") },
  { key: "g5", task: "packshot", industry: "fashion", media: pair("homeMedia.gallery.5") },
  { key: "g6", task: "allegro", industry: "automotive", media: pair("homeMedia.gallery.6") },
  { key: "g7", task: "lifestyle", industry: "pets", media: pair("homeMedia.gallery.7") },
  { key: "g8", task: "packshot", industry: "tools", media: pair("homeMedia.gallery.8") },
  // Shown only once an invisible-mannequin tool is live.
  { key: "g9", task: "mannequin", industry: "fashion", media: pair("homeMedia.gallery.9") },
];

/** Cards shown at most — the spec asks for 6–8. */
export const GALLERY_MAX = 8;

/* ── price anchor ─────────────────────────────────────────────────────────*/

/** The plan whose credit price the anchor quotes (subscription_plans.slug). */
export const ANCHOR_PLAN_SLUG = "pro";

export type AnchorDef = {
  key: string;
  task: HeroTaskKey;
  /** How many images the comparison is about. */
  images: number;
  /**
   * What a freelance e-commerce designer charges for the same — a market
   * REFERENCE the owner set, not a GrovBase price. In grosze.
   */
  designerCents: number;
  labelKey: string;
};

export const PRICE_ANCHORS: readonly AnchorDef[] = [
  { key: "thumbnail", task: "allegro", images: 1, designerCents: 3000, labelKey: "sellerHome.anchor.thumbnail" },
  { key: "lifestyle5", task: "lifestyle", images: 5, designerCents: 7000, labelKey: "sellerHome.anchor.lifestyle" },
];

/* ── all tools ────────────────────────────────────────────────────────────*/

export type ToolEntryDef = {
  /** Catalogue item key, or `cat:<category>` for a whole category. */
  item: string;
  /** Display name — the spec's names, not necessarily /tools' labels. */
  nameKey: string;
  descKey: string;
  /** The card's picture, 4:3. An admin-filled media slot of the same tool
   *  (Admin → Media) is shown when this is empty. */
  media: MediaSrc;
};

export type ToolGroupDef = { key: string; titleKey: string; tools: readonly ToolEntryDef[] };

const tool = (item: string, name: string, configKey: string): ToolEntryDef => ({
  item,
  nameKey: `sellerHome.tool.${name}.name`,
  descKey: `sellerHome.tool.${name}.desc`,
  media: slot(`homeMedia.tools.${configKey}`, SLOT_4_3),
});

export const TOOL_GROUPS: readonly ToolGroupDef[] = [
  {
    key: "product",
    titleKey: "sellerHome.group.product",
    tools: [
      tool("ecommerce.thumbnail", "thumbnail", "thumbnail"),
      tool("ecommerce.packshot", "packshot", "packshot"),
      tool("white_bg", "whiteBg", "whiteBg"),
      tool("ai_background", "aiBackground", "aiBackground"),
      tool("ai_shadow", "aiShadow", "aiShadow"),
      tool("ecommerce.context", "context", "context"),
      tool("generator", "grovshot", "grovshot"),
      tool("custom", "custom", "custom"),
    ],
  },
  {
    key: "fashion",
    titleKey: "sellerHome.group.fashion",
    tools: [
      tool("moda.ghostMannequin", "mannequin", "mannequin"),
      tool("cat:moda", "moda", "moda"),
    ],
  },
  {
    key: "edit",
    titleKey: "sellerHome.group.edit",
    tools: [tool("retouch", "retouch", "retouch")],
  },
];

/* ── "Nadchodzi" ──────────────────────────────────────────────────────────*/

/** Must match the CHECK on public.feature_interest.feature_key (0135). */
export const INTEREST_KEYS = ["ugc", "video", "ads", "social", "mailing"] as const;
export type InterestKey = (typeof INTEREST_KEYS)[number];
export const isInterestKey = (v: unknown): v is InterestKey =>
  typeof v === "string" && (INTEREST_KEYS as readonly string[]).includes(v);
export const interestLabelKey = (k: InterestKey) => `sellerHome.soon.${k}`;

/* ── "Gdzie sprzedajesz?" ─────────────────────────────────────────────────*/

/** Must match the CHECK on public.profiles.seller_channel (0135). */
export const SELLER_CHANNELS = ["allegro", "amazon", "own_store", "multi"] as const;
export type SellerChannel = (typeof SELLER_CHANNELS)[number];
export const isSellerChannel = (v: unknown): v is SellerChannel =>
  typeof v === "string" && (SELLER_CHANNELS as readonly string[]).includes(v);
export const channelLabelKey = (c: SellerChannel) => `sellerHome.channel.${c}`;

/** Which hero task a seller's channel pre-selects. */
export const CHANNEL_DEFAULT_TASK: Readonly<Record<SellerChannel, HeroTaskKey>> = {
  allegro: "allegro",
  // Amazon's main image is a product on a plain background.
  amazon: "packshot",
  own_store: "lifestyle",
  multi: "allegro",
};

/**
 * The welcome-bonus survey already asks where a seller sells
 * (onboarding_survey_responses, question "sales_channels"). An answer there
 * is reused rather than asked twice; these map its options onto ours.
 */
export const SURVEY_CHANNEL: Readonly<Record<string, SellerChannel>> = {
  allegro: "allegro",
  amazon: "amazon",
  own_store: "own_store",
  shopify: "own_store",
  woocommerce: "own_store",
  etsy: "own_store",
};

/* ── "Ostatnie projekty" ──────────────────────────────────────────────────*/

/** Cards shown at most — the spec asks for 4–6. */
export const RECENT_MAX = 6;
