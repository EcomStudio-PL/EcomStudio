import "server-only";
import type { Metadata } from "next";
import type { PageSeo, SeoText } from "@/lib/cms";
import type { PublicPage } from "@/lib/server/public-site";

/**
 * WHAT A PUBLIC PAGE TELLS A CRAWLER.
 *
 * SEO is per page and per language, because a Polish title on the German
 * version of /cennik is worse than no title at all. Everything falls back
 * politely: the locale's own text, then Polish, then the page's own name —
 * so a page whose SEO nobody filled in still announces itself correctly
 * rather than showing a blank tab.
 *
 * NOINDEX IS HONOURED HERE AND NOWHERE ELSE, so there is exactly one place
 * that decides whether a page may be indexed. It agrees with the sitemap by
 * construction: both read the same column.
 */

/** Slugs that belong to the app shell and must never be answered from the
 *  CMS, even if somebody creates a page with that name. Mirrors
 *  `public.cms_slug_is_reserved()` — the database refuses them on write, this
 *  refuses them on read, and neither relies on the other. */
export const RESERVED_SLUGS = new Set([
  "api", "auth", "admin", "login", "register", "logout",
  "home", "dashboard", "settings", "generator", "library", "products",
  "prompts", "history", "credits", "plan", "tools", "inspirations",
  "support", "retusz", "wideo", "k", "forgot-password", "reset-password",
  "sitemap.xml", "robots.txt", "manifest.webmanifest", "_next", "favicon.ico",
  // The admin-only draft preview. /podglad/<slug> is two segments and could
  // not collide with this route anyway, but a page NAMED "podglad" would be a
  // confusing thing to own.
  "podglad",
]);

function textFor(seo: PageSeo, locale: string): SeoText {
  const byLocale = seo as Record<string, unknown>;
  const own = byLocale[locale];
  const pl = byLocale.pl;
  const pick = (value: unknown): SeoText =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as SeoText) : {};
  return { ...pick(pl), ...pick(own) };
}

/**
 * Did an admin actually write a title for this page, in this language?
 *
 * "/" needs the distinction. `pageMetadata` falls back to the page's own NAME
 * when no SEO title is set, which is right for /cennik and wrong for the front
 * door: the homepage would start announcing itself as "Strona główna" purely
 * because it is now an ordinary CMS page. Where nothing was written, "/" keeps
 * the site-wide default title it has always had.
 */
export function hasSeoTitle(seo: PageSeo, locale: string): boolean {
  return Boolean(textFor(seo ?? {}, locale).title?.trim());
}

/** The metadata for one published page. */
export function pageMetadata(page: PublicPage, locale: string, path: string): Metadata {
  const seo = page.seo ?? {};
  const text = textFor(seo, locale);
  const title = text.title?.trim() || page.title;
  const description = text.description?.trim() || undefined;
  const ogTitle = text.ogTitle?.trim() || title;
  const ogDescription = text.ogDescription?.trim() || description;
  const canonical = typeof seo.canonical === "string" && seo.canonical.trim()
    ? seo.canonical.trim()
    : path;
  const image = typeof seo.ogImage === "string" && /^https:\/\//i.test(seo.ogImage)
    ? seo.ogImage
    : undefined;

  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical },
    // A page marked noindex is excluded from the sitemap by the same column,
    // so the two can never disagree.
    robots: {
      index: seo.noindex !== true,
      follow: seo.nofollow !== true,
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: ogTitle,
      ...(ogDescription ? { description: ogDescription } : {}),
    },
  };
}
