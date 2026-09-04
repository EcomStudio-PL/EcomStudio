import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * Only what a signed-out visitor can actually open. GrovBase is a workspace
 * behind a login: the generator, library, credits and admin are not pages a
 * crawler should be offered, so the sitemap lists the front door, the two
 * auth pages and the legal documents — and nothing else.
 */
const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/login", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/register", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/polityka-prywatnosci", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/regulamin", priority: 0.3, changeFrequency: "yearly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
