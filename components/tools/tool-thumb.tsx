import type { LucideIcon } from "lucide-react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE CATALOGUE THUMBNAIL.
 *
 * Every card in the tools hub is led by a wide preview, because a seller
 * scanning a catalogue recognises a picture before a word. These previews are
 * DRAWN, not photographed: a stock shot next to "Usuń tło" would be claiming
 * an output GrovBase did not produce, and a real before/after belongs to a
 * customer's own library, not to a menu.
 *
 * So each motif states the OPERATION in geometry — a diagonal wipe for a
 * before/after, a transparency checker for a cut-out, a swatch row for a
 * colour change, an expanding frame for a wider crop — over the brand's own
 * gradient, with the tool's icon as the anchor. Nothing here is an asset to
 * download or a file to keep in sync: it is CSS and one icon.
 */

export type ToolMotif =
  | "wipe" | "cutout" | "swatch" | "shadow" | "frame" | "grid"
  | "scale" | "compress" | "stamp" | "spark" | "video";

/** Per-motif hue, so a row of six cards reads as six things, not one thing
 *  six times. Values are brand tokens — never a colour typed by hand. */
const TONE: Record<ToolMotif, { from: string; to: string }> = {
  wipe: { from: "var(--accent)", to: "var(--violet)" },
  cutout: { from: "var(--violet)", to: "var(--accent)" },
  swatch: { from: "var(--accent-glow)", to: "var(--violet)" },
  shadow: { from: "var(--purple)", to: "var(--accent)" },
  frame: { from: "var(--accent)", to: "var(--accent-glow)" },
  grid: { from: "var(--violet)", to: "var(--accent-glow)" },
  scale: { from: "var(--accent-glow)", to: "var(--accent)" },
  compress: { from: "var(--purple)", to: "var(--violet)" },
  stamp: { from: "var(--accent)", to: "var(--purple)" },
  spark: { from: "var(--accent-glow)", to: "var(--violet)" },
  video: { from: "var(--violet)", to: "var(--accent)" },
};

export function ToolThumb({ motif, icon: Icon, dimmed = false }: {
  motif: ToolMotif;
  icon: LucideIcon;
  /** A tool that cannot be opened yet reads quieter, so the row's live tools
   *  keep the eye. */
  dimmed?: boolean;
}) {
  const tone = TONE[motif];
  return (
    <span aria-hidden className={cn(
      "relative block aspect-[16/10] w-full overflow-hidden rounded-xl bg-sunken",
      dimmed && "opacity-55 saturate-50",
    )}>
      {/* The ground: a soft brand wash, brightest where the motif sits. */}
      <span className="absolute inset-0" style={{
        background:
          `radial-gradient(120% 90% at 78% 12%, rgb(${tone.from} / 0.42), transparent 62%),`
          + `radial-gradient(90% 80% at 8% 96%, rgb(${tone.to} / 0.30), transparent 66%),`
          + "rgb(var(--sunken))",
      }} />
      <Motif motif={motif} />
      {/* The icon anchors the card and names the operation for anyone who does
          not read the geometry. */}
      <span className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[rgb(var(--bg)/0.62)] text-ink backdrop-blur-sm ring-1 ring-[rgb(var(--glass-border)/0.22)]">
        <Icon size={14} />
      </span>
      {/* A hairline lift so the thumb reads as a surface, not a hole. */}
      <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-[rgb(var(--glass-border)/0.14)]" />
    </span>
  );
}

/** The geometry that says which operation this is. */
function Motif({ motif }: { motif: ToolMotif }) {
  switch (motif) {
    // Before / after: one diagonal, two halves, a lit seam down the middle.
    case "wipe":
      return (
        <>
          <span className="absolute inset-0" style={{
            background: "linear-gradient(108deg, rgb(var(--ink) / 0.10) 0 46%, transparent 46%)",
          }} />
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rotate-[9deg] bg-[rgb(var(--accent-glow)/0.85)]" />
        </>
      );
    // Cut-out: the transparency checker the whole industry reads instantly.
    case "cutout":
      return (
        <>
          <span className="absolute inset-0 opacity-45" style={{
            backgroundImage:
              "linear-gradient(45deg, rgb(var(--ink) / 0.16) 25%, transparent 25%, transparent 75%, rgb(var(--ink) / 0.16) 75%),"
              + "linear-gradient(45deg, rgb(var(--ink) / 0.16) 25%, transparent 25%, transparent 75%, rgb(var(--ink) / 0.16) 75%)",
            backgroundSize: "14px 14px",
            backgroundPosition: "0 0, 7px 7px",
          }} />
          <span className="absolute inset-x-[30%] inset-y-[22%] rounded-lg bg-[rgb(var(--surface)/0.9)] shadow-[0_10px_24px_-10px_rgb(0_0_0/0.8)]" />
        </>
      );
    // Colour change: a row of swatches, one of them lit.
    case "swatch":
      return (
        <span className="absolute inset-x-[12%] top-1/2 flex -translate-y-1/2 gap-1.5">
          {[0.9, 0.55, 0.35, 0.2, 0.12].map((a, i) => (
            <span key={i} className="h-6 flex-1 rounded-md"
              style={{ background: `rgb(var(--accent) / ${a})` }} />
          ))}
        </span>
      );
    // Shadow: an object and the pool of light it drops.
    case "shadow":
      return (
        <>
          {/* The object has to read as an OBJECT — at 0.92 alpha over a dark
              wash it looked like a redaction bar, so it is a lit face with a
              rim, and the shadow is a soft pool rather than a black slab. */}
          <span className="absolute left-1/2 top-[24%] h-[40%] w-[28%] -translate-x-1/2 rounded-md bg-[linear-gradient(160deg,rgb(var(--ink)/0.92),rgb(var(--ink)/0.55))] shadow-[0_8px_18px_-8px_rgb(0_0_0/0.9)]" />
          <span className="absolute left-1/2 top-[67%] h-3 w-[46%] -translate-x-1/2 rounded-[50%] bg-[rgb(var(--accent)/0.30)] blur-[6px]" />
        </>
      );
    // Wider crop: the original frame, and the one it grows into.
    case "frame":
      return (
        <>
          <span className="absolute inset-[16%] rounded-lg border border-dashed border-[rgb(var(--accent)/0.75)]" />
          <span className="absolute inset-[30%] rounded-md bg-[rgb(var(--surface)/0.85)]" />
        </>
      );
    // A set: many frames of one thing.
    case "grid":
      return (
        <span className="absolute inset-[15%] grid grid-cols-3 grid-rows-2 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="rounded-[3px] bg-[rgb(var(--surface)/0.82)]"
              style={{ opacity: 1 - i * 0.11 }} />
          ))}
        </span>
      );
    // Resize: the same rectangle at two sizes, corner to corner.
    case "scale":
      return (
        <>
          <span className="absolute left-[14%] top-[18%] h-[58%] w-[52%] rounded-md border border-[rgb(var(--accent)/0.7)]" />
          <span className="absolute left-[34%] top-[38%] h-[38%] w-[34%] rounded-md bg-[rgb(var(--surface)/0.88)]" />
        </>
      );
    // Compression: the same picture, fewer bars.
    case "compress":
      return (
        <span className="absolute inset-x-[14%] bottom-[20%] flex h-[52%] items-end gap-1">
          {[100, 74, 52, 36, 24, 16].map((h, i) => (
            <span key={i} className="flex-1 rounded-t-sm bg-[rgb(var(--accent)/0.55)]"
              style={{ height: `${h}%` }} />
          ))}
        </span>
      );
    // Watermark: a repeating mark across the frame.
    case "stamp":
      return (
        <span className="absolute inset-0 flex flex-col justify-center gap-2 opacity-70">
          {[0, 1, 2].map((r) => (
            <span key={r} className="flex gap-3 pl-[8%]" style={{ transform: `translateX(${r % 2 ? 10 : -6}px)` }}>
              {[0, 1, 2].map((cIdx) => (
                <span key={cIdx} className="h-1.5 w-10 -rotate-[18deg] rounded-full bg-[rgb(var(--ink)/0.5)]" />
              ))}
            </span>
          ))}
        </span>
      );
    // Generation: light gathering into a new frame.
    case "spark":
      return (
        <>
          <span className="absolute inset-[22%] rounded-lg bg-[rgb(var(--surface)/0.55)] ring-1 ring-[rgb(var(--accent)/0.45)]" />
          <span className="absolute right-[16%] top-[16%] h-10 w-10 rounded-full bg-[rgb(var(--accent-glow)/0.5)] blur-[10px]" />
        </>
      );
    // Video: the frame, and the button everyone knows.
    case "video":
      return (
        <>
          <span className="absolute inset-x-0 top-0 flex h-2.5 items-center justify-between px-1 opacity-45">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-[2px] bg-[rgb(var(--ink)/0.45)]" />
            ))}
          </span>
          <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgb(var(--bg)/0.6)] ring-1 ring-[rgb(var(--glass-border)/0.3)] backdrop-blur-sm">
            <Play size={13} className="ml-0.5 fill-current text-ink" />
          </span>
        </>
      );
  }
}
