import type { LucideIcon } from "lucide-react";
import {
  Boxes, Camera, Gift, Grid2X2, Images, LayoutTemplate, Mail, Megaphone, Package,
  PenLine, Percent, Shirt, ShoppingBag, Smartphone, Sparkles, SwatchBook, Tag,
  Users, Video, Clapperboard, Image as ImageIcon, MessageSquareText, Film, Layers,
} from "lucide-react";

/**
 * CATEGORY MODEL — the six customer workspaces (Moda, E-commerce, Social
 * Media, Mailing, Inne, Matching) and the video section.
 *
 * Each category is a REAL destination (`/k/{slug}`) with its own accent, its
 * own set of sub-workflows and its own generator defaults — ratio, shot count
 * and a style directive. Two categories must never open the same form with
 * the same defaults, which is the whole point of having categories at all.
 *
 * Accents are deliberately a narrow family around the brand: violet for
 * fashion, magenta for commerce, coral for social, indigo for mailing, cyan
 * for the catch-all and a warm violet for matching. One hue per category,
 * used for the header wash, the icon tile and the active preset — never a
 * rainbow of unrelated colours inside one screen.
 */

export type CategoryAccent = {
  /** `r g b` triplet, usable inside rgb(var(--cat) / alpha). */
  rgb: string;
  /** Second stop of the header/tile gradient. */
  rgb2: string;
};

export type Workflow = {
  key: string;
  icon: LucideIcon;
  /** Generator defaults this workflow hands to the session form. */
  ratio: "1:1" | "4:5" | "16:9" | "9:16";
  /** Must sit inside the planner's own range (MIN_SHOTS..MAX_SHOTS). Asking
   *  for fewer would quote a batch smaller than the one the server builds. */
  shots: number;
  /** Dictionary key holding the style directive prefilled into the form. */
  styleKey: string;
  soon?: boolean;
};

export type Category = {
  key: string;
  slug: string;
  icon: LucideIcon;
  accent: CategoryAccent;
  workflows: readonly Workflow[];
  /** No engine support yet — the page exists and says so honestly. */
  soon?: boolean;
};

const VIOLET: CategoryAccent = { rgb: "167 139 250", rgb2: "196 181 253" };
const MAGENTA: CategoryAccent = { rgb: "240 60 224", rgb2: "244 114 208" };
const CORAL: CategoryAccent = { rgb: "251 113 133", rgb2: "168 85 247" };
const INDIGO: CategoryAccent = { rgb: "129 140 248", rgb2: "139 92 246" };
const CYAN: CategoryAccent = { rgb: "34 211 238", rgb2: "139 92 246" };
const WARM: CategoryAccent = { rgb: "192 132 252", rgb2: "240 165 216" };

export const CATEGORIES: readonly Category[] = [
  {
    key: "moda", slug: "moda", icon: Shirt, accent: VIOLET,
    workflows: [
      { key: "onModel", icon: Users, ratio: "4:5", shots: 6, styleKey: "wf.moda.onModel.style" },
      { key: "flatlay", icon: Grid2X2, ratio: "1:1", shots: 5, styleKey: "wf.moda.flatlay.style" },
      { key: "street", icon: Camera, ratio: "4:5", shots: 6, styleKey: "wf.moda.street.style" },
      { key: "editorial", icon: Sparkles, ratio: "9:16", shots: 5, styleKey: "wf.moda.editorial.style" },
      { key: "detail", icon: ImageIcon, ratio: "1:1", shots: 5, styleKey: "wf.moda.detail.style" },
    ],
  },
  {
    key: "ecommerce", slug: "ecommerce", icon: ShoppingBag, accent: MAGENTA,
    workflows: [
      { key: "packshot", icon: Package, ratio: "1:1", shots: 5, styleKey: "wf.ecommerce.packshot.style" },
      { key: "thumbnail", icon: Images, ratio: "1:1", shots: 5, styleKey: "wf.ecommerce.thumbnail.style" },
      { key: "context", icon: LayoutTemplate, ratio: "4:5", shots: 6, styleKey: "wf.ecommerce.context.style" },
      { key: "set", icon: Boxes, ratio: "1:1", shots: 8, styleKey: "wf.ecommerce.set.style" },
      { key: "scale", icon: Tag, ratio: "1:1", shots: 5, styleKey: "wf.ecommerce.scale.style" },
    ],
  },
  {
    key: "social", slug: "social", icon: Megaphone, accent: CORAL,
    workflows: [
      { key: "reels", icon: Smartphone, ratio: "9:16", shots: 6, styleKey: "wf.social.reels.style" },
      { key: "feed", icon: Grid2X2, ratio: "4:5", shots: 6, styleKey: "wf.social.feed.style" },
      { key: "ads", icon: Percent, ratio: "1:1", shots: 5, styleKey: "wf.social.ads.style" },
      { key: "ugc", icon: Camera, ratio: "9:16", shots: 6, styleKey: "wf.social.ugc.style" },
      { key: "carousel", icon: Images, ratio: "4:5", shots: 8, styleKey: "wf.social.carousel.style" },
    ],
  },
  {
    key: "mailing", slug: "mailing", icon: Mail, accent: INDIGO,
    workflows: [
      { key: "header", icon: LayoutTemplate, ratio: "16:9", shots: 5, styleKey: "wf.mailing.header.style" },
      { key: "promo", icon: Percent, ratio: "16:9", shots: 5, styleKey: "wf.mailing.promo.style" },
      { key: "newsletter", icon: Mail, ratio: "1:1", shots: 5, styleKey: "wf.mailing.newsletter.style" },
      { key: "seasonal", icon: Gift, ratio: "16:9", shots: 5, styleKey: "wf.mailing.seasonal.style" },
    ],
  },
  {
    key: "inne", slug: "inne", icon: Boxes, accent: CYAN,
    workflows: [
      { key: "label", icon: Tag, ratio: "1:1", shots: 5, styleKey: "wf.inne.label.style" },
      { key: "packaging", icon: Package, ratio: "1:1", shots: 5, styleKey: "wf.inne.packaging.style" },
      { key: "leaflet", icon: LayoutTemplate, ratio: "4:5", shots: 5, styleKey: "wf.inne.leaflet.style" },
      { key: "icons", icon: Grid2X2, ratio: "1:1", shots: 6, styleKey: "wf.inne.icons.style" },
      { key: "free", icon: PenLine, ratio: "16:9", shots: 5, styleKey: "wf.inne.free.style" },
    ],
  },
  {
    key: "matching", slug: "matching", icon: SwatchBook, accent: WARM, soon: true,
    workflows: [
      { key: "fromInspiration", icon: Sparkles, ratio: "4:5", shots: 5, styleKey: "wf.matching.fromInspiration.style", soon: true },
      { key: "brandStyle", icon: SwatchBook, ratio: "1:1", shots: 5, styleKey: "wf.matching.brandStyle.style", soon: true },
      { key: "series", icon: Layers, ratio: "1:1", shots: 6, styleKey: "wf.matching.series.style", soon: true },
    ],
  },
] as const;

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

/** Legacy `?cat=` values used by earlier builds still resolve. */
export function findCategory(slug: string | undefined | null): Category | null {
  if (!slug) return null;
  return CATEGORY_BY_SLUG.get(slug) ?? null;
}

export function categoryHref(c: Category) { return `/k/${c.slug}`; }

/** CSS custom properties a category surface sets once at its root, so every
 *  child can reference rgb(var(--cat)) without prop drilling. */
export function accentVars(a: CategoryAccent): React.CSSProperties {
  return { ["--cat" as string]: a.rgb, ["--cat2" as string]: a.rgb2 };
}

/* ── VIDEO ────────────────────────────────────────────────────────────────
 * The video backend does not exist. The section is built as a real page with
 * a real workspace layout, and every generation entry is disabled with an
 * honest "Wkrótce" — nothing here fakes a generation.
 */
export const VIDEO_ENABLED = false;

export type VideoWorkflow = { key: string; icon: LucideIcon; ratio: string; length: string };

export const VIDEO_CREATE_WF: readonly VideoWorkflow[] = [
  { key: "product", icon: Clapperboard, ratio: "16:9", length: "8 s" },
  { key: "img2vid", icon: ImageIcon, ratio: "16:9", length: "5 s" },
  { key: "social", icon: Megaphone, ratio: "9:16", length: "15 s" },
  { key: "ugc", icon: Smartphone, ratio: "9:16", length: "12 s" },
  { key: "lifestyle", icon: Camera, ratio: "4:5", length: "10 s" },
  { key: "prompt2vid", icon: MessageSquareText, ratio: "16:9", length: "8 s" },
] as const;

export const VIDEO_EDIT_WF: readonly VideoWorkflow[] = [
  { key: "captions", icon: Film, ratio: "9:16", length: "—" },
  { key: "thumbnail", icon: Layers, ratio: "16:9", length: "—" },
] as const;

export const VIDEO_ICON: LucideIcon = Video;

/* ── WORKSPACE VARIANTS ───────────────────────────────────────────────────
 * What actually makes a category a different tool rather than the same form
 * with a new heading.
 *
 * Each variant names the shot presets that make sense for the work, the
 * extra decisions that only that work needs (a fashion shoot chooses a
 * framing, a mailing layout reserves space for copy), and the framings the
 * category leads with. Every one of these feeds the style directive the
 * planner actually reads — none of it is decoration.
 */

/** One extra decision offered by a category, rendered as a chip row. The
 *  chosen option's `directive` is appended to the style the engine gets. */
export type VariantOption = { key: string; directive: string };
export type VariantControl = {
  key: string;
  /** i18n namespace for the label and the option names: `vc.{key}` */
  options: readonly VariantOption[];
  /** Preselected option key, if any. */
  initial?: string;
};

export type CategoryVariant = {
  /** Preset shot types, as `generator.mt.*` keys. */
  shotTypes: readonly string[];
  /** Category-specific controls, in display order. */
  controls: readonly VariantControl[];
  /** Framings this category leads with; the toolbar still filters by model. */
  ratioOrder: readonly string[];
};

const FRAMING: VariantControl = {
  key: "framing",
  initial: "full",
  options: [
    { key: "full", directive: "pełna sylwetka w kadrze" },
    { key: "half", directive: "kadr do pasa" },
    { key: "detail", directive: "kadr detalu, zbliżenie" },
  ],
};

const MODEL_PRESENCE: VariantControl = {
  key: "model",
  initial: "any",
  options: [
    { key: "any", directive: "" },
    { key: "female", directive: "modelka" },
    { key: "male", directive: "model" },
    { key: "none", directive: "bez osoby w kadrze, sam produkt" },
  ],
};

const COPY_SPACE: VariantControl = {
  key: "copy",
  initial: "right",
  options: [
    { key: "left", directive: "wolna przestrzeń na tekst po lewej stronie kadru" },
    { key: "right", directive: "wolna przestrzeń na tekst po prawej stronie kadru" },
    { key: "top", directive: "wolna przestrzeń na tekst u góry kadru" },
    { key: "none", directive: "kompozycja wypełniona, bez miejsca na tekst" },
  ],
};

const PLATFORM: VariantControl = {
  key: "platform",
  initial: "instagram",
  options: [
    { key: "instagram", directive: "kompozycja pod Instagram" },
    { key: "tiktok", directive: "kompozycja pod TikTok" },
    { key: "ads", directive: "kompozycja pod płatną reklamę" },
  ],
};

const MARKETPLACE: VariantControl = {
  key: "marketplace",
  initial: "any",
  options: [
    { key: "any", directive: "" },
    { key: "allegro", directive: "zgodnie z wymogami Allegro: produkt na białym tle, pełna widoczność" },
    { key: "amazon", directive: "zgodnie z wymogami Amazon: czyste białe tło, produkt wypełnia 85% kadru" },
    { key: "shop", directive: "pod własny sklep: spójna estetyka marki" },
  ],
};

const SURFACE: VariantControl = {
  key: "surface",
  initial: "label",
  options: [
    { key: "label", directive: "wizualizacja etykiety na produkcie" },
    { key: "box", directive: "wizualizacja opakowania kartonowego" },
    { key: "print", directive: "materiał drukowany, płaska kompozycja" },
  ],
};

export const CATEGORY_VARIANT: Record<string, CategoryVariant> = {
  ecommerce: {
    shotTypes: ["packshot", "marketplace_gallery", "premium_lifestyle", "product_in_use", "closeup", "scale", "technical"],
    controls: [MARKETPLACE],
    ratioOrder: ["1:1", "4:5", "16:9", "9:16"],
  },
  moda: {
    shotTypes: ["premium_lifestyle", "product_hero", "closeup", "macro_detail", "product_in_use"],
    controls: [MODEL_PRESENCE, FRAMING],
    ratioOrder: ["4:5", "9:16", "1:1", "16:9"],
  },
  social: {
    shotTypes: ["social_ad", "premium_lifestyle", "product_in_use", "benefit", "product_hero"],
    controls: [PLATFORM, COPY_SPACE],
    ratioOrder: ["9:16", "4:5", "1:1", "16:9"],
  },
  mailing: {
    shotTypes: ["product_hero", "benefit", "premium_lifestyle", "packshot"],
    controls: [COPY_SPACE],
    ratioOrder: ["16:9", "1:1", "4:5", "9:16"],
  },
  inne: {
    shotTypes: ["packshot", "closeup", "macro_detail", "technical", "scale"],
    controls: [SURFACE],
    ratioOrder: ["1:1", "4:5", "16:9", "9:16"],
  },
  matching: {
    shotTypes: ["premium_lifestyle", "product_hero", "packshot"],
    controls: [],
    ratioOrder: ["4:5", "1:1", "16:9", "9:16"],
  },
};

/** The default workspace when a generator is opened outside a category. */
export const DEFAULT_VARIANT: CategoryVariant = CATEGORY_VARIANT.ecommerce;
