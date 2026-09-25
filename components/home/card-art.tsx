import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Play } from "lucide-react";
import type { CardArt } from "@/lib/home-sections";
import { TOOL_THUMB_RATIO, ToolThumb, type ToolMotif } from "@/components/tools/tool-thumb";
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
 * so nothing on the page moves when a picture does. That ratio is always
 * TOOL_THUMB_RATIO (5:4): no card on the Start picks a shape of its own.
 */
export function CardArt({
  art, icon, slot, slots, dimmed = false, sizes, priority = false, video = false,
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
}) {
  const fallback = art.kind === "photo"
    ? <Photo src={art.src} dimmed={dimmed} sizes={sizes} priority={priority} />
    : <ToolThumb motif={art.motif} icon={icon} dimmed={dimmed} />;

  const body = (
    <SlotMedia slot={slot} slots={slots} ratio={TOOL_THUMB_RATIO} sizes={sizes} priority={priority}
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
 * be a creative GrovBase made. Every tile is 5:4 (TOOL_THUMB_RATIO), the same
 * frame as a tool card.
 */
export function GalleryArt({ slot, slots, motif, sizes }: {
  slot: string;
  slots: SlotMap;
  motif: ToolMotif;
  sizes: string;
}) {
  const isVideo = slots.get(slot)?.mediaType === "video";
  const floor = <ToolThumb motif={motif} />;
  return (
    <span className="relative block">
      <SlotMedia slot={slot} slots={slots} ratio={TOOL_THUMB_RATIO} sizes={sizes}
        className="rounded-xl" fallback={floor} />
      {isVideo && <PlayMark />}
    </span>
  );
}

/**
 * A shipped example.
 *
 * `sizes` is mandatory: these are 150–300px tiles and the source files are
 * 340px wide, so without it Next would serve a far larger variant to a phone.
 */
function Photo({ src, dimmed, sizes, priority }: {
  src: string; dimmed: boolean; sizes: string; priority: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block w-full overflow-hidden rounded-xl bg-sunken ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]",
        dimmed && "opacity-55 saturate-50",
      )}
      style={{ aspectRatio: TOOL_THUMB_RATIO }}
    >
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className="object-cover"
      />
    </span>
  );
}
