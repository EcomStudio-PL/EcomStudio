import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * GROVBASE LOGO — the single brand component for the whole product.
 *
 * Every pixel comes from the official master artwork in /public/brand,
 * downscaled losslessly from the supplied files and never redrawn, recoloured
 * or typeset in CSS:
 *
 *   logo-on-dark.png   — full lockup, WHITE wordmark: for DARK surfaces
 *   logo-on-light.png  — full lockup, BLACK wordmark: for LIGHT surfaces
 *   icon.png           — the gradient symbol alone, transparent
 *   app-icon.png       — the square gradient app icon (favicon / PWA source)
 *
 * The two lockups are named after the BACKGROUND they sit on, not the colour
 * of their own letters — "logo-on-dark" is the one you put on a dark header.
 *
 * Both are real assets, so the wordmark keeps the designer's own kerning and
 * the symbol keeps its own gradient: no invert(), no blend mode, no filter.
 * Which one shows is pure CSS (`dark:`), so the right variant is already
 * correct in the server render — the theme can flip live with no flash, no
 * hydration mismatch and no second source of theme state. Width and height
 * are fixed from the true aspect ratio, so the logo never shifts layout and
 * is never stretched.
 */

/** Master geometry — used to derive width from a requested pixel height. */
const LOCKUP = 922 / 200;
const ICON = 337 / 256;

/** The symbol alone — compact chrome, collapsed rails, small surfaces. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/icon.png" alt="" aria-hidden
      width={Math.round(size * ICON)} height={size}
      className="h-auto w-auto shrink-0 select-none object-contain"
      style={{ height: size, width: Math.round(size * ICON) }} />
  );
}

/**
 * BRAND — the mark, or the full lockup, once.
 *
 * `markOnly` swaps in the symbol; `wordmarkClassName` can hide the lockup at
 * narrow widths (the mark then stands in), which is how the topbar keeps the
 * brand legible on a phone without ever painting it twice.
 */
export function Brand({ href = "/", markOnly = false, height = 30, className, wordmarkClassName }: {
  href?: string;
  markOnly?: boolean;
  /** Rendered height of the lockup (or the mark) in px. */
  height?: number;
  className?: string;
  /** Responsive visibility for the lockup, e.g. "hidden sm:inline-flex". */
  wordmarkClassName?: string;
}) {
  const width = Math.round(height * LOCKUP);
  return (
    <Link href={href} aria-label="GrovBase" className={cn("inline-flex items-center", className)}>
      {markOnly ? (
        <BrandMark size={height} />
      ) : (
        <span className={cn("inline-flex items-center", wordmarkClassName)} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-on-light.png" alt="" width={width} height={height}
            style={{ height, width }}
            className="select-none object-contain dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-on-dark.png" alt="" width={width} height={height}
            style={{ height, width }}
            className="hidden select-none object-contain dark:inline" />
        </span>
      )}
      {/* A lockup hidden by `wordmarkClassName` leaves the mark in its place,
          so the brand is present at every width and duplicated at none. */}
      {!markOnly && wordmarkClassName && (
        <span className={cn("inline-flex items-center", flipVisibility(wordmarkClassName))}>
          <BrandMark size={height} />
        </span>
      )}
    </Link>
  );
}

/** "hidden sm:inline-flex" → "sm:hidden": show the mark exactly where the
 *  lockup is hidden, without every caller having to spell both out. */
function flipVisibility(cls: string): string {
  return cls
    .split(/\s+/)
    .map((c) => (c === "hidden" ? null : c.endsWith(":inline-flex") || c.endsWith(":inline") || c.endsWith(":flex")
      ? `${c.split(":")[0]}:hidden`
      : null))
    .filter(Boolean)
    .join(" ");
}
