import "server-only";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { loadMediaIndex, metaFor, type MediaIndex } from "@/lib/server/cms-media";
import { premiereState } from "@/lib/server/pricing-offer";
import { stegaStrip } from "@/lib/ice/stega";
import {
  EARLY_ACCESS_SUPPORTED, tokenValues, type PrelaunchPublicConfig,
} from "@/lib/launch/campaign";
import { formatLaunchDate, pickVariant, resolveLine, type LaunchTokenValues } from "@/lib/launch/tokens";
import {
  ALLOWED_TOKENS, LAUNCH_SECTIONS, isSectionShown, launchPlainFromContent, type LaunchPlain, type LaunchSection,
} from "@/lib/launch/fields";
import {
  GALLERY_BLOCK_TYPE, GALLERY_KEYS, captionFor, isCompletePair, mediaPublicPrefix, readGalleryContent,
  type GalleryHalf, type GalleryItem, type GalleryKey,
} from "@/lib/launch/gallery";
import { LAUNCH_FIELDS, launchDefault, type LaunchDefaults, type LaunchField } from "@/lib/server/launch-page";
import type { IceImage } from "@/components/seller-home/ice-slot-image";
import type { Client } from "@/lib/services/workspace";

/**
 * THE LONG PRE-LAUNCH PAGE, AS A VIEW MODEL.
 *
 * Everything the launch page decides — which offer line, which benefit cards,
 * whether a countdown runs, which galleries a visitor sees and what an admin
 * sees instead — is decided HERE, from plain inputs, and handed to the
 * components as finished strings and flags. The components hold layout and
 * no rules, for two reasons:
 *
 *  - The same rules feed a second surface. The auth dialog lists the pre-launch
 *    perks too (app/actions/platform-access.ts); it calls `launchPerks` below,
 *    so the dialog can never promise a card the page hides.
 *  - "Never show an unapproved value, never show a raw {token}" has to be
 *    testable without a browser. scripts/prelaunch-ui-tests.ts drives these
 *    functions with every approval combination and renders the page from
 *    their output.
 *
 * The one impure function is `loadLaunchView`, which adds the media lookup.
 */

/* ── section switches and the two plain pictures ────────────────────────── */

export type LaunchOptions = {
  /** Per section: shown to visitors. Absent switch → the section's default. */
  shown: Record<LaunchSection, boolean>;
  /** "Who is behind it" photo — a media-bucket URL, or null (brand mark). */
  creatorsImage: string | null;
  /** The share image — a media-bucket URL, or null (/launch/og.jpg). */
  ogImage: string | null;
};

/**
 * Only an https file in THIS project's public media bucket. The value is typed
 * into the builder; a stray `http://`, an external host or a relative path is
 * not "a picture we chose", and an og:image or a page photo pointing anywhere
 * else would be content nobody reviewed.
 */
export function mediaUrlOrNull(value: string | undefined, supabaseUrl: string = SUPABASE_URL): string | null {
  if (!value) return null;
  const url = value.trim();
  const prefix = mediaPublicPrefix(supabaseUrl);
  if (!/^https:\/\//i.test(url) || !url.startsWith(prefix)) return null;
  if (url.length === prefix.length || url.includes("..") || /[\s"'<>]/.test(url)) return null;
  return url;
}

export function launchOptionsFrom(plain: LaunchPlain, supabaseUrl: string = SUPABASE_URL): LaunchOptions {
  const shown = Object.fromEntries(
    LAUNCH_SECTIONS.map((s) => [s, isSectionShown(plain, s)]),
  ) as Record<LaunchSection, boolean>;
  return {
    shown,
    creatorsImage: mediaUrlOrNull(plain.creatorsImage, supabaseUrl),
    ogImage: mediaUrlOrNull(plain.ogImage, supabaseUrl),
  };
}

/** The launch block's plain values, read from whichever block list renders. */
export function launchOptionsFromBlocks(
  blocks: readonly { type: string; content?: unknown }[] | null | undefined,
  supabaseUrl: string = SUPABASE_URL,
): LaunchOptions {
  const block = (blocks ?? []).find((b) => b.type === "launch");
  return launchOptionsFrom(launchPlainFromContent(block?.content), supabaseUrl);
}

/* ── the campaign: offer line, benefit cards, countdown, referral line ──── */

/**
 * THE LAST LOCK ON "NEVER A RAW TOKEN".
 *
 * Copy is checked on save (lib/launch/fields.ts disallowedTokens) — but copy
 * stored before that check existed, or written by a path that skipped it,
 * still reaches this renderer. resolveLine only knows its five tokens, so a
 * typo ("{credit}") would pass through it verbatim. Every line this module
 * resolves is therefore checked once more for ANY `{word}` left in it, and
 * drops out (its variant falls through) instead of printing it.
 */
const ANY_TOKEN = /\{[a-zA-Z_]+\}/;
const guarded = (text: string | null): string | null => (text !== null && ANY_TOKEN.test(text) ? null : text);

/**
 * The same lock for the plain lines the page prints as they are (headline,
 * chips, gallery titles…): a stored value carrying a token is replaced by the
 * shipped default, or by nothing when that carries one too. Lines that are
 * MEANT to hold tokens are left alone here — they go through the resolver,
 * and the consent sentences through their own (lib/server/prelaunch/consent.ts).
 */
export function safeLaunchCopy(copy: Copy, defaults: LaunchDefaults): Record<LaunchField, string> {
  const out = { ...copy } as Record<LaunchField, string>;
  for (const field of LAUNCH_FIELDS) {
    if (ALLOWED_TOKENS[field] || !ANY_TOKEN.test(out[field])) continue;
    const fallback = launchDefault(defaults, field);
    out[field] = ANY_TOKEN.test(fallback) ? "" : fallback;
  }
  return out;
}

/** One benefit card. `b` is "" when the card shows its title alone. */
export type LaunchPerk = { key: "credits" | "priceLock" | "earlyAccess"; t: string; b: string };

/**
 * A launch date that has passed is no date. prelaunch_public_config and
 * getPrelaunchPublicConfig already drop it; this is the same rule once more at
 * the point of use, because "Startujemy 20 listopada" under a countdown that
 * has already removed itself is exactly the stale promise the brief forbids.
 */
export function liveConfig(cfg: PrelaunchPublicConfig, now: number): PrelaunchPublicConfig {
  const at = cfg.launchAt ? Date.parse(cfg.launchAt) : NaN;
  return Number.isFinite(at) && at > now ? cfg : { ...cfg, launchAt: null };
}

type Copy = Readonly<Record<LaunchField, string>>;

/**
 * THE THREE CARDS AND THE RULE FOR EACH.
 *
 *  1. CREDITS — the title needs {credits} (X). Its second line compares X with
 *     the standard figure and needs {standard}; without an approved standard
 *     the card keeps its title and loses the comparison, never the other way
 *     round (a comparison against nothing is not a sentence).
 *  2. LAUNCH PRICE — a promise the checkout has to keep, so it needs both the
 *     owner's approval AND the premiere offer actually running in the pricing
 *     code (premiereState, read-only). Either one missing hides the card.
 *  3. EARLY ACCESS — there is no mechanism for it (lib/launch/campaign.ts), so
 *     the card does not render while EARLY_ACCESS_SUPPORTED is false, whatever
 *     the settings or the copy say — even copy rewritten without {hours}.
 *
 * Any card whose title (or, for 2 and 3, sub-line) does not resolve is hidden.
 */
export function launchPerks(
  copy: Copy, cfg: PrelaunchPublicConfig, locale: string, now: number,
  /** Injected for tests; the live page asks the pricing offer. */
  premiereActive: (now: number) => boolean = (at) => premiereState(at).status === "active",
): LaunchPerk[] {
  const values = tokenValues(liveConfig(cfg, now), locale, now);
  const line = (field: LaunchField) => guarded(resolveLine(copy[field], values, locale));
  const out: LaunchPerk[] = [];

  const creditsTitle = cfg.signupCredits !== null ? line("benefit.1") : null;
  if (creditsTitle) out.push({ key: "credits", t: creditsTitle, b: line("benefit.1sub") ?? "" });

  if (cfg.priceLock && premiereActive(now)) {
    const t = line("benefit.2");
    const b = line("benefit.2sub");
    if (t && b) out.push({ key: "priceLock", t, b });
  }

  if (EARLY_ACCESS_SUPPORTED && cfg.earlyAccessHours !== null) {
    const t = line("benefit.3");
    const b = line("benefit.3sub");
    if (t && b) out.push({ key: "earlyAccess", t, b });
  }
  return out;
}

/** The hero's offer line: the first variant whose tokens all resolve. */
export const OFFER_VARIANTS = ["hero.offer", "hero.offerDate", "hero.offerCredits", "hero.offerNone"] as const;

export function offerLine(copy: Copy, values: LaunchTokenValues, locale: string): string | null {
  // pickVariant, variant by variant, so a line the guard refuses falls
  // through to the next one exactly like an unapproved one does.
  for (const key of OFFER_VARIANTS) {
    const line = guarded(pickVariant([copy[key]], values, locale));
    if (line !== null) return line;
  }
  return null;
}

export type LaunchCountdownView = {
  /** The launch instant, ms since epoch (server-approved and in the future). */
  launchAtMs: number;
  /** ISO for <time dateTime>. */
  iso: string;
  /** "Do premiery zostało". */
  label: string;
  /** "20 listopada o 10:00" — Europe/Warsaw, for the screen-reader line. */
  dateLabel: string;
};

export type LaunchCampaignView = {
  offer: string | null;
  perks: LaunchPerk[];
  /** "Kredyty dopiszemy po założeniu konta…" — only while a credits value is shown. */
  rewardNote: string | null;
  countdown: LaunchCountdownView | null;
  /** The referral line of the after-submit card: ref.body when {referral}
   *  resolves, else ref.bodyNone; plus the reward note when it showed credits. */
  referral: { body: string; rewardNote: string | null };
};

export function launchCampaign(
  copy: Copy, config: PrelaunchPublicConfig, locale: string, now: number,
  premiereActive?: (now: number) => boolean,
): LaunchCampaignView {
  const cfg = liveConfig(config, now);
  const values = tokenValues(cfg, locale, now);
  const perks = launchPerks(copy, cfg, locale, now, premiereActive);
  const note = guarded(resolveLine(copy["reward.note"], values, locale));

  const at = cfg.launchAt ? Date.parse(cfg.launchAt) : NaN;
  const dateLabel = formatLaunchDate(cfg.launchAt, locale, now);
  const countdown = cfg.launchAt && Number.isFinite(at) && at > now && dateLabel
    ? { launchAtMs: at, iso: new Date(at).toISOString(), label: copy["countdown.label"], dateLabel }
    : null;

  const refBody = guarded(resolveLine(copy["ref.body"], values, locale));
  return {
    offer: offerLine(copy, values, locale),
    perks,
    rewardNote: perks.some((p) => p.key === "credits") ? note : null,
    countdown,
    referral: {
      body: refBody ?? guarded(copy["ref.bodyNone"]) ?? "",
      rewardNote: refBody ? note : null,
    },
  };
}

/* ── galleries ─────────────────────────────────────────────────────────── */

export type LaunchGalleryTile = {
  id: string;
  /** 1-based position among the RENDERED tiles — the GA pair_index. */
  index: number;
  caption: string;
  before: IceImage;
  after: IceImage;
};

export type LaunchGalleryView = {
  key: GalleryKey;
  eyebrow: string;
  title: string;
  tiles: LaunchGalleryTile[];
  /**
   * null = a live gallery a visitor sees. Otherwise the reason an ADMIN sees a
   * dashed placeholder in its place — `missing` (no block yet), `empty` (no
   * complete pair) or `hidden` (switched off). Visitors never receive these.
   */
  placeholder: null | "missing" | "empty" | "hidden";
};

type BlockLike = { id?: string; type: string; sort_order?: number; visible?: boolean; content?: unknown };

/** One block per gallery key: the lowest sort_order, then the lowest id —
 *  a duplicated block (which the CMS refuses to create) can never make the
 *  page pick differently from the editor. */
export function galleryBlocks(blocks: readonly BlockLike[]): Map<GalleryKey, BlockLike & { items: GalleryItem[] }> {
  const out = new Map<GalleryKey, BlockLike & { items: GalleryItem[] }>();
  const sorted = blocks
    .filter((b) => b.type === GALLERY_BLOCK_TYPE)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  for (const block of sorted) {
    const content = readGalleryContent(block.content);
    if (!content || out.has(content.gallery)) continue;
    out.set(content.gallery, { ...block, items: content.items });
  }
  return out;
}

/** Every picture a gallery tile (or the creators tile) may render, for one
 *  cms_media_meta lookup. Complete pairs only: nothing else is painted. */
export function galleryMediaUrls(blocks: readonly BlockLike[]): string[] {
  const urls = new Set<string>();
  for (const block of galleryBlocks(blocks).values()) {
    if (block.visible === false) continue;
    for (const item of block.items) {
      if (!isCompletePair(item)) continue;
      urls.add(item.before!.url);
      urls.add(item.after!.url);
    }
  }
  return [...urls];
}

/** `url 640w, url 1024w, …` from recorded derivatives, narrowest first — the
 *  same encoding IcePicture's own slots use (components/seller-home/
 *  ice-slot-image.tsx), so a gallery half and a /home slot are one format. */
export function srcSetFrom(variants: Record<string, string> | undefined): string | undefined {
  const list = Object.entries(variants ?? {})
    .map(([width, url]) => [Number(width), url] as const)
    .filter(([width, url]) => Number.isFinite(width) && width > 0 && typeof url === "string" && url.length > 0)
    .sort(([a], [b]) => a - b)
    .map(([width, url]) => `${url.replace(/,/g, "%2C").replace(/ /g, "%20")} ${width}w`);
  return list.length > 0 ? list.join(", ") : undefined;
}

/** The text a picture is described by: no editor markers in an alt. */
const plain = (text: string) => stegaStrip(text).replace(/\s+/g, " ").trim();

/** A gallery half as an <img>: the file, its derivatives and size from the
 *  media index, framed by the editor's crop (or centred at zoom 1). */
export function galleryHalfImage(half: GalleryHalf, media: MediaIndex, alt: string): IceImage {
  const meta = metaFor(media, half.url);
  const srcSet = srcSetFrom(meta?.variants);
  return {
    src: half.url,
    ...(srcSet ? { srcSet } : {}),
    ...(meta?.width && meta?.height ? { width: meta.width, height: meta.height } : {}),
    alt,
    fit: "cover",
    frame: half.crop
      ? { position: `${half.crop.x}% ${half.crop.y}%`, zoom: half.crop.zoom }
      : { position: "50% 50%", zoom: 1 },
  };
}

/**
 * The alt of one half: the caption in the viewer's language and the side's
 * label ("Etui na telefon – PRZED"). With no caption, the library's own alt
 * for that file, then the label alone — never an empty alt on a picture that
 * is the whole point of the section.
 */
export function halfAlt(caption: string, label: string, fileAlt: string | undefined): string {
  const side = plain(label);
  const what = plain(caption) || plain(fileAlt ?? "");
  return what ? (side ? `${what} – ${side}` : what) : side;
}

export function launchGalleries(input: {
  blocks: readonly BlockLike[];
  copy: Copy;
  locale: string;
  media: MediaIndex;
  /** An admin, not previewing: placeholders for what a visitor will not see. */
  isAdmin: boolean;
}): LaunchGalleryView[] {
  const { copy, locale, media, isAdmin } = input;
  const byKey = galleryBlocks(input.blocks);
  const out: LaunchGalleryView[] = [];
  for (const key of GALLERY_KEYS) {
    const block = byKey.get(key);
    const eyebrow = copy[`gallery.${key}.eyebrow`];
    const title = copy[`gallery.${key}.title`];
    const complete = (block?.items ?? []).filter(isCompletePair);
    const tiles: LaunchGalleryTile[] = complete.map((item, i) => {
      const caption = captionFor(item, locale);
      const before = item.before!;
      const after = item.after!;
      return {
        id: item.id,
        index: i + 1,
        caption,
        before: galleryHalfImage(before, media, halfAlt(caption, copy["gallery.before"], metaFor(media, before.url)?.alt)),
        after: galleryHalfImage(after, media, halfAlt(caption, copy["gallery.after"], metaFor(media, after.url)?.alt)),
      };
    });
    const placeholder: LaunchGalleryView["placeholder"] = !block ? "missing"
      : block.visible === false ? "hidden"
        : tiles.length === 0 ? "empty" : null;
    if (placeholder === null) out.push({ key, eyebrow, title, tiles, placeholder });
    else if (isAdmin) out.push({ key, eyebrow, title, tiles: [], placeholder });
  }
  return out;
}

/* ── the page's analytics context ──────────────────────────────────────── */

/**
 * The traffic source the page_view event reports: the first-touch campaign
 * (utm_source), else the first-touch referring host, else this request's own
 * utm_source (the very first visit, before the first-touch cookie exists),
 * else "referral" for a referral link, else "direct". Short and shaped for
 * GA's allowlist; anything that could be personal (an "@") is dropped.
 */
export function trafficSourceFrom(input: {
  firstTouchUtm?: string | null; firstTouchHost?: string | null;
  utmSource?: string | null; refCode?: string | null;
}): string {
  const clean = (v: string | null | undefined) => {
    if (!v || v.includes("@")) return null;
    const s = v.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
    return s || null;
  };
  return clean(input.firstTouchUtm) ?? clean(input.firstTouchHost) ?? clean(input.utmSource)
    ?? (input.refCode ? "referral" : "direct");
}

/* ── one call for the route ────────────────────────────────────────────── */

/**
 * What the PAGE receives of the plain values: the switches, and the creators
 * photo as a ready <img>. The share image is metadata only (generateMetadata
 * reads it from LaunchOptions), so it never travels into the markup.
 */
export type LaunchPageOptions = {
  shown: Record<LaunchSection, boolean>;
  creatorsImage: IceImage | null;
};

export function launchPageOptions(options: LaunchOptions, media: MediaIndex): LaunchPageOptions {
  const url = options.creatorsImage;
  return {
    shown: options.shown,
    creatorsImage: url
      ? galleryHalfImage({ url }, media, plain(metaFor(media, url)?.alt ?? ""))
      : null,
  };
}

export type LaunchView = {
  options: LaunchPageOptions;
  campaign: LaunchCampaignView;
  galleries: LaunchGalleryView[];
};

/**
 * Everything the launch branch of "/" needs beyond the copy, in one call: the
 * campaign values come in already approved (getPrelaunchPublicConfig), the
 * galleries cost one media lookup for every picture on the page.
 */
export async function loadLaunchView(supabase: Client, input: {
  blocks: readonly BlockLike[];
  copy: Copy;
  locale: string;
  config: PrelaunchPublicConfig;
  isAdmin: boolean;
  now: number;
}): Promise<LaunchView> {
  const options = launchOptionsFromBlocks(input.blocks);
  const urls = galleryMediaUrls(input.blocks);
  if (options.shown.creators && options.creatorsImage) urls.push(options.creatorsImage);
  const media = await loadMediaIndex(supabase, urls).catch(() => new Map() as MediaIndex);
  return {
    options: launchPageOptions(options, media),
    campaign: launchCampaign(input.copy, input.config, input.locale, input.now),
    galleries: launchGalleries({
      blocks: input.blocks, copy: input.copy, locale: input.locale, media, isAdmin: input.isAdmin,
    }),
  };
}

/** The SEO lines as plain text: no editor markers in a <title> or an og tag. */
export function seoText(text: string): string {
  return plain(text);
}
