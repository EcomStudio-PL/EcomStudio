import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { SlotVideo } from "@/components/media/slot-video";
import { BANNER_BREAKPOINTS } from "@/lib/seller-home-config";
import type { ResolvedSlot } from "@/lib/server/media-slots";
import { frameOf, isGifUrl, slotAlt, srcSetOf, type Frame } from "./ice-slot-image";

/**
 * A /HOME PROMO BANNER'S BACKGROUND, THREE DEVICES (27.11.2026).
 *
 *   phone    < 768 px    the phone file (crop.m), else the desktop file
 *   tablet   768–1279    the tablet file (crop.t), else the desktop file
 *   desktop  ≥ 1280      the desktop file (crop)
 *
 * The breakpoints are the banners' own (BANNER_BREAKPOINTS — Tailwind's md /
 * xl); every other picture of the page keeps 640 / 1024. A missing phone or
 * tablet file never leaves a hole: the desktop file is painted in that
 * device's frame, framed with the desktop crop.
 *
 * ONE FILE IS FETCHED. Pictures go through <picture>/<source media>, which the
 * browser resolves before it downloads anything; a clip's source is picked by
 * SlotVideo (with the same breakpoints) before `preload` leaves "none".
 *
 * The frame per device travels as custom properties (one <img> has one style
 * attribute), put in force by the classes below — `!important` because the
 * desktop frame is the inline style. Server-safe, no hooks.
 */

const PHONE_MAX = BANNER_BREAKPOINTS.tablet - 1;
const TABLET_MAX = BANNER_BREAKPOINTS.desktop - 1;

/** The phone (max-md) and tablet (md…xl) frames of a picture. */
const IMG_TIERS = cn(
  "max-md:![object-position:var(--bn-pos-p)] max-md:![transform-origin:var(--bn-pos-p)] max-md:![transform:var(--bn-tf-p)]",
  "md:max-xl:![object-position:var(--bn-pos-t)] md:max-xl:![transform-origin:var(--bn-pos-t)] md:max-xl:![transform:var(--bn-tf-t)]",
);
/** …and of a clip: the zoom on its wrapper, the focal point on the <video>. */
const CLIP_TIERS = cn(
  "max-md:![transform-origin:var(--bn-pos-p)] max-md:![transform:var(--bn-tf-p)] max-md:[&>video]:![object-position:var(--bn-pos-p)]",
  "md:max-xl:![transform-origin:var(--bn-pos-t)] md:max-xl:![transform:var(--bn-tf-t)] md:max-xl:[&>video]:![object-position:var(--bn-pos-t)]",
);

const transformOf = (f: Frame) => (f.zoom > 1 ? `scale(${f.zoom})` : "none");

/** The three frames: a device without its own file keeps the desktop one. */
export function bannerFrames(slot: ResolvedSlot): { desktop: Frame; tablet: Frame; phone: Frame } {
  const desktop = frameOf(slot.crop, slot.position);
  return {
    desktop,
    tablet: slot.tablet ? frameOf(slot.crop?.t, slot.position) : desktop,
    phone: slot.mobile ? frameOf(slot.crop?.m, slot.position) : desktop,
  };
}

function tierVars(f: { tablet: Frame; phone: Frame }): CSSProperties {
  return {
    "--bn-pos-p": f.phone.position, "--bn-tf-p": transformOf(f.phone),
    "--bn-pos-t": f.tablet.position, "--bn-tf-t": transformOf(f.tablet),
  } as CSSProperties;
}

export function BannerMedia({ slot, locale, alt, label }: { slot: ResolvedSlot; locale: string; alt?: string; label?: string }) {
  const frames = bannerFrames(slot);
  const fit = slot.fit === "contain" ? "contain" : "cover";
  const text = slotAlt(slot, locale, alt);

  if (slot.mediaType === "video") {
    const d = frames.desktop;
    return (
      <span className={cn("absolute inset-0 block", CLIP_TIERS)} data-banner-clip
        style={{ ...(d.zoom > 1 ? { transform: `scale(${d.zoom})`, transformOrigin: d.position } : {}), ...tierVars(frames) }}>
        <SlotVideo desktop={slot.desktop} tablet={slot.tablet} mobile={slot.mobile} poster={slot.poster}
          autoplay={slot.autoplay} muted={slot.muted} loop={slot.loop} controls={slot.controls}
          fit={fit} position={d.position} label={text || label || undefined}
          maxWidths={{ mobile: PHONE_MAX, tablet: TABLET_MAX }} />
      </span>
    );
  }

  const desktopSet = isGifUrl(slot.desktop) ? undefined : srcSetOf(slot.variants);
  const phoneSet = slot.mobile ? (isGifUrl(slot.mobile) ? undefined : srcSetOf(slot.mobileVariants)) : desktopSet;
  const d = frames.desktop;
  const img = (
    // A library file at its own URL (and its recorded derivatives) — never the
    // optimiser, as with every other slot picture.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={slot.desktop} {...(desktopSet ? { srcSet: desktopSet, sizes: "100vw" } : {})}
      {...(slot.desktopWidth && slot.desktopHeight ? { width: slot.desktopWidth, height: slot.desktopHeight } : {})}
      alt={text} loading="lazy" decoding="async" data-banner-img
      className={cn("absolute inset-0", IMG_TIERS)}
      style={{
        width: "100%", height: "100%", objectFit: fit, objectPosition: d.position,
        ...(d.zoom > 1 ? { transform: `scale(${d.zoom})`, transformOrigin: d.position } : {}),
        ...tierVars(frames),
      }} />
  );
  // No device file of its own: one <img>, as before (the frames above still
  // shape it per device).
  if (!slot.mobile && !slot.tablet) return img;
  return (
    <picture>
      {/* First match wins: the phone source always comes first, so a phone
          never takes the tablet file. */}
      <source media={`(max-width: ${PHONE_MAX}px)`} srcSet={slot.mobile ? phoneSet ?? slot.mobile : desktopSet ?? slot.desktop}
        {...((slot.mobile ? phoneSet : desktopSet) ? { sizes: "100vw" } : {})} />
      {slot.tablet && <source media={`(max-width: ${TABLET_MAX}px)`} srcSet={slot.tablet} />}
      {img}
    </picture>
  );
}
