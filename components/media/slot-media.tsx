import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";
import { SlotVideo } from "./slot-video";

/**
 * WHAT AN ADMIN PUT IN A SLOT — OR WHAT THE INTERFACE ALREADY DREW.
 *
 * Every surface that can be dressed by the admin renders through this. The
 * contract is one line and it is the whole migration plan:
 *
 *     slot filled  → render it
 *     slot empty   → render `fallback`, unchanged
 *
 * So the day this ships, nothing looks different: every card falls through to
 * the art it was drawing before. A picture appears only where somebody
 * deliberately put one. There is no moment where a screen is half-converted
 * and no backfill that has to be got right.
 *
 * RESPONSIVE OVERRIDES WITHOUT THREE UPLOADS. Tablet and mobile are optional.
 * For an image they are `<source media>` inside a `<picture>` — the browser
 * picks one, downloads one, and needs no JavaScript to do it. A slot with only
 * a desktop file emits no extra sources at all.
 *
 * NO LAYOUT SHIFT. The frame owns the aspect ratio before anything loads, the
 * same rule components/mobile/media.tsx already follows, so a card never grows
 * when its picture arrives.
 *
 * `whole` — THE WHOLE ASSET, ALWAYS (the thumbnails on Start and /tools). The
 * picture is contained, never cropped or stretched, whatever fit the slot was
 * saved with; where its shape differs from the frame's, the rest of the frame
 * is a blurred copy of the same picture (the same file, so no second download)
 * rather than an empty band. A picture of the frame's own shape fills it
 * edge to edge. Without `whole` nothing changes for any other surface.
 */

export function SlotMedia({
  slot, slots, ratio, className, priority = false, sizes = "100vw", fallback, whole = false,
}: {
  /** The slot key, e.g. "dashboard.category.moda.card". */
  slot: string;
  /** The map the screen resolved once, for every slot it paints. */
  slots: SlotMap;
  /** The shape the surface paints it at, e.g. "16/10". */
  ratio: string;
  className?: string;
  /** Above the fold: skip lazy loading and ask for it early. */
  priority?: boolean;
  sizes?: string;
  /** What to render when the slot is empty — the art this surface drew
   *  before, passed by the caller so this component never has to know it. */
  fallback: React.ReactNode;
  /** Show the whole asset: contained, over a blurred copy of itself. */
  whole?: boolean;
}) {
  const config = slots.get(slot);
  if (!config) return <>{fallback}</>;

  const frame = `relative block w-full overflow-hidden ${className ?? ""}`;
  const style = { aspectRatio: ratio } as React.CSSProperties;

  if (config.mediaType === "video") {
    return (
      <span className={whole ? `${frame} bg-sunken` : frame} style={style} data-slot={slot} data-slot-kind="video">
        {whole && config.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.poster} alt="" aria-hidden loading="lazy" decoding="async" className={BACKDROP} />
        )}
        <SlotVideo
          desktop={config.desktop}
          mobile={config.mobile}
          tablet={config.tablet}
          poster={config.poster}
          autoplay={config.autoplay}
          muted={config.muted}
          loop={config.loop}
          controls={config.controls}
          fit={whole ? "contain" : config.fit}
          position={whole ? "center" : config.position}
          label={config.alt}
        />
      </span>
    );
  }

  // Narrowest first: the browser takes the first source whose media query
  // matches, so a mobile override must be offered before the tablet one.
  const picture = (img: React.ReactNode) => (
    <picture>
      {config.mobile && <source media="(max-width: 639px)" srcSet={config.mobile} />}
      {config.tablet && <source media="(max-width: 1023px)" srcSet={config.tablet} />}
      {img}
    </picture>
  );
  const srcSet = srcSetOf(config);
  const sources = { src: config.desktop, ...(srcSet ? { srcSet, sizes } : {}) };

  return (
    <span className={frame} style={style} data-slot={slot} data-slot-kind="image">
      {/* The backdrop: the same <picture>, so the browser picks the same file. */}
      {whole && picture(
        // eslint-disable-next-line @next/next/no-img-element
        <img {...sources} alt="" aria-hidden loading={priority ? "eager" : "lazy"} decoding="async"
          className={BACKDROP} />,
      )}
      {picture(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...sources}
          {...(config.desktopWidth && config.desktopHeight
            ? { width: config.desktopWidth, height: config.desktopHeight }
            : {})}
          alt={config.alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding={priority ? "sync" : "async"}
          className="absolute inset-0 h-full w-full"
          style={whole
            ? { objectFit: "contain", objectPosition: "center" }
            : { objectFit: config.fit, objectPosition: config.position }}
        />,
      )}
    </span>
  );
}

/** The blurred copy behind a contained picture: covers the frame, scaled a
 *  little so the blur has no soft transparent edge, dimmed so the picture on
 *  top stays the subject. */
const BACKDROP = "pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl";

/** `url 640w, url 1280w, …` from the derivatives the media table recorded.
 *  Null when there are none, so no srcset attribute is printed rather than
 *  one pointing at files that may not exist. */
function srcSetOf(config: ResolvedSlot): string | null {
  if (!config.variants) return null;
  const candidates = Object.entries(config.variants)
    .map(([width, url]) => {
      const w = Number(width);
      return Number.isFinite(w) && w > 0 ? `${url} ${w}w` : null;
    })
    .filter((c): c is string => c !== null);
  return candidates.length > 0 ? candidates.join(", ") : null;
}

/**
 * The same decision without the markup, for a surface that paints its own
 * frame and only wants the URL — the category tiles hand theirs to the shared
 * <Media> component, which already knows how to shimmer and fade.
 */
export function slotImageUrl(slots: SlotMap, key: string): string | null {
  const config = slots.get(key);
  return config && config.mediaType === "image" ? config.desktop : null;
}

export function hasSlot(slots: SlotMap, key: string): boolean {
  return slots.has(key);
}
