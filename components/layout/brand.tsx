import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * GROVBASE LOGO — the single brand component for the whole product.
 *
 * All artwork comes from the official master assets in /public/brand
 * (generated losslessly from the supplied PNGs — never redrawn in CSS):
 *   mark.png        — the pink G symbol alone, transparent
 *   text-dark.png   — "GrovBase" wordmark text, WHITE, for dark surfaces
 *   text-light.png  — "GrovBase" wordmark text, BLACK, for light surfaces
 *   wordmark-*.png  — symbol + text combined, for standalone brand areas
 *
 * Theme switching is pure CSS (`dark:` classes on the two text images), so
 * the correct variant is right on the server render with no flash and no
 * hydration dance. Sizes are fixed via width/height attributes so the logo
 * never causes layout shift and is never stretched.
 */

/** The G symbol alone — compact chrome, collapsed rails, small surfaces. */
export function BrandMark({ size = 26 }: { size?: number }) {
  // Master is 253x256; near-square, rendered square-height with true ratio.
  const w = Math.round(size * (253 / 256));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/mark.png" alt="" aria-hidden width={w} height={size} className="shrink-0 select-none" />
  );
}

/** Wordmark text at a given pixel height (master 685x120). */
function BrandText({ height = 18, className }: { height?: number; className?: string }) {
  const w = Math.round(height * (685 / 120));
  return (
    <span className={cn("inline-flex items-center", className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/text-light.png" alt="" width={w} height={height} className="select-none dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/text-dark.png" alt="" width={w} height={height} className="hidden select-none dark:inline" />
    </span>
  );
}

/**
 * BRAND — exactly one mark and (optionally) one wordmark.
 *
 * The wordmark is hidden with a class rather than by rendering a second
 * `Brand`, so no layout can ever end up showing the mark twice.
 */
export function Brand({ href = "/", markOnly = false, className, wordmarkClassName }: {
  href?: string;
  markOnly?: boolean;
  className?: string;
  /** Responsive visibility for the wordmark, e.g. "hidden sm:inline-flex". */
  wordmarkClassName?: string;
}) {
  return (
    <Link href={href} aria-label="GrovBase" className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark />
      {!markOnly && <BrandText className={wordmarkClassName} />}
    </Link>
  );
}
