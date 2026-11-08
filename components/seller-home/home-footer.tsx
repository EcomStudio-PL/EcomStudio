"use client";
import { usePathname } from "next/navigation";

/**
 * THE SITE FOOTER UNDER /home — the public site's own SiteFooter
 * (components/cms/site-shell.tsx), rendered by the (app) layout on the server
 * and shown by this switch on /home only.
 *
 * Why a client switch and not a server condition: the (app) layout is NOT
 * rendered again when a customer moves between its pages in the browser, so a
 * footer decided from the first request's path would stay on /tools after a
 * click from /home (or be missing on /home after a click from /tools). The
 * pathname here is always the page on screen.
 *
 * It sits after the layout's <main>, so the order is the page's sections
 * (Nadchodzi last), then „Zgłoś błąd / zaproponuj zmianę” (the end of
 * <main>), then the footer. Its room under the phone navigation and under the
 * „Edytuj stronę” button is globals.css `[data-home-footer]`.
 */
export function HomeFooter({ children }: { children: React.ReactNode }) {
  return usePathname() === "/home" ? <div data-home-footer="">{children}</div> : null;
}
