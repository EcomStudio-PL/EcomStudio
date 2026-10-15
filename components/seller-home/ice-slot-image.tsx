import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { SlotVideo } from "@/components/media/slot-video";
import type { IceCrop, IceLocale } from "@/lib/ice/types";
import type { ResolvedSlot } from "@/lib/server/media-slots";
import type { HomeSlotMap } from "@/lib/server/seller-home-slots";

/**
 * A /HOME SECTION SLOT FILLED IN THE VISUAL EDITOR — painted INSIDE the frame
 * MediaSlot (or the before/after slider) already draws: its shape, its
 * clipping (`overflow-hidden`) and its data attributes stay the frame's.
 *
 * WHY NOT SlotMedia. SlotMedia paints a slot with the nine-cell position
 * picker of Admin → Media; the editor frames a picture with a FOCAL POINT and
 * a ZOOM, which SlotMedia cannot express (and it is shared with /tools and
 * frozen). So the picture is painted here; the clip still goes through the
 * shared SlotVideo — fetched only near the viewport, paused off screen, its
 * poster for reduced motion — exactly as every other clip on the page.
 *
 * THE CROP NEVER TOUCHES THE FILE. It is three CSS values at render time:
 *   object-position  x% y%           which part of the file the frame keeps;
 *   transform        scale(zoom)     only when zoom > 1 —
 *   transform-origin x% y%           around that same point.
 * The frame clips what the zoom pushes out. object-fit is the slot's own —
 * `cover` unless it says `contain` — and never `fill`: a picture is cropped
 * by its frame, never stretched to it.
 *
 * Server-safe and hook-free, so the before/after slider (a client component)
 * paints its halves with the same IcePicture.
 */

/** The filled /home section slots, and the viewer's language (alt text). */
export type HomeSlots = { slots: HomeSlotMap; locale: string };

/** A filled slot of the map, or undefined — own keys only. */
export function homeSlot(home: HomeSlots | null | undefined, key: string): ResolvedSlot | undefined {
  return home && Object.prototype.hasOwnProperty.call(home.slots, key) ? home.slots[key] : undefined;
}

/** Where the frame sits on the file, and how far in it is zoomed. */
type Frame = { position: string; zoom: number };

/** What one <img> needs — plain JSON, so a client component can take it. */
export type IceImage = {
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
  fit: "cover" | "contain";
  frame: Frame;
  /** The phone file (max-width: 639px) and ITS frame (`crop.m`). */
  phone?: { src: string; srcSet?: string; frame: Frame };
};

/** The editor's frame, or the slot's nine-cell position with no zoom. */
function frameOf(crop: IceCrop | undefined, position: string): Frame {
  return crop ? { position: `${crop.x}% ${crop.y}%`, zoom: crop.zoom } : { position, zoom: 1 };
}

/** The alt text in the viewer's language, else the slot's, else the page's. */
export function slotAlt(slot: ResolvedSlot, locale: string, fallback?: string): string {
  // Polish: the legacy alt first — Admin → Media updates only that one, so it
  // is the newer whenever the two differ (the editor writes them equal).
  if (locale === "pl") return slot.alt || slot.altI18n?.pl || fallback || "";
  return slot.altI18n?.[locale as IceLocale] || slot.alt || fallback || "";
}

/** `url 640w, url 1024w, …` from recorded derivatives, narrowest first;
 *  undefined when there are none (no srcset beats one to missing files). */
function srcSetOf(variants: Record<string, string> | undefined): string | undefined {
  const list = Object.entries(variants ?? {})
    .map(([width, url]) => [Number(width), url] as const)
    .filter(([width]) => Number.isFinite(width) && width > 0)
    .sort(([a], [b]) => a - b)
    // A comma or a space would end the candidate early; encoded, the storage
    // serves the same object.
    .map(([width, url]) => `${url.replace(/,/g, "%2C").replace(/ /g, "%20")} ${width}w`);
  return list.length > 0 ? list.join(", ") : undefined;
}

/**
 * A filled image slot, reduced to its <img>. The phone file (a banner's
 * square cut) gets its own frame: `crop.m` when the editor set one, else the
 * slot's position — the desktop frame was chosen for a different picture.
 * The editor writes no tablet file for these slots, so none is read.
 */
export function iceImage(slot: ResolvedSlot, locale: string, fallbackAlt?: string): IceImage {
  const srcSet = srcSetOf(slot.variants);
  const phoneSet = srcSetOf(slot.mobileVariants);
  return {
    src: slot.desktop,
    ...(srcSet ? { srcSet } : {}),
    ...(slot.desktopWidth && slot.desktopHeight ? { width: slot.desktopWidth, height: slot.desktopHeight } : {}),
    alt: slotAlt(slot, locale, fallbackAlt),
    fit: slot.fit === "contain" ? "contain" : "cover",
    frame: frameOf(slot.crop, slot.position),
    ...(slot.mobile
      ? { phone: { src: slot.mobile, ...(phoneSet ? { srcSet: phoneSet } : {}), frame: frameOf(slot.crop?.m, slot.position) } }
      : {}),
  };
}

/** object-position, and the zoom around the same point when there is one. */
function frameStyle(frame: Frame): CSSProperties {
  return {
    objectPosition: frame.position,
    ...(frame.zoom > 1 ? { transform: `scale(${frame.zoom})`, transformOrigin: frame.position } : {}),
  };
}

/** The transform part alone — for a wrapper around a clip. */
function zoomStyle(frame: Frame): CSSProperties {
  return frame.zoom > 1 ? { transform: `scale(${frame.zoom})`, transformOrigin: frame.position } : {};
}

/**
 * THE PHONE FRAME. A <picture> swaps the FILE below 640px with no script,
 * but one <img> has one style attribute — so the phone file's frame travels
 * as two custom properties, and these classes put it in force below 640px
 * (`max-sm`, the same edge as the source's `max-width: 639px`). `!important`
 * because the desktop frame is an inline style.
 */
const PHONE_IMG = "max-sm:![object-position:var(--ice-phone-pos)] max-sm:![transform-origin:var(--ice-phone-pos)] max-sm:![transform:var(--ice-phone-transform)]";
/** …and for a clip: the zoom on its wrapper, the focal point on the <video>
 *  (SlotVideo picks the phone file below 640px itself). */
const PHONE_CLIP = "max-sm:![transform-origin:var(--ice-phone-pos)] max-sm:![transform:var(--ice-phone-transform)] max-sm:[&>video]:![object-position:var(--ice-phone-pos)]";

function phoneVars(frame: Frame): CSSProperties {
  return {
    "--ice-phone-pos": frame.position,
    "--ice-phone-transform": frame.zoom > 1 ? `scale(${frame.zoom})` : "none",
  } as CSSProperties;
}

/** One filled image: <img>, or <picture> when there is a phone file. */
export function IcePicture({ image, sizes, priority = false, draggable }: {
  image: IceImage;
  sizes: string;
  priority?: boolean;
  /** false on the before/after halves: a drag moves the divider, never the file. */
  draggable?: boolean;
}) {
  const img = (
    // A library file at its own URL (and its recorded derivatives): the
    // optimiser is not asked to fetch it, as with every other slot picture.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.src} {...(image.srcSet ? { srcSet: image.srcSet, sizes } : {})}
      {...(image.width && image.height ? { width: image.width, height: image.height } : {})}
      alt={image.alt} loading={priority ? "eager" : "lazy"} decoding="async"
      {...(draggable === false ? { draggable: false } : {})}
      className={cn("absolute inset-0", image.phone && PHONE_IMG)}
      style={{
        width: "100%", height: "100%", objectFit: image.fit,
        ...frameStyle(image.frame), ...(image.phone ? phoneVars(image.phone.frame) : {}),
      }} />
  );
  if (!image.phone) return img;
  return (
    <picture>
      <source media="(max-width: 639px)" srcSet={image.phone.srcSet ?? image.phone.src}
        {...(image.phone.srcSet ? { sizes } : {})} />
      {img}
    </picture>
  );
}

/**
 * A filled slot, image or clip, for MediaSlot's frame. `alt` is the page's
 * own alt for this position (the config's), used when the editor gave none;
 * `label` names a clip to assistive technology when nothing else does — the
 * same rule as a config clip.
 */
export function IceSlotImage({ slot, locale, alt, label, sizes, priority = false }: {
  slot: ResolvedSlot;
  locale: string;
  alt?: string;
  label?: string;
  sizes: string;
  priority?: boolean;
}) {
  if (slot.mediaType !== "video") {
    return <IcePicture image={iceImage(slot, locale, alt)} sizes={sizes} priority={priority} />;
  }
  const frame = frameOf(slot.crop, slot.position);
  const phone = slot.mobile ? frameOf(slot.crop?.m, slot.position) : null;
  const video = (
    <SlotVideo desktop={slot.desktop} mobile={slot.mobile} poster={slot.poster}
      autoplay={slot.autoplay} muted={slot.muted} loop={slot.loop} controls={slot.controls}
      fit={slot.fit === "contain" ? "contain" : "cover"} position={frame.position}
      label={slotAlt(slot, locale, alt) || label || undefined} />
  );
  // SlotVideo takes no transform, so a zoomed clip is scaled by a wrapper of
  // the frame's own size — the same geometry as scaling the <video> itself.
  if (frame.zoom <= 1 && !phone) return video;
  return (
    <span className={cn("absolute inset-0 block", phone && PHONE_CLIP)}
      style={{ ...zoomStyle(frame), ...(phone ? phoneVars(phone) : {}) }}>
      {video}
    </span>
  );
}
