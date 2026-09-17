/** Structured CMS content. Blocks hold ONLY structured data (no raw HTML),
 *  so nothing executable can be injected through the CMS. Text is localized
 *  per field with PL fallback. */

export type LocaleText = { pl?: string; en?: string; de?: string };

export type CmsItem = {
  title?: LocaleText;
  description?: LocaleText;
  mediaUrl?: string;
  /** Second image — the "after" of a comparison row, or a card's hover art. */
  media2Url?: string;
  url?: string;
  value?: string;
  /** Localized alternative text for mediaUrl. */
  alt?: LocaleText;
  /** A small pill on a card: "Nowość", "Wkrótce", "Popularne". */
  badge?: LocaleText;
  /** Lucide icon name, matched against the small allowlist in cms-icons.ts. */
  icon?: string;
};

export type CmsBlockContent = {
  badge?: LocaleText;
  title?: LocaleText;
  subtitle?: LocaleText;
  description?: LocaleText;
  ctaLabel?: LocaleText;
  ctaUrl?: string;
  cta2Label?: LocaleText;
  cta2Url?: string;
  mediaUrl?: string;
  media2Url?: string;
  posterUrl?: string;
  /** Alternative text for mediaUrl — localized, because a screen reader
   *  should hear the visitor's own language. */
  alt?: LocaleText;
  alignment?: "left" | "right" | "center";
  items?: CmsItem[];
  /** Rich text: a very small, sanitized subset of HTML (headings, lists,
   *  links, bold, tables) — never a script and never a style attribute. */
  html?: LocaleText;
  /** contact_form / newsletter: which approved handler receives the post.
   *  An arbitrary URL is not accepted; see lib/cms-forms.ts. */
  formHandler?: string;
  /** Categories the tools_grid / models section limits itself to. Empty
   *  means "everything the registry knows". */
  filter?: string[];
  /** spacer: how much air, in the same vocabulary as the style presets. */
  size?: Space;

  /* ── CONVERSION ────────────────────────────────────────────────────────
   *
   * A countdown, a price and a bonus are the difference between a page that
   * describes an offer and a page that sells one. Every one of them is a
   * value an admin types — there is no invented scarcity here: no fake
   * viewer counts, no "3 people are looking at this", no timer that resets
   * itself when it runs out. A deadline that has passed says so.
   */

  /** An absolute instant (ISO 8601). The admin picks a local date and time;
   *  it is stored as the moment it refers to, so a visitor in another
   *  timezone sees the same deadline rather than a different one. */
  deadline?: string;
  /** What the section says once `deadline` is behind us. Empty means the
   *  section hides itself when the offer ends, which is the honest default. */
  endedLabel?: LocaleText;
  /** The offer's price, exactly as it should read: "999 zł", "2× kredyty". */
  price?: LocaleText;
  /** The price it replaces, shown struck through. */
  oldPrice?: LocaleText;
  /** The small print under a price: "jednorazowo", "za 1000 kredytów". */
  priceNote?: LocaleText;
  /**
   * Open bag for section types whose fields are their own vocabulary rather
   * than the shared title/subtitle/cta shape — today only the launch page,
   * whose 30-odd labelled fields would otherwise each need a column here.
   */
  fields?: Record<string, LocaleText>;
};

/* ── STYLE AND RESPONSIVE ────────────────────────────────────────────────
 *
 * A section is authored once and has to read well from 320 to 1920. Rather
 * than a second copy of the page per device, every section carries a small
 * set of presentation choices with an optional override per breakpoint.
 *
 * The values are DELIBERATELY AN ENUM, not free CSS: an admin picks "duży
 * odstęp", not "padding-top: 87px". That is what keeps thirty sections looking
 * like one site, and it is why `custom_code` exists for the rare case that
 * genuinely needs its own CSS.
 */

export type Space = "none" | "xs" | "sm" | "md" | "lg" | "xl";
export type Background = "none" | "surface" | "sunken" | "soft" | "gradient";
export type Width = "narrow" | "normal" | "wide" | "full";

export type StyleValues = {
  paddingTop?: Space;
  paddingBottom?: Space;
  align?: "left" | "center" | "right";
  background?: Background;
  width?: Width;
  /** Grid columns for the section types that show a list of things. */
  columns?: number;
  /** Rounded + bordered card around the whole section. */
  panel?: boolean;
};

/** Which breakpoint an override applies to. `base` is desktop and the value
 *  everything else falls back to. */
export type Breakpoint = "base" | "tablet" | "mobile";

export type SectionStyle = {
  base?: StyleValues;
  tablet?: StyleValues;
  mobile?: StyleValues;
  /** Per-device visibility. A hidden section still exists and still publishes;
   *  it simply is not painted at that width. */
  hide?: { desktop?: boolean; tablet?: boolean; mobile?: boolean };
};

/* ── CUSTOM CODE ─────────────────────────────────────────────────────────── */

export type CmsCode = {
  html?: string;
  css?: string;
  js?: string;
  /**
   * OFF UNLESS SOMEBODY ASKS. A block that runs script is rendered inside a
   * sandboxed iframe with no same-origin access — it cannot read the session,
   * the storage, the admin panel or the rest of the page. With this false (the
   * default) the HTML and the CSS are inlined into the page instead, which is
   * faster, indexable, and cannot execute anything at all.
   */
  jsEnabled?: boolean;
};

export type CmsBlock = {
  /** Present on a saved block; the wrapper uses it to scope custom CSS. */
  id?: string;
  type: string;
  sort_order: number;
  visible: boolean;
  content: CmsBlockContent;
  style?: SectionStyle;
  code?: CmsCode;
  /** Event name reported to analytics, e.g. homepage.hero.generate_click. */
  analytics_id?: string | null;
  /** #anchor, for in-page navigation and the legal table of contents. */
  anchor?: string | null;

  /* ── WHEN, AND FOR WHOM ──────────────────────────────────────────────
   *
   * A promo banner that runs 17–20 September, and a "załóż konto" block
   * that a signed-in visitor should never be shown. Both are decided on
   * the SERVER: a section outside its window or its audience is not
   * rendered at all, rather than rendered and hidden with CSS, so it never
   * reaches the browser and cannot be read out of the markup.
   */
  /** ISO instant, inclusive. Null means "from the beginning". */
  show_from?: string | null;
  /** ISO instant, exclusive. Null means "forever". */
  show_until?: string | null;
  /** everyone | anon | user. */
  audience?: string | null;
};

/** Is this section within its own window, for this visitor, right now? */
export function sectionIsLive(
  block: Pick<CmsBlock, "show_from" | "show_until" | "audience">,
  opts: { now?: number; signedIn?: boolean } = {},
): boolean {
  const now = opts.now ?? Date.now();
  const from = block.show_from ? Date.parse(block.show_from) : NaN;
  const until = block.show_until ? Date.parse(block.show_until) : NaN;
  if (Number.isFinite(from) && now < from) return false;
  if (Number.isFinite(until) && now >= until) return false;
  const audience = block.audience ?? "everyone";
  if (audience === "anon" && opts.signedIn) return false;
  if (audience === "user" && !opts.signedIn) return false;
  return true;
}

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export type SeoText = { title?: string; description?: string; ogTitle?: string; ogDescription?: string };

export type PageSeo = {
  pl?: SeoText;
  en?: SeoText;
  de?: SeoText;
  ogImage?: string;
  canonical?: string;
  noindex?: boolean;
  nofollow?: boolean;
};

/* ── PAGE CHROME AND CAMPAIGN ────────────────────────────────────────────
 *
 * A campaign landing is the same page type as "O nas" with two differences:
 * what it wears (usually less), and the fact that it ends.
 */

/** global = the site's own header/footer, minimal = logo only, none = nothing.
 *  `minimal` is what an ad landing wants: the brand is still there, the
 *  navigation that would carry the visitor away is not. */
export type ChromeMode = "global" | "minimal" | "none";

export const CHROME_MODES: readonly ChromeMode[] = ["global", "minimal", "none"];

export const isChromeMode = (v: unknown): v is ChromeMode =>
  typeof v === "string" && (CHROME_MODES as readonly string[]).includes(v);

/**
 * A page that is a promotion. Deliberately five fields on the page rather
 * than a promotions subsystem: the offer itself lives in the pricing and the
 * credit ledger, and this only says when the page selling it is open.
 */
export type PagePromo = {
  active?: boolean;
  /** ISO instants. */
  startAt?: string;
  endAt?: string;
  /** Where a visitor goes once `endAt` has passed. Internal path or https. */
  afterEndRedirect?: string;
  /** Shown on the page and quoted in support; not validated against Stripe. */
  code?: string;
  /** Free-form tag an admin can match against their ad platform. */
  campaignId?: string;
};

/** Is the promotion window open right now? A page with no promotion, or an
 *  inactive one, is simply a page — this only answers for `active` ones. */
export function promoIsOpen(promo: PagePromo | undefined, now = Date.now()): boolean {
  if (!promo?.active) return true;
  const start = promo.startAt ? Date.parse(promo.startAt) : NaN;
  const end = promo.endAt ? Date.parse(promo.endAt) : NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now >= end) return false;
  return true;
}

export const BLOCK_TYPES = [
  "hero", "showcase", "before_after", "video", "product_lock", "workflow",
  "use_cases", "features", "stats", "text_image", "cta", "faq", "pricing", "logo_cloud",
  // Added with the unified page editor.
  "text", "media", "benefits", "legal", "contact", "launch",
  // Added with the page builder.
  "rich_text", "cards", "tools_grid", "models", "gallery", "comparison",
  "testimonials", "pricing_table", "contact_form", "newsletter",
  "spacer", "divider", "custom_code",
  // Added with Builder 2.0 — the sections a campaign landing is made of.
  "countdown", "promo_bar", "offer", "bonus", "guarantee", "trust_badges",
  "urgency_cta", "sticky_cta",
] as const;

/**
 * The section types an admin may actually add, grouped the way the picker
 * shows them. Deliberately NOT the same list as BLOCK_TYPES: `launch` belongs
 * to exactly one page and is created with it, so it is never offered here.
 *
 * THE FIRST GROUP IS THE ONE THAT GETS USED. A picker that opens on
 * twenty-eight equal choices is a decision, not a shortcut, so the six
 * sections that build nine landing pages out of ten come first and the rest
 * are grouped by what they are FOR — selling, proving, showing — rather than
 * by what they are made of. A type may appear in two groups: "popular" is a
 * shortcut into the same catalogue, not a separate one.
 */
export const SECTION_GROUPS: readonly { key: string; types: readonly string[] }[] = [
  { key: "popular", types: ["hero", "features", "cta", "faq", "gallery", "before_after"] },
  { key: "sales", types: ["offer", "pricing_table", "bonus", "countdown", "urgency_cta", "promo_bar", "sticky_cta", "guarantee", "comparison", "benefits"] },
  { key: "proof", types: ["testimonials", "logo_cloud", "stats", "trust_badges", "text_image", "product_lock"] },
  { key: "text", types: ["text", "rich_text", "legal", "workflow", "use_cases", "cards"] },
  { key: "media", types: ["media", "video", "showcase"] },
  { key: "product", types: ["tools_grid", "models"] },
  { key: "forms", types: ["contact", "contact_form", "newsletter"] },
  { key: "layout", types: ["spacer", "divider"] },
  { key: "advanced", types: ["custom_code"] },
] as const;

/**
 * Sections that sell against a clock. They share one rule the renderer
 * enforces: once the deadline has passed they either say so or disappear —
 * never quietly keep counting, and never restart.
 */
export const DEADLINE_SECTIONS = new Set(["countdown", "urgency_cta", "promo_bar"]);

/** Sections that pin themselves to an edge of the viewport rather than
 *  sitting in the flow. They ignore the section padding entirely. */
export const PINNED_SECTIONS = new Set(["promo_bar", "sticky_cta"]);

export const SECTION_TYPES = SECTION_GROUPS.flatMap((g) => g.types);

export type SectionType = (typeof BLOCK_TYPES)[number];

/**
 * Section types whose content comes from the PRODUCT, not from the editor:
 * the tool registry, the model list, the plan table. They are configured, not
 * written — which is exactly why they must not be a second copy of that data.
 */
export const LIVE_DATA_SECTIONS = new Set(["tools_grid", "models", "pricing_table"]);

export function lt(text: LocaleText | undefined, locale: string): string {
  if (!text) return "";
  return (text as Record<string, string | undefined>)[locale] ?? text.pl ?? text.en ?? "";
}

/** Only https URLs render at all; iframes additionally require an
 *  allowlisted host. Direct files render via <video>/<img>. */
const EMBED_HOSTS = new Set(["www.youtube.com", "youtube.com", "youtu.be", "player.vimeo.com", "vimeo.com"]);

export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? url : null;
  } catch { return null; }
}

export function videoEmbedUrl(url: string): { kind: "iframe" | "file"; src: string } | null {
  const safe = safeUrl(url);
  if (!safe) return null;
  const u = new URL(safe);
  if (/\.(mp4|webm)(\?.*)?$/.test(u.pathname)) return { kind: "file", src: safe };
  if (!EMBED_HOSTS.has(u.hostname)) return null;
  if (u.hostname === "youtu.be") return { kind: "iframe", src: `https://www.youtube.com/embed/${u.pathname.slice(1)}` };
  if (u.hostname.endsWith("youtube.com")) {
    const id = u.searchParams.get("v");
    return id ? { kind: "iframe", src: `https://www.youtube.com/embed/${id}` } : null;
  }
  if (u.hostname === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video/${u.pathname.slice(1)}` };
  if (u.hostname === "player.vimeo.com") return { kind: "iframe", src: safe };
  return null;
}
