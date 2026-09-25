import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import {
  AnnouncementBar, MinimalFooter, MinimalHeader, SiteHeader, SiteFooter,
} from "@/components/cms/site-shell";
import { isChromeMode } from "@/lib/cms";
import {
  getDraftBlocks, getGlobalDrafts, getNavPages, getPublicSite,
} from "@/lib/server/public-site";
import { collectMediaUrls, loadMediaIndex } from "@/lib/server/cms-media";
import { loadLiveData } from "@/lib/server/cms-data";

/**
 * THE DRAFT, SEEN AS A VISITOR WOULD SEE IT.
 *
 * Renders the CURRENT blocks — not the published snapshot — inside the real
 * public header and footer, with no admin chrome of any kind. That matters
 * twice over: an admin judging a layout has to see the layout, and the
 * builder loads this route in an iframe at 390px, 834px and 1440px to answer
 * "does this work on a phone" honestly. A preview wrapped in the admin panel
 * would answer a different question.
 *
 * TWO LOCKS, because this route is deliberately NOT under /admin (a preview
 * wrapped in the admin shell would be a different layout, and the whole point
 * is to see the real one). `/podglad` is a protected prefix in the middleware,
 * so an anonymous request never gets here; and the role is checked again below,
 * so a signed-in customer who guesses the URL gets their dashboard. There is no
 * token, no share link and no public preview URL — the one way in is the panel.
 */
export default async function CmsPreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const profile = await getProfile(supabase, user.id);
  if (profile?.role !== "admin") redirect("/dashboard");

  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const { data: page } = await supabase.from("cms_pages")
    .select("id, title, kind, header_mode, footer_mode").eq("slug", slug).maybeSingle();
  if (!page) notFound();
  // The launch page is not a stack of blocks — previewing it means seeing the
  // real page, so send the admin to the draft view of "/" itself.
  if (page.kind === "launch") redirect("/?preview=waitlist&draft=1");
  // Nor is the product Home (kind `app`): it has no blocks — its content is
  // the tool registry — so rendering its blocks here would show an empty page.
  // Its honest preview is "/" answered by it, which the homepage route already
  // offers an admin (?preview=<slug>) without flagging anything.
  if (page.kind === "app") redirect(`/?preview=${encodeURIComponent(slug)}`);

  const blocks = (await getDraftBlocks(supabase, slug)).filter((b) => b.visible);
  const [media, data, global, nav, site] = await Promise.all([
    loadMediaIndex(supabase, collectMediaUrls(blocks)),
    loadLiveData(supabase, new Set(blocks.map((b) => b.type))),
    // The DRAFT header and footer, so an edit to the global sections is
    // visible here before it is published too.
    getGlobalDrafts(supabase),
    getNavPages(),
    getPublicSite(supabase),
  ]);

  const shell = { global, nav, site, locale, t, showAuth: true, signedIn: false };

  // The preview wears what the page wears — a landing set to `minimal` has to
  // look like a landing here, or the responsive check is of a layout that will
  // never ship.
  const headerMode = isChromeMode(page.header_mode) ? page.header_mode : "global";
  const footerMode = isChromeMode(page.footer_mode) ? page.footer_mode : "global";

  return (
    <div className="flex min-h-dvh flex-col bg-bg" data-cms-preview={slug}>
      {headerMode === "global" && <AnnouncementBar global={global} locale={locale} />}
      {headerMode === "global" && <SiteHeader {...shell} />}
      {headerMode === "minimal" && <MinimalHeader />}
      <main className="flex-1">
        <BlockRenderer
          blocks={blocks}
          // `admin` is what makes a broken custom block SHOW as broken here
          // and stay invisible in production.
          ctx={renderContext({ locale, t, media, data, admin: true, showAuth: true })}
        />
      </main>
      {footerMode === "global" && <SiteFooter {...shell} />}
      {footerMode === "minimal" && <MinimalFooter t={t} />}
    </div>
  );
}
