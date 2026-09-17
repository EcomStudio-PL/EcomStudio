import "server-only";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getPublishedPage } from "@/lib/server/public-site";
import { pageMetadata } from "@/lib/server/cms-page";

/**
 * WHAT REGULAMIN AND POLITYKA PRYWATNOŚCI TELL A CRAWLER.
 *
 * These two keep their own routes — they are linked from the footer, the
 * signup consent line and the sitemap, and those links must not change. But
 * their SEO belongs with the rest of the CMS, so once an admin publishes one,
 * the title and description they wrote in Ustawienia strony are what a search
 * result shows.
 *
 * Until then the page is a draft and there is nothing to read, so it falls
 * back to its own heading — which is what these routes have always done.
 */
export async function legalMetadata(slug: string, titleKey: string): Promise<Metadata> {
  const supabase = await createClient();
  const [page, { dict, locale }] = await Promise.all([
    getPublishedPage(supabase, slug),
    getDictionary(),
  ]);
  const t = makeT(dict);
  if (!page) {
    return {
      title: t(titleKey),
      alternates: { canonical: `/${slug}` },
      openGraph: { url: `/${slug}`, title: t(titleKey) },
    };
  }
  return pageMetadata(page, locale, `/${slug}`);
}
