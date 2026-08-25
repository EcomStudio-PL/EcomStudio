import Link from "next/link";
import { cn } from "@/lib/utils";

/** EcomStudio brand mark: viewfinder frame + product focus point.
 *  Works standalone (favicon, compact chrome) or with the wordmark. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M11 4H7a3 3 0 0 0-3 3v4" stroke="rgb(var(--accent))" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M21 28h4a3 3 0 0 0 3-3v-4" stroke="rgb(var(--accent))" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M28 11V7a3 3 0 0 0-3-3h-4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
      <path d="M4 21v4a3 3 0 0 0 3 3h4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
      <rect x="11" y="11" width="10" height="10" rx="3" fill="rgb(var(--accent))" />
      <rect x="14.2" y="14.2" width="3.6" height="3.6" rx="1.2" fill="rgb(var(--bg))" />
    </svg>
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
    <Link href={href} className={cn("inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight", className)}>
      <BrandMark />
      {!markOnly && (
        <span className={cn("inline-flex items-baseline gap-0.5 leading-none", wordmarkClassName)}>
          <span>ecom</span>
          <span className="text-accent">studio</span>
        </span>
      )}
    </Link>
  );
}
