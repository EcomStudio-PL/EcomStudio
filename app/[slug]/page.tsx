import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { AnnouncementBar, SiteHeader, SiteFooter } from "@/components/cms/site-shell";
import {
  getGlobalSections, getNavPages, getPublicSite, getPublishedPage,
} from "@/lib/server/public-site";
import { collectMediaUrls, loadMediaIndex } from "@/lib/server/cms-media";
import { loadLiveData } from "@/lib/server/cms-data";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { pageMetadata, RESERVED_SLUGS } from "@/lib/server/cms-page";

/**
 * EVERY OTHER PUBLIC PAGE.
 *
 * Static routes win over this one in Next's matcher, so /login, /admin, /api
 * and the legal pages keep their own handlers; what reaches here is a slug an
 * admin created in the CMS. Only a PUBLISHED page renders — a draft is not
 * "coming soon" to a visitor, it simply is not there yet.
 *
 * The page itself is read through a tagged cache and the payload is assembled
 * in ONE pass: the blocks, the images' metadata and the live product data are
 * three queries for a whole page, not three per section.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (RESERVED_SLUGS.has(slug)) return {};
  const supabase = await createClient();
  const page = await getPublishedPage(supabase, slug);
  // A launch page answers "/" through the homepage switch and 404s here, so
  // it must not advertise a title or a canonical for a URL that does not exist.
  if (!page || page.kind === "launch") return {};
  const { locale } = await getDictionary();
  return pageMetadata(page, locale, `/${slug}`);
}

export default async function CmsPage({ params }: Params) {
  const { slug } = await params;
  if (RESERVED_SLUGS.has(slug)) notFound();

  const supabase = await createClient();
  const [page, access, { data: { user } }] = await Promise.all([
    getPublishedPage(supabase, slug),
    getPlatformAccess(supabase),
    supabase.auth.getUser(),
  ]);

  const visible = page?.blocks.filter((b) => b.visible) ?? [];
  // Nothing to show is a 404, not an empty shell with a header and a footer.
  if (!page || page.kind === "launch" || visible.length === 0) notFound();

  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const [media, data, global, nav, site] = await Promise.all([
    loadMediaIndex(supabase, collectMediaUrls(visible)),
    loadLiveData(supabase, new Set(visible.map((b) => b.type))),
    getGlobalSections(),
    getNavPages(),
    getPublicSite(supabase),
  ]);

  const shell = {
    global, nav, site, locale, t,
    showAuth: access.showAuthEntry,
    signedIn: Boolean(user),
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <AnnouncementBar global={global} locale={locale} />
      <SiteHeader {...shell} />
      <main className="flex-1">
        <BlockRenderer
          blocks={visible}
          ctx={renderContext({ locale, t, media, data, showAuth: access.showAuthEntry })}
        />
      </main>
      <SiteFooter {...shell} />
    </div>
  );
}
