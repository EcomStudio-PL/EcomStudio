/**
 * THE SIGNED-IN START (/home) — ITS PRESENTATION, IN ONE PLACE.
 *
 * Everything /home SHOWS lives here, section by section, in page order:
 *
 *    1  the tool carousel            CAROUSEL
 *    2  the upload tile              UPLOAD_TOOLS (pills + 5 samples each)
 *    3  before / after               BEFORE_AFTER
 *    4  banner #1                    PROMO_BANNERS.first
 *    5  the showcase                 SHOWCASE
 *    6  banner #2                    PROMO_BANNERS.second
 *    7  Miniaturki                   THUMBNAILS
 *    8  Sesje produktowe             SESSIONS
 *    9  three featured tools         FEATURED
 *   10  banner #3                    PROMO_BANNERS.third
 *   11  Nadchodzi                    INTEREST_KEYS
 *
 * — which tool each element opens (a catalogue item key, lib/tool-cards.ts),
 * the i18n keys of every label, and every picture or clip with the size it
 * should be.
 *
 * WHAT IS DELIBERATELY NOT HERE — each has its own source of truth and /home
 * only reads it (lib/server/seller-home.ts):
 *   - whether a tool is AVAILABLE    → feature_availability, the /tools layout
 *                                      flags and the tool's own runtime check
 *   - what a generation COSTS        → the tool's own price source
 *   - the wallet, the plans, Stripe  → never decided here
 *   - models, prompts, providers     → never touched by /home at all
 *
 * SWAPPING A PICTURE OR A CLIP is one line: set `src` on its slot (a file in
 * /public, e.g. "/home/carousel-thumbnail.webp", or an absolute https URL of
 * the media library). A video slot takes `kind: "video"` plus a `poster`.
 * An empty slot (`src: null`) renders a quiet brand-gradient placeholder with
 * the slot's name and the size the file should be — the page is finished
 * before its pictures are. Ship images as WebP/AVIF at the recommended size;
 * clips as MP4 (H.264), muted, short, with a poster.
 *
 * Tool tiles keep the catalogue's own frame — 2336×1744, the shape of every
 * card picture an admin uploads in Admin → Media (components/tools/
 * tool-thumb.tsx) — and an admin's picture for that tool fills an empty slot.
 *
 * This is NOT /start and NOT "/": those render components/home/product-home.tsx
 * from lib/home-sections.ts, untouched.
 */

/* ── media slots ──────────────────────────────────────────────────────────*/

export type MediaKind = "image" | "video";

/** One picture or clip the owner fills in later. `src` null = empty slot. */
export type MediaSrc = {
  /** Stable name of the slot — what the asset list calls it. */
  configKey: string;
  kind: MediaKind;
  /** The image, or the video file. A path under /public or an https URL. */
  src: string | null;
  /** Optional phone version (max-width 639px) — e.g. a vertical banner. */
  mobileSrc?: string | null;
  /** A video's still: shown before it loads and to reduced-motion viewers. */
  poster?: string | null;
  /** The file's intended size. Also its intrinsic size for next/image. */
  width: number;
  height: number;
  /** object-position — the focus point kept when the frame crops (e.g.
   *  "50% 30%"). Defaults to the centre. */
  position?: string;
  /** Alt text. Empty = decorative (the card's own label names it). */
  alt?: string;
};

/** A before/after pair (both sides of one example). */
export type MediaPair = { before: MediaSrc; after: MediaSrc };

type Size = { width: number; height: number };

/** The catalogue card frame (tool-thumb.tsx PHOTO_THUMB_RATIO). */
export const TOOL_TILE: Size = { width: 2336, height: 1744 };
export const SQUARE: Size = { width: 1080, height: 1080 };
export const PORTRAIT_4_5: Size = { width: 1080, height: 1350 };
export const PORTRAIT_3_4: Size = { width: 1080, height: 1440 };
export const STORY_9_16: Size = { width: 1080, height: 1920 };
export const WIDE_16_9: Size = { width: 1920, height: 1080 };
export const LANDSCAPE_4_3: Size = { width: 1440, height: 1080 };
/** Banner, desktop: about 4.7 : 1. */
export const BANNER_WIDE: Size = { width: 2400, height: 510 };
/** Banner, phone: square. */
export const BANNER_PHONE: Size = { width: 1080, height: 1080 };
/** A sample PRODUCT PHOTO (an input, not a result). */
export const SAMPLE_PHOTO: Size = { width: 1200, height: 1200 };

/** The CSS aspect-ratio of a size ("2336/1744"). */
export const ratioOf = (s: Size): string => `${s.width}/${s.height}`;

const img = (configKey: string, size: Size, src: string | null = null): MediaSrc =>
  ({ configKey, kind: "image", src, ...size });
const vid = (configKey: string, size: Size, src: string | null = null, poster: string | null = null): MediaSrc =>
  ({ configKey, kind: "video", src, poster, ...size });
const pair = (base: string, size: Size): MediaPair => ({
  before: img(`${base}.before`, size),
  after: img(`${base}.after`, size),
});

/* ── shared names ─────────────────────────────────────────────────────────*/

/** Display names / one-liners of the tools (sellerHome.tool.<name>.name/desc). */
const toolName = (name: string) => `sellerHome.tool.${name}.name`;
const toolDesc = (name: string) => `sellerHome.tool.${name}.desc`;

/* ── 1. the tool carousel ─────────────────────────────────────────────────*/

export type CarouselTileDef = {
  /** Catalogue item key (lib/tool-cards.ts), or `cat:<category>`. */
  item: string;
  nameKey: string;
  subKey: string;
  /** 2336×1744. Empty → the admin's card picture of this tool, if any. */
  media: MediaSrc;
};

const tile = (item: string, name: string): CarouselTileDef => ({
  item, nameKey: toolName(name), subKey: toolDesc(name),
  media: img(`homeMedia.carousel.${name}`, TOOL_TILE),
});

/** The order is the carousel's. Reorder, add or remove lines freely. */
export const CAROUSEL: readonly CarouselTileDef[] = [
  tile("ecommerce.thumbnail", "thumbnail"),
  tile("generator", "grovshot"),
  tile("moda.ghostMannequin", "mannequin"),
  tile("retouch", "retouch"),
  tile("ai_background", "aiBackground"),
  tile("ai_shadow", "aiShadow"),
  tile("white_bg", "whiteBg"),
  tile("ecommerce.context", "context"),
  tile("cat:moda", "moda"),
  tile("ecommerce.packshot", "packshot"),
  tile("custom", "custom"),
];

/**
 * The example photographs shipped with the product (public/showcase), shown
 * on a LIVE tool's tile when neither this config nor an admin gave it a
 * picture — the same files the /start page uses for these tools. Never on a
 * tile whose tool is not running: a photo would promise its output.
 */
export const SHIPPED_TOOL_PHOTO: Readonly<Record<string, string>> = {
  "ecommerce.thumbnail": "/showcase/ecommerce-thumbnail.webp",
  "ecommerce.packshot": "/showcase/ecommerce-packshot.webp",
  "ecommerce.set": "/showcase/ecommerce-set.webp",
  white_bg: "/showcase/ecommerce-packshot.webp",
  ai_shadow: "/showcase/tool-shadow.webp",
  generator: "/showcase/grovshot-studio.webp",
  "moda.ghostMannequin": "/showcase/moda-ghost.webp",
};

/* ── 2. the upload tile ───────────────────────────────────────────────────*/

export type UploadToolKey = "retouch" | "thumbnail" | "outdoor";

export type UploadToolDef = {
  key: UploadToolKey;
  /** Catalogue item the pill selects; its real status decides everything. */
  item: string;
  pillKey: string;
  /** The tile's one sentence for this tool. */
  leadKey: string;
  /** Five example PRODUCT PHOTOS (inputs). Empty → placeholders, inert. */
  samples: readonly MediaSrc[];
};

const samples = (tool: UploadToolKey): MediaSrc[] =>
  [1, 2, 3, 4, 5].map((i) => img(`homeMedia.upload.${tool}.sample.${i}`, SAMPLE_PHOTO));

/** Pill order, left to right. */
export const UPLOAD_TOOLS: readonly UploadToolDef[] = [
  { key: "retouch", item: "retouch", pillKey: "sellerHome.pill.retouch", leadKey: "sellerHome.upload.lead.retouch", samples: samples("retouch") },
  { key: "thumbnail", item: "ecommerce.thumbnail", pillKey: "sellerHome.pill.thumbnail", leadKey: "sellerHome.upload.lead.thumbnail", samples: samples("thumbnail") },
  // "Sesja zewnątrz" is the Moda workflow /tools lists under that name
  // (moda.street, hub.name.moda_street) — the managed generator with an
  // outdoor street-style preset.
  { key: "outdoor", item: "moda.street", pillKey: "sellerHome.pill.outdoor", leadKey: "sellerHome.upload.lead.outdoor", samples: samples("outdoor") },
];

export const DEFAULT_UPLOAD_TOOL: UploadToolKey = "thumbnail";

/** The tile's sentence when the selected tool has none of its own. */
export const UPLOAD_LEAD_DEFAULT = "sellerHome.upload.lead.default";

/**
 * Routes whose screen takes the photo chosen on /home. They are rendered by
 * the generator workspace (components/genv3/workspace.tsx), which feeds a
 * handed-over photo into its OWN upload — same validation, same storage path,
 * same price and the same button the seller presses there. Any other route is
 * simply opened, and the photo is added on that screen. Retusz is never one:
 * it is frozen, and nothing is prefilled into it.
 */
export const HANDOFF_ROUTES: readonly string[] = [
  "/k/ecommerce/thumbnail",
  "/k/ecommerce/packshot",
  "/k/ecommerce/context",
  "/k/ecommerce/set",
  "/k/moda/street",
];

/* ── 3. before / after ────────────────────────────────────────────────────*/

/** Industry labels shown under a before/after card. */
export const INDUSTRIES = ["home_garden", "tools", "beauty", "fashion", "automotive", "pets"] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const industryKey = (i: Industry) => `sellerHome.industry.${i}`;

export type BeforeAfterDef = {
  key: string;
  /** The tool the caption opens. */
  item: string;
  nameKey: string;
  industry: Industry;
  media: MediaPair;
};

/** 4:5 portrait — a product photo, not a banner. */
export const BEFORE_AFTER_SIZE = PORTRAIT_4_5;

const ba = (n: number, item: string, name: string, industry: Industry): BeforeAfterDef => ({
  key: `ba${n}`, item, nameKey: toolName(name), industry,
  media: pair(`homeMedia.beforeAfter.${n}`, BEFORE_AFTER_SIZE),
});

export const BEFORE_AFTER: readonly BeforeAfterDef[] = [
  ba(1, "ecommerce.thumbnail", "thumbnail", "home_garden"),
  ba(2, "retouch", "retouch", "beauty"),
  ba(3, "ecommerce.context", "context", "pets"),
  ba(4, "ecommerce.packshot", "packshot", "tools"),
  ba(5, "generator", "grovshot", "fashion"),
  ba(6, "white_bg", "whiteBg", "automotive"),
];

/* ── 4 / 6 / 10. the banners ──────────────────────────────────────────────*/

export type PromoBannerDef = {
  key: string;
  /** The tool the button opens. The button is drawn only while it runs. */
  item: string | null;
  badgeKey: string | null;
  titleKey: string | null;
  subKey: string | null;
  ctaKey: string | null;
  /** Desktop ≈ 4.7:1 (2400×510); `mobileSrc` 1:1 (1080×1080). */
  media: MediaSrc;
  /** Which brand gradient the empty banner wears (0–2). */
  tone: number;
};

const banner = (n: number, item: string, tone: number, kind: MediaKind = "image"): PromoBannerDef => ({
  key: `promo${n}`,
  item,
  badgeKey: `sellerHome.promo.${n}.badge`,
  titleKey: `sellerHome.promo.${n}.title`,
  subKey: `sellerHome.promo.${n}.sub`,
  ctaKey: `sellerHome.promo.${n}.cta`,
  media: kind === "video"
    ? { ...vid(`homeMedia.promo.${n}`, BANNER_WIDE), mobileSrc: null }
    : { ...img(`homeMedia.promo.${n}`, BANNER_WIDE), mobileSrc: null },
  tone,
});

export const PROMO_BANNERS = {
  first: banner(1, "generator", 0, "video"),
  second: banner(2, "custom", 1),
  third: banner(3, "ecommerce.set", 2),
} as const satisfies Record<string, PromoBannerDef>;

/* ── 5. the showcase ──────────────────────────────────────────────────────*/

export type ShowcaseDef = {
  /** The tool it promotes; the button opens it while it runs. */
  item: string;
  ctaKey: string;
  /** The big visual on the left — ideally a short motion clip, 4:5 (the
   *  panel shows it whole-height on a desktop, cropped to 16:10 on a tablet
   *  around `position`, and 4:5 on a phone). */
  visual: MediaSrc;
  /** Twelve results on the right, 3 × 4, 4:3 landscape. */
  gallery: readonly MediaSrc[];
};

export const SHOWCASE: ShowcaseDef = {
  item: "retouch",
  ctaKey: "sellerHome.showcase.cta",
  visual: vid("homeMedia.showcase.visual", PORTRAIT_4_5),
  gallery: Array.from({ length: 12 }, (_, i) => img(`homeMedia.showcase.gallery.${i + 1}`, LANDSCAPE_4_3)),
};

/* ── 7. Miniaturki ────────────────────────────────────────────────────────*/

export type GalleryTileDef = { media: MediaSrc };

/** A masonry rhythm: mostly marketplace squares, some portraits. */
const THUMB_SHAPES: readonly Size[] = [SQUARE, PORTRAIT_4_5, SQUARE, SQUARE, PORTRAIT_4_5];

export const THUMBNAILS = {
  item: "ecommerce.thumbnail",
  titleKey: "sellerHome.thumbs.title",
  subKey: "sellerHome.thumbs.sub",
  tryKey: "sellerHome.thumbs.try",
  ctaKey: "sellerHome.thumbs.cta",
  tiles: Array.from({ length: 20 }, (_, i): GalleryTileDef => ({
    media: img(`homeMedia.thumbnails.${i + 1}`, THUMB_SHAPES[i % THUMB_SHAPES.length]),
  })),
} as const;

/* ── 8. Sesje produktowe ──────────────────────────────────────────────────*/

/** A photo-session rhythm across the five formats a session delivers. */
const SESSION_SHAPES: readonly Size[] = [
  PORTRAIT_4_5, WIDE_16_9, SQUARE, STORY_9_16, PORTRAIT_3_4,
  SQUARE, WIDE_16_9, PORTRAIT_4_5, PORTRAIT_3_4, STORY_9_16,
  SQUARE, PORTRAIT_4_5, WIDE_16_9, PORTRAIT_3_4, SQUARE, STORY_9_16,
];

export const SESSIONS = {
  titleKey: "sellerHome.sessions.title",
  subKey: "sellerHome.sessions.sub",
  /** "Sesja studyjna" → Generator Grovshot, whose default session type is
   *  the advertising one (studio-precision light). */
  studio: { item: "generator", labelKey: "sellerHome.sessions.studio" },
  /** "Sesja plenerowa" → the outdoor session /tools calls "Sesja zewnątrz". */
  outdoor: { item: "moda.street", labelKey: "sellerHome.sessions.outdoor" },
  tiles: SESSION_SHAPES.map((size, i): GalleryTileDef => ({
    media: img(`homeMedia.sessions.${i + 1}`, size),
  })),
} as const;

/* ── 9. three featured tools ──────────────────────────────────────────────*/

export type FeaturedDef = { item: string; nameKey: string; subKey: string; media: MediaSrc };

const featured = (item: string, name: string): FeaturedDef => ({
  item,
  nameKey: `sellerHome.featured.${name}.name`,
  subKey: `sellerHome.featured.${name}.sub`,
  media: img(`homeMedia.featured.${name}`, TOOL_TILE),
});

export const FEATURED: readonly FeaturedDef[] = [
  featured("moda.ghostMannequin", "mannequin"),
  featured("moda.flatlay", "flatlay"),
  featured("moda.iron", "iron"),
];

/* ── section headings ─────────────────────────────────────────────────────*/

export const SECTION_COPY = {
  carousel: "sellerHome.carousel.label",
  beforeAfter: { titleKey: "sellerHome.ba.title", subKey: "sellerHome.ba.sub" },
  featured: { titleKey: "sellerHome.featured.title", subKey: "sellerHome.featured.sub" },
} as const;

/* ── 11. "Nadchodzi" ──────────────────────────────────────────────────────*/

/** Must match the CHECK on public.feature_interest.feature_key (0135). */
export const INTEREST_KEYS = ["ugc", "video", "ads", "social", "mailing"] as const;
export type InterestKey = (typeof INTEREST_KEYS)[number];
export const isInterestKey = (v: unknown): v is InterestKey =>
  typeof v === "string" && (INTEREST_KEYS as readonly string[]).includes(v);
export const interestLabelKey = (k: InterestKey) => `sellerHome.soon.${k}`;
/** The module route each one waits for — once that module is live (no
 *  "Wkrótce" / maintenance / off), it is no longer "coming" and its chip goes. */
export const INTEREST_GATES: Readonly<Record<InterestKey, string>> = {
  ugc: "/wideo",
  video: "/wideo",
  ads: "/k/social",
  social: "/k/social",
  mailing: "/k/mailing",
};

/* ── "Gdzie sprzedajesz?" ─────────────────────────────────────────────────*/

/** Must match the CHECK on public.profiles.seller_channel (0135). */
export const SELLER_CHANNELS = ["allegro", "amazon", "own_store", "multi"] as const;
export type SellerChannel = (typeof SELLER_CHANNELS)[number];
export const isSellerChannel = (v: unknown): v is SellerChannel =>
  typeof v === "string" && (SELLER_CHANNELS as readonly string[]).includes(v);
export const channelLabelKey = (c: SellerChannel) => `sellerHome.channel.${c}`;

/** Which upload pill a seller's channel pre-selects. */
export const CHANNEL_DEFAULT_TOOL: Readonly<Record<SellerChannel, UploadToolKey>> = {
  allegro: "thumbnail",
  amazon: "thumbnail",
  own_store: "outdoor",
  multi: "thumbnail",
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

/* ── the asset list ───────────────────────────────────────────────────────*/

export type AssetRow = { section: string; media: MediaSrc };

/** Every slot on the page, in page order — what the owner fills in. */
export function assetList(): AssetRow[] {
  const rows: AssetRow[] = [];
  const add = (section: string, list: readonly MediaSrc[]) => list.forEach((media) => rows.push({ section, media }));
  add("1 Karuzela narzędzi", CAROUSEL.map((c) => c.media));
  UPLOAD_TOOLS.forEach((u) => add(`2 Upload — przykłady (${u.key})`, u.samples));
  add("3 Przed / po", BEFORE_AFTER.flatMap((b) => [b.media.before, b.media.after]));
  add("4 Baner #1", [PROMO_BANNERS.first.media]);
  add("5 Showcase", [SHOWCASE.visual, ...SHOWCASE.gallery]);
  add("6 Baner #2", [PROMO_BANNERS.second.media]);
  add("7 Miniaturki", THUMBNAILS.tiles.map((t) => t.media));
  add("8 Sesje produktowe", SESSIONS.tiles.map((t) => t.media));
  add("9 Wyróżnione narzędzia", FEATURED.map((f) => f.media));
  add("10 Baner #3", [PROMO_BANNERS.third.media]);
  return rows;
}
