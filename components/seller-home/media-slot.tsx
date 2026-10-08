import Image from "next/image";
import { ImageIcon, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlotMedia } from "@/components/media/slot-media";
import { SlotVideo } from "@/components/media/slot-video";
import { WholeImage } from "@/components/home/card-art";
import type { SlotMap } from "@/lib/server/media-slots";
import { ratioOf, type MediaSrc } from "@/lib/seller-home-config";

/**
 * MEDIA SLOT — the one picture frame /home uses everywhere.
 *
 * In order of authority:
 *   1. CONFIG   the file named in lib/seller-home-config.ts — an image (next/
 *               image, lazy unless `priority`) or a clip (SlotVideo: fetched
 *               only near the viewport, muted, looping, paused off-screen,
 *               poster for reduced motion);
 *   2. ADMIN    the picture an admin put on this TOOL's card in Admin → Media
 *               (the existing media-slot system), for tool tiles;
 *   3. SHIPPED  the example photograph shipped for a live tool, shown whole;
 *   4. EMPTY    a quiet brand-gradient surface with the slot's name and the
 *               size the file should be — finished-looking, never a grey hole,
 *               and never pretending to be a result.
 *
 * The frame owns its shape before a byte arrives (`ratio`, or the parent's box
 * with `fill`), so nothing on the page moves when a file loads. Server-safe:
 * no hooks here; the clip player is the only client part.
 */

type Props = {
  media: MediaSrc;
  /** CSS aspect-ratio of the frame ("2336/1744"). Defaults to the media's. */
  ratio?: string;
  /** Fill the parent box instead (the parent sets the size). */
  fill?: boolean;
  /** Shown in the empty state: what goes here. */
  label: string;
  /** Shown in the empty state: the size the file should be. */
  hint: string;
  /** Which gradient an empty slot wears, so a gallery is not one tile ×20. */
  tone?: number;
  sizes: string;
  priority?: boolean;
  /** An admin-filled media slot for this tool (tiles only). */
  admin?: { slot: string; slots: SlotMap } | null;
  /** A shipped example photo (live tools only). */
  shipped?: string | null;
  /** A quieter picture for an item that does not open (yet). */
  dim?: boolean;
  /** The empty state without its caption — for very small frames. */
  bare?: boolean;
  className?: string;
};

export function MediaSlot({
  media, ratio, fill = false, label, hint, tone = 0, sizes, priority = false,
  admin = null, shipped = null, dim = false, bare = false, className,
}: Props) {
  const shape = ratio ?? ratioOf(media);
  const frame = cn(
    fill ? "absolute inset-0" : "relative block w-full",
    "isolate overflow-hidden",
    dim && "[&_img]:opacity-60 [&_img]:saturate-[.6] [&_video]:opacity-60",
    className,
  );
  const style = fill ? undefined : { aspectRatio: shape };

  if (media.src) {
    return (
      <span className={frame} style={style} data-media-slot={media.kind} data-config-key={media.configKey}>
        {media.kind === "video"
          ? (
            <SlotVideo desktop={media.src} mobile={media.mobileSrc ?? undefined} poster={media.poster ?? undefined}
              autoplay muted loop controls={false} fit="cover" position={media.position ?? "center"}
              label={media.alt || undefined} />
          )
          : <ConfigImage media={media} sizes={sizes} priority={priority} />}
      </span>
    );
  }

  if (admin && admin.slots.has(admin.slot)) {
    return (
      <span className={frame} style={style} data-media-slot="admin" data-config-key={media.configKey}>
        <SlotMedia slot={admin.slot} slots={admin.slots} ratio={shape} sizes={sizes} priority={priority}
          className="!absolute inset-0 h-full" fallback={null} />
      </span>
    );
  }

  if (shipped) {
    return (
      <span className={cn(frame, "bg-sunken")} style={style} data-media-slot="shipped" data-config-key={media.configKey}>
        <WholeImage src={shipped} sizes={sizes} priority={priority} />
      </span>
    );
  }

  return (
    <span className={frame} style={style} data-media-slot="empty" data-config-key={media.configKey}>
      <EmptyArt tone={tone} video={media.kind === "video"} label={label} hint={hint} bare={bare} />
    </span>
  );
}

/** A config image: next/image for files we serve, a plain lazy <img> for an
 *  external URL the optimiser is not allowed to fetch. A phone version, when
 *  given, replaces it below 640px (art direction, not a resize). */
function ConfigImage({ media, sizes, priority }: { media: MediaSrc; sizes: string; priority: boolean }) {
  const pos = { objectPosition: media.position ?? "center" };
  const one = (src: string, cls: string) => src.startsWith("/")
    ? (
      <Image src={src} alt={media.alt ?? ""} fill sizes={sizes} priority={priority}
        loading={priority ? undefined : "lazy"} className={cn("object-cover", cls)} style={pos} />
    )
    : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={media.alt ?? ""} loading={priority ? "eager" : "lazy"} decoding="async"
        className={cn("absolute inset-0 h-full w-full object-cover", cls)} style={pos} />
    );
  if (!media.src) return null;
  if (!media.mobileSrc) return one(media.src, "");
  return (
    <>
      {one(media.mobileSrc, "sm:hidden")}
      {one(media.src, "max-sm:hidden")}
    </>
  );
}

/**
 * THE EMPTY SLOT — a soft wash of the brand's own colours (six variations, so
 * twenty empty tiles still read as a gallery), a faint diagonal sheen, and a
 * small caption: the slot's name and the file size it wants. Decorative to a
 * screen reader — the card around it carries the real label.
 */
const TONES: readonly [string, string][] = [
  ["var(--accent)", "var(--violet)"],
  ["var(--violet)", "var(--accent-glow)"],
  ["var(--accent-glow)", "var(--purple)"],
  ["var(--purple)", "var(--accent)"],
  ["var(--accent)", "var(--accent-glow)"],
  ["var(--violet)", "var(--accent)"],
];

export function EmptyArt({ tone = 0, video = false, label, hint, bare = false, icon = true }: {
  tone?: number; video?: boolean; label: string; hint: string; bare?: boolean;
  /** The centred icon chip — off when the parent places its own. */
  icon?: boolean;
}) {
  const [a, b] = TONES[((tone % TONES.length) + TONES.length) % TONES.length];
  return (
    <span aria-hidden className="absolute inset-0 block bg-sunken" style={{
      backgroundImage:
        `radial-gradient(120% 90% at 85% 8%, rgb(${a} / 0.18), transparent 60%),`
        + `radial-gradient(100% 85% at 6% 100%, rgb(${b} / 0.15), transparent 62%),`
        + "linear-gradient(115deg, transparent 38%, rgb(255 255 255 / 0.06) 50%, transparent 62%)",
    }}>
      <span className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[rgb(var(--glass-border)/0.12)]" />
      {icon && (
        <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgb(var(--surface)/0.55)] text-[rgb(var(--ink)/0.45)] ring-1 ring-[rgb(var(--glass-border)/0.18)] backdrop-blur-sm">
          {video ? <Play size={14} className="translate-x-[1px]" /> : <ImageIcon size={15} strokeWidth={1.8} />}
        </span>
      )}
      {!bare && (
        <span className="absolute inset-x-2.5 bottom-2 flex items-center gap-2 text-[10px] leading-none text-[rgb(var(--ink)/0.42)]">
          <span className="min-w-0 truncate">{label}</span>
          <span className="ml-auto shrink-0 tabular-nums">{hint}</span>
        </span>
      )}
    </span>
  );
}
