import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * The workspace is private, so crawlers are pointed at the public shell and
 * kept out of everything that needs a session. These paths are already
 * protected by middleware — this only stops crawlers wasting requests on
 * redirects and stops signed-in URLs appearing in search results at all.
 */
const PRIVATE = [
  "/admin", "/api/", "/auth/", "/home", "/dashboard", "/generator", "/library",
  "/products", "/prompts", "/history", "/credits", "/plan", "/settings",
  "/tools", "/inspirations", "/support", "/retusz", "/wideo", "/k/",
  "/reset-password",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE.map((p) => `${p}`) }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/").replace(/\/$/, ""),
  };
}
