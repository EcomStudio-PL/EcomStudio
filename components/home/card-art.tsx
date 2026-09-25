import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Play } from "lucide-react";
import type { CardArt } from "@/lib/home-sections";
import { ToolThumb, thumbRatio, type ToolMotif } from "@/components/tools/tool-thumb";
import { SlotMedia } from "@/components/media/slot-media";
import type { SlotMap } from "@/lib/server/media-slots";
import { cn } from "@/lib/utils";

/**
 * THE PICTURE ON A HOME CARD OR TILE, in strict order of authority:
 *
 *   1. what an ADMIN put in the media slot for this card
 *   2. the example photograph shipped for this tool, if the tool runs
 *   3. the drawn motif, which states the operation and claims nothing
 *
 * (1) is first because it is the only one that can be a picture of what THIS
 * product makes. The slot system already exists (migration 0090,
 * lib/media-slots.ts) and already dresses the tool catalogue; the Home joins it
 * rather than inventing a second way to put a picture on a card.
 *
 * (3) is the floor, and it is a real floor rather than a grey box: a brand
 * gradient with geometry. A tile is never an empty hole and never a borrowed
 * photograph pretending to be a result.
 *
 * NO LAYOUT SHIFT. Every branch owns its aspect ratio before a byte arrives,
 * so nothing on the page moves when a picture does. That ratio is one of the
 * two in components/tools/tool-thumb.tsx — the 2336×1744 photo frame, or 9:16
 * in a row of video tools (`vertical`, decided by the row) — and every branch
 * shows its asset WHOLE: never cropped, never stretched.
 */
export function CardArt({
  art, icon, slot, slots, dimmed = false, sizes, priority = false, video = false, vertical = false,
}: {
  art: CardArt;
  /** The operation's icon on the drawn floor. Omitted on gallery tiles. */
  icon?: LucideIcon;
  /** The media-slot key an admin can fill for this card. */
  slot: string;
  slots: SlotMap;
  /** A card whose tool cannot be opened reads quieter, so the live ones keep
   *  the eye. Matches the tool catalogue's own treatment. */
  dimmed?: boolean;
  sizes: string;
  /** Above the fold: fetched eagerly and early, whichever branch paints. */
  priority?: boolean;
  /** A video tool. The play mark is drawn for it, and for any tile whose slot
   *  an operator filled with a clip. */
  video?: boolean;
  /** The row's frame is vertical 9:16 (a row of video tools). Decided by the
   *  row, not the card, so a row is always level — see `majorityVideo`. */
  vertical?: boolean;
}) {
  const fallback = art.kind === "photo"
    ? <Photo src={art.src} vertical={vertical} dimmed={dimmed} sizes={sizes} priority={priority} />
    : <ToolThumb motif={art.motif} icon={icon} dimmed={dimmed} video={vertical} />;

  const body = (
    <SlotMedia slot={slot} slots={slots} ratio={thumbRatio(vertical)} sizes={sizes} priority={priority} whole
      className={cn("rounded-xl", dimmed && "opacity-55 saturate-50")} fallback={fallback} />
  );

  // ONE PLAY MARK. The drawn video motif already carries its own, so the
  // overlay goes over a PICTURE only: anything an operator put on a video
  // tool (a clip, or the still poster that usually dresses one), a shipped
  // photograph on a video tool, or a clip on any other card.
  const slotted = slots.get(slot);
  const isVideo = video ? Boolean(slotted) || art.kind === "photo" : slotted?.mediaType === "video";
  if (!isVideo) return body;
  return (
    <span className="relative block">
      {body}
      <PlayMark />
    </span>
  );
}

/**
 * The play mark, bottom-left, the way the reference draws it on every clip.
 * Decorative: it says "this is a video", and the card's own label says what.
 */
export function PlayMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn(
      "pointer-events-none absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full",
      "bg-[rgb(0_0_0/0.46)] text-white ring-1 ring-[rgb(255_255_255/0.28)] backdrop-blur-sm",
      className,
    )}>
      <Play size={12} className="translate-x-[1px]" fill="currentColor" />
    </span>
  );
}

/**
 * A GALLERY TILE — an operator's picture or clip, or the neutral floor.
 *
 * The galleries on the Home (Packshoty, the UGC banner, Reklamy i Social) are
 * made of nothing BUT media slots. An empty one draws the motif with no icon:
 * a quiet brand surface in the right shape, so the geometry of the section is
 * finished while its pictures are still to come — and nothing on it claims to
 * be a creative GrovBase made. A tile is the 2336×1744 photo frame, or 9:16
 * where it previews a video (the Wideo UGC clips) — the same two frames as
 * the tool cards — and shows its asset whole.
 */
export function GalleryArt({ slot, slots, motif, sizes, video = false }: {
  slot: string;
  slots: SlotMap;
  motif: ToolMotif;
  sizes: string;
  /** A video preview: the vertical 9:16 frame. */
  video?: boolean;
}) {
  const isVideo = slots.get(slot)?.mediaType === "video";
  const floor = <ToolThumb motif={motif} video={video} />;
  return (
    <span className="relative block">
      <SlotMedia slot={slot} slots={slots} ratio={thumbRatio(video)} sizes={sizes} whole
        className="rounded-xl" fallback={floor} />
      {isVideo && <PlayMark />}
    </span>
  );
}

/**
 * A shipped example, in the card's own frame and shown whole: the file is
 * contained, and a blurred copy of the same file (same `src` and `sizes`, so
 * the same optimised URL — one download) fills whatever the frame has left.
 *
 * `sizes` is mandatory: these are 150–300px tiles and the source files are
 * 340px wide, so without it Next would serve a far larger variant to a phone.
 */
function Photo({ src, vertical, dimmed, sizes, priority }: {
  src: string; vertical: boolean; dimmed: boolean; sizes: string; priority: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block w-full overflow-hidden rounded-xl bg-sunken ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]",
        dimmed && "opacity-55 saturate-50",
      )}
      style={{ aspectRatio: thumbRatio(vertical) }}
    >
      <WholeImage src={src} sizes={sizes} priority={priority} />
    </span>
  );
}

/**
 * A next/image shown WHOLE inside a frame that owns its ratio: contained over
 * a blurred copy of itself. Shared by the shipped examples on the cards and in
 * the GrovShot banner.
 */
export function WholeImage({ src, sizes, priority = false }: { src: string; sizes: string; priority?: boolean }) {
  // Only the picture itself is preloaded; the backdrop asks for the same URL
  // and is served from that one download.
  return (
    <>
      <Image src={src} alt="" fill sizes={sizes} loading="lazy" aria-hidden
        className="pointer-events-none scale-110 object-cover opacity-60 blur-xl" />
      <Image src={src} alt="" fill sizes={sizes} priority={priority} loading={priority ? undefined : "lazy"}
        className="object-contain" />
    </>
  );
}
