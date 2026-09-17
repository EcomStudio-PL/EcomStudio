import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { promoIsOpen } from "@/lib/cms";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import {
  AnnouncementBar, MinimalFooter, MinimalHeader, SiteHeader, SiteFooter,
} from "@/components/cms/site-shell";
import { normalizeTarget } from "@/lib/server/redirects";
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

  // A CAMPAIGN THAT IS OVER IS NOT A PAGE ANY MORE. An expired offer left up
  // and still buyable is the one failure mode of a promotion page, so the
  // window is enforced on the render, not on a cron job somebody forgets to
  // run. Only pages that declared `active` have a window at all.
  if (!promoIsOpen(page.promo)) {
    const after = normalizeTarget(page.promo?.afterEndRedirect ?? "");
    // No destination set means the campaign simply ceases to exist — better a
    // 404 than a live page selling a price that has expired.
    if (after) redirect(after);
    notFound();
  }

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

  // WHAT THE PAGE WEARS IS THE PAGE'S OWN SETTING. `global` is the site's
  // chrome, `minimal` is the brand alone, `none` is nothing — and the
  // announcement bar belongs to the site's chrome, so it goes with it.
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {page.headerMode === "global" && <AnnouncementBar global={global} locale={locale} />}
      {page.headerMode === "global" && <SiteHeader {...shell} />}
      {page.headerMode === "minimal" && <MinimalHeader />}
      <main className="flex-1">
        <BlockRenderer
          blocks={visible}
          ctx={renderContext({ locale, t, media, data, showAuth: access.showAuthEntry, signedIn: Boolean(user) })}
        />
      </main>
      {page.footerMode === "global" && <SiteFooter {...shell} />}
      {page.footerMode === "minimal" && <MinimalFooter t={t} />}
    </div>
  );
}
