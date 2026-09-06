"use client";
import { usePathname } from "next/navigation";
import type { AuthMode } from "@/lib/auth-routes";
import { useOptionalAuthDialog } from "@/components/auth/auth-dialog-context";

/**
 * "Zaloguj się" / "Załóż konto".
 *
 * A real anchor, so middle-click, "open in new tab" and the status bar stay
 * honest and the link works before hydration. But a PLAIN left click never
 * navigates: it opens the dialog from React state in the same tick, and the
 * address bar catches up via history.pushState. Going through Next's <Link>
 * is what used to make the dialog wait for an RSC round trip — see
 * auth-dialog-context.tsx.
 */
export function AuthLink({ mode, className, children, next, ...rest }: {
  mode: AuthMode;
  className?: string;
  children: React.ReactNode;
  /** Explicit returnTo; otherwise the one already in the URL is carried on. */
  next?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "className" | "children">) {
  const pathname = usePathname();
  const dialog = useOptionalAuthDialog();

  // The href is the no-JS / new-tab fallback, and what a hover preview shows.
  const q = new URLSearchParams();
  q.set("auth", mode);
  if (next && next.startsWith("/") && !next.startsWith("//")) q.set("next", next);
  const href = `${pathname}?${q.toString()}`;

  return (
    <a
      {...rest}
      href={href}
      className={className}
      onClick={(e) => {
        // Leave every modified click to the browser: new tab, new window,
        // download, and anything a parent already handled.
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!dialog) return;
        e.preventDefault();
        dialog.open(mode, next);
      }}
    >
      {children}
    </a>
  );
}
