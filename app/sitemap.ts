import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

/**
 * Only what a signed-out visitor can actually open. GrovBase is a workspace
 * behind a login: the generator, library, credits and admin are not pages a
 * crawler should be offered, so the sitemap lists the front door, the two
 * auth pages and the legal documents — and nothing else.
 */
/** Slugs the fixed list already owns or that are not public pages. */
const RESERVED_SLUGS = new Set(["home"]);

const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/login", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/register", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/polityka-prywatnosci", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/regulamin", priority: 0.3, changeFrequency: "yearly" as const },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const fixed = PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // Pages an admin published in Strony WWW belong here too — a page nobody can
  // find is barely published. Drafts are excluded by RLS as well as by the
  // filter, and the launch page has no URL of its own.
  const supabase = await createClient();
  const { data } = await supabase.from("cms_pages")
    .select("slug, published_at, kind, status")
    .eq("status", "published");
  const managed = (data ?? [])
    .filter((p) => p.kind !== "launch" && !RESERVED_SLUGS.has(p.slug))
    .map((p) => ({
      url: absoluteUrl(p.slug === "home" ? "/" : `/${p.slug}`),
      lastModified: p.published_at ? new Date(p.published_at) : now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));

  // The fixed list wins on collisions (home and the two legal pages).
  const seen = new Set(fixed.map((e) => e.url));
  return [...fixed, ...managed.filter((e) => !seen.has(e.url))];
}
