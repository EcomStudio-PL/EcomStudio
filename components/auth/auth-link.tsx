"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { AuthMode } from "@/lib/auth-routes";

/**
 * "Zaloguj się" / "Załóż konto" — an ordinary link that happens to open the
 * dialog, because the dialog's state IS the URL.
 *
 * A real <Link> and not a button: it keeps middle-click, "open in new tab" and
 * the status bar honest, it works before hydration, and Next's client router
 * turns the click into a push without reloading the page underneath.
 */
export function AuthLink({ mode, className, children, next }: {
  mode: AuthMode;
  className?: string;
  children: React.ReactNode;
  /** Explicit returnTo; otherwise the one already in the URL is carried on. */
  next?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const q = new URLSearchParams();
  q.set("auth", mode);
  const carried = next ?? params.get("next") ?? "";
  if (carried.startsWith("/") && !carried.startsWith("//")) q.set("next", carried);
  return (
    <Link href={`${pathname}?${q.toString()}`} scroll={false} className={className}>
      {children}
    </Link>
  );
}
