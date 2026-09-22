import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Play } from "lucide-react";
import type { CardArt } from "@/lib/home-sections";
import { ToolThumb } from "@/components/tools/tool-thumb";
import { SlotMedia } from "@/components/media/slot-media";
import type { SlotMap } from "@/lib/server/media-slots";
import { cn } from "@/lib/utils";

/**
 * THE PICTURE ON A HOMEPAGE CARD, in strict order of authority:
 *
 *   1. what an ADMIN put in the media slot for this card
 *   2. the example photograph shipped for this tool, if the tool runs
 *   3. the drawn motif, which states the operation and claims nothing
 *
 * (1) is first because it is the only one that can be a picture of what THIS
 * customer's product looks like after THIS tool has run. The slot system
 * already exists (migration 0090, lib/media-slots.ts) and already dresses the
 * dashboard and the tool catalogue; the homepage joins it rather than
 * inventing a second way to put a picture on a card.
 *
 * (3) is the floor, and it is a real floor rather than a grey box: a brand
 * gradient with geometry that says what the tool does. A card is never empty.
 */
export function CardArt({
  art, icon, slot, slots, ratio = "4/5", dimmed = false, sizes, priority = false, video = false,
}: {
  art: CardArt;
  icon: LucideIcon;
  /** The media-slot key an admin can fill for this card, when it has one. */
  slot?: string;
  slots?: SlotMap;
  ratio?: "4/5" | "16/9" | "16/10";
  /** A card whose tool cannot be opened reads quieter, so the live ones keep
   *  the eye. Matches the tool catalogue's own treatment. */
  dimmed?: boolean;
  sizes?: string;
  priority?: boolean;
  /** Draws the play affordance. Only ever true for the video section, which is
   *  inert — the triangle says "this is a video tool", not "press me". */
  video?: boolean;
}) {
  // ONE SHAPE PER ROW, whatever is inside it. The motif is drawn at the card's
  // ratio rather than at the catalogue's default, because a row of cards where
  // the photographed ones are 4/5 and the drawn ones are 16/10 puts every
  // second label on a different line and reads as a rendering fault.
  const motifRatio = ratio === "4/5" ? "4/5" : "16/10";
  const fallback = art.kind === "photo"
    ? <Photo src={art.src} ratio={ratio} dimmed={dimmed} sizes={sizes} priority={priority} />
    : <ToolThumb motif={art.motif} icon={icon} dimmed={dimmed} ratio={motifRatio} />;

  const body = slot && slots
    ? <SlotMedia slot={slot} slots={slots} ratio={ratio.replace("/", "/")} sizes={sizes ?? "(max-width: 640px) 45vw, 18vw"}
        className={cn("rounded-xl", dimmed && "opacity-55 saturate-50")} fallback={fallback} />
    : fallback;

  if (!video) return <>{body}</>;
  return (
    <span className="relative block">
      {body}
      <span aria-hidden className="pointer-events-none absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--bg)/0.66)] text-ink backdrop-blur-sm ring-1 ring-[rgb(var(--glass-border)/0.22)]">
        <Play size={12} className="translate-x-[1px]" />
      </span>
    </span>
  );
}

/**
 * A shipped example.
 *
 * `sizes` is mandatory in spirit: these are 180–320px cards and the source
 * files are 360px wide, so without it Next would serve the 640px variant to a
 * phone showing two per row. The frame owns the ratio before the byte arrives,
 * so nothing on the page moves when it does.
 */
function Photo({ src, ratio, dimmed, sizes, priority }: {
  src: string; ratio: string; dimmed: boolean; sizes?: string; priority: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block w-full overflow-hidden rounded-xl bg-sunken ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]",
        dimmed && "opacity-55 saturate-50",
      )}
      style={{ aspectRatio: ratio }}
    >
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes ?? "(max-width: 640px) 45vw, (max-width: 1024px) 24vw, 15vw"}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className="object-cover"
      />
    </span>
  );
}
