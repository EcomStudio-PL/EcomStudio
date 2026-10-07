import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaPair, MediaSrc } from "@/lib/seller-home-config";

/**
 * MEDIA SLOT — the one picture frame /home uses everywhere.
 *
 * Three states, one frame of a fixed ratio (nothing jumps when a file
 * arrives):
 *   - EMPTY   a quiet neutral surface with an image glyph, the slot's name and
 *             the size the picture should be — so the owner knows what goes
 *             here, and a customer sees a calm card, not a loud placeholder;
 *   - SINGLE  one picture;
 *   - PAIR    before | after, split down the middle (the interactive version
 *             is BeforeAfter, in before-after.tsx).
 *
 * Pictures come from lib/seller-home-config.ts (files in /public), rendered
 * by next/image with their real width/height, lazily unless `priority`.
 * Server-safe: no hooks, so both server and client components use it.
 */

export type SlotRatio = "4/3" | "1/1";

const RATIO_CLASS: Record<SlotRatio, string> = { "4/3": "aspect-[4/3]", "1/1": "aspect-square" };

export function MediaSlot({
  ratio = "4/3", label, hint, media, pair, pairLabels, alt = "", sizes = "(max-width: 639px) 80vw, 25vw",
  priority = false, className, compact = false,
}: {
  ratio?: SlotRatio;
  /** Shown in the empty state: what this slot is ("Miniaturka — przed/po"). */
  label: string;
  /** Shown in the empty state: the recommended file size ("1200×900 px"). */
  hint: string;
  media?: MediaSrc | null;
  pair?: MediaPair | null;
  /** "Przed" / "Po" captions for a filled pair. */
  pairLabels?: { before: string; after: string };
  alt?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  /** Smaller glyph and type for small frames (samples, thumbnails). */
  compact?: boolean;
}) {
  const frame = cn("relative isolate overflow-hidden", RATIO_CLASS[ratio], className);

  if (pair && pair.before.src && pair.after.src) {
    return (
      <div className={frame} data-media-slot="pair">
        <SlotImage media={pair.after} alt={alt} sizes={sizes} priority={priority} />
        <div className="absolute inset-0" style={{ clipPath: "inset(0 50% 0 0)" }}>
          <SlotImage media={pair.before} alt={alt} sizes={sizes} priority={priority} />
        </div>
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/80 shadow-[0_0_0_1px_rgb(0_0_0/0.08)]" />
        {pairLabels && <PairCaptions labels={pairLabels} />}
      </div>
    );
  }
  const single = media?.src ? media : pair?.after.src ? pair.after : null;
  if (single) {
    return (
      <div className={frame} data-media-slot="single">
        <SlotImage media={single} alt={alt} sizes={sizes} priority={priority} />
      </div>
    );
  }
  return (
    <div className={cn(frame, "slot-empty")} data-media-slot="empty">
      <EmptySlot label={label} hint={hint} compact={compact} />
    </div>
  );
}

/** The empty state on its own — also used under an admin-filled slot. */
export function EmptySlot({ label, hint, compact = false, className }: {
  label: string; hint: string; compact?: boolean; className?: string;
}) {
  return (
    <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgb(var(--ink)/0.035)] px-3 text-center dark:bg-[rgb(var(--ink)/0.05)]", className)}>
      <span aria-hidden className={cn(
        "flex items-center justify-center rounded-xl bg-[rgb(var(--surface))] text-muted shadow-[inset_0_0_0_1px_rgb(var(--hairline)/var(--hairline-alpha))]",
        compact ? "h-7 w-7" : "h-10 w-10",
      )}>
        <ImageIcon size={compact ? 14 : 18} strokeWidth={1.8} />
      </span>
      {!compact && <span className="line-clamp-2 text-[12px] font-medium leading-snug text-muted">{label}</span>}
      <span className={cn("tabular-nums text-muted", compact ? "text-[10px]" : "text-[11px]")}>{hint}</span>
    </div>
  );
}

export function SlotImage({ media, alt, sizes, priority, className }: {
  media: MediaSrc; alt: string; sizes: string; priority?: boolean; className?: string;
}) {
  if (!media.src) return null;
  return (
    <Image src={media.src} alt={alt} width={media.width} height={media.height} sizes={sizes}
      priority={priority} loading={priority ? undefined : "lazy"}
      className={cn("absolute inset-0 h-full w-full object-cover", className)} />
  );
}

function PairCaptions({ labels }: { labels: { before: string; after: string } }) {
  const cls = "absolute bottom-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white";
  return (
    <>
      <span className={cn(cls, "left-2")}>{labels.before}</span>
      <span className={cn(cls, "right-2")}>{labels.after}</span>
    </>
  );
}
