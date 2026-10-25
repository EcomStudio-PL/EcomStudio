import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { publicToolSitemapPaths } from "@/lib/server/public-tool-meta";

/**
 * The workspace is private, so crawlers are pointed at the public shell and
 * kept out of everything that needs a session. These paths are already
 * protected by middleware — this only stops crawlers wasting requests on
 * redirects and stops signed-in URLs appearing in search results at all.
 */
const PRIVATE = [
  "/admin", "/api/", "/auth/", "/home", "/dashboard", "/generator", "/library",
  "/prompts", "/history", "/credits", "/settings",
  // The in-app cennik and its subtree only — NOT every path that starts
  // "/plan": the public cennik is /plany and must stay crawlable.
  "/plan$", "/plan/", "/plan?",
  // /profile only forwards to /settings?tab=profile — the page and its subtree,
  // not every public slug that merely starts "profile".
  "/profile$", "/profile/",
  "/tools", "/inspirations", "/support", "/retusz", "/wideo", "/k/",
  "/reset-password",
  // The double opt-in landing. Its token lives in the fragment and never in
  // an indexable URL, and the page itself is noindex — but a crawler has no
  // business there at all.
  "/potwierdz-zapis",
  // GrovNews Premium is subscriber content; its public face is /blog. The
  // page and its subtree only — not every public path that starts "grovnews".
  "/grovnews$", "/grovnews/",
];

/**
 * PUBLIC TOOLS V1: while the switch is on, the catalogue and the listed tools
 * are pages a visitor can open, so they are allowed — by their exact address,
 * ahead of the private prefixes they live under (the longest match wins). Off,
 * the list is exactly the one above.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const open = await publicToolSitemapPaths();
  return {
    rules: open.length === 0
      ? [{ userAgent: "*", allow: "/", disallow: PRIVATE.map((p) => `${p}`) }]
      : [{ userAgent: "*", allow: ["/", ...open.map((p) => `${p}$`)], disallow: PRIVATE.map((p) => `${p}`) }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/").replace(/\/$/, ""),
  };
}
