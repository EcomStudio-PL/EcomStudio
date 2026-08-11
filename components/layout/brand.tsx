import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-baseline gap-0.5 font-display text-lg font-semibold tracking-tight">
      <span className="frame-mark px-1">ecom</span>
      <span className="text-accent">studio</span>
    </Link>
  );
}
