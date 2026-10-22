import "server-only";
import type { Metadata } from "next";
import type { PageSeo, SeoText } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getPublishedPage, type PublicPage } from "@/lib/server/public-site";
import { pageMetadata } from "@/lib/server/cms-page";

/**
 * WHAT THE LEGAL DOCUMENTS TELL A CRAWLER (lib/legal/docs.ts: Regulamin,
 * Polityka prywatności, Polityka cookies, Umowa powierzenia).
 *
 * These keep their own routes — they are linked from the footer, the consent
 * lines, the checkout and the sitemap, and those links must not change. But
 * their SEO belongs with the rest of the CMS, so once an admin publishes one,
 * the title and description they wrote in Ustawienia strony are what a search
 * result shows.
 *
 * Until then the page is a draft and there is nothing to read, so it falls
 * back to its own heading — which is what these routes have always done.
 *
 * The canonical address is always the bare /<slug>: ?lang=pl (the Polish
 * text for a visitor whose language is not ready yet) is the same document,
 * not a second page to index.
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
  return legalPageMetadata(page, locale, slug, t(titleKey));
}

/** The SEO text an admin wrote in exactly this language — no Polish fallback. */
function ownSeoText(seo: PageSeo | null | undefined, locale: string): SeoText {
  const own = (seo as Record<string, unknown> | null | undefined)?.[locale];
  return own && typeof own === "object" && !Array.isArray(own) ? (own as SeoText) : {};
}

/**
 * A PUBLISHED legal page: everything pageMetadata decides (description,
 * robots, canonical, image) — except a title nobody wrote in the visitor's
 * language. pageMetadata falls back to the Polish SEO, which is right for a
 * marketing page and wrong here: the import gives the two new documents
 * (Polityka cookies, Umowa powierzenia) a Polish title only, so an English or
 * German tab and share card would read "Polityka cookies GrovBase". Then the
 * document's own name in the visitor's language (`title`, the dictionary's
 * titleKey — the same one the draft fallback above uses) is the title, and
 * the social cards take it too unless that language has an og:title of its
 * own. A page with a title in the visitor's language keeps it, untouched.
 */
export function legalPageMetadata(page: PublicPage, locale: string, slug: string, title: string): Metadata {
  const meta = pageMetadata(page, locale, `/${slug}`);
  const own = ownSeoText(page.seo, locale);
  if (own.title?.trim()) return meta;
  const social = own.ogTitle?.trim() || title;
  return {
    ...meta,
    title,
    openGraph: { ...meta.openGraph, title: social },
    twitter: { ...meta.twitter, title: social },
  };
}
