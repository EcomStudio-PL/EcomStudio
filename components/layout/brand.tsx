import Link from "next/link";

/** EcomStudio brand mark: viewfinder frame + product focus point.
 *  Works standalone (collapsed sidebar, favicon) or with the wordmark. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M11 4H7a3 3 0 0 0-3 3v4" stroke="rgb(248 0 248)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M21 28h4a3 3 0 0 0 3-3v-4" stroke="rgb(248 0 248)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M28 11V7a3 3 0 0 0-3-3h-4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
      <path d="M4 21v4a3 3 0 0 0 3 3h4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
      <rect x="11" y="11" width="10" height="10" rx="3" fill="rgb(248 0 248)" />
      <rect x="14.2" y="14.2" width="3.6" height="3.6" rx="1.2" fill="rgb(16 16 20)" />
    </svg>
  );
}

export function Brand({ href = "/", markOnly = false }: { href?: string; markOnly?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
      <BrandMark />
      {!markOnly && (
        <span className="inline-flex items-baseline gap-0.5 leading-none">
          <span>ecom</span>
          <span className="text-accent">studio</span>
        </span>
      )}
    </Link>
  );
}
