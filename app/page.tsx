import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { AnnouncementBar, SiteHeader, SiteFooter } from "@/components/cms/site-shell";
import { LaunchPage } from "@/components/launch/launch-page";
import {
  getHomepageMode, getLaunchStore, resolveLaunchContent, launchFieldsFromBlocks,
} from "@/lib/server/launch-page";
import {
  getGlobalSections, getNavPages, getPublicSite, getPublishedPage, getDraftBlocks,
} from "@/lib/server/public-site";
import { collectMediaUrls, loadMediaIndex } from "@/lib/server/cms-media";
import { loadLiveData } from "@/lib/server/cms-data";
import { getRegistrationConfig } from "@/lib/server/registration-config";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { DEFAULT_HOME_BLOCKS } from "@/lib/cms-defaults";

/**
 * The title and description follow whichever front door is live: before the
 * launch a share of "/" should promise the launch, not the product tour.
 */
export async function generateMetadata(): Promise<Metadata> {
  // The homepage is the one page that must always name itself canonically:
  // it is reachable through the apex, through www, and through the old Vercel
  // hostname, and all three should credit https://grovbase.com/.
  const canonical: Metadata = { alternates: { canonical: "/" }, openGraph: { url: "/" } };
  const supabase = await createClient();
  if ((await getHomepageMode(supabase)) !== "waitlist") return canonical;
  const { dict, locale } = await getDictionary();
  const [store, page] = await Promise.all([
    getLaunchStore(supabase), getPublishedPage(supabase, "premiera"),
  ]);
  const content = resolveLaunchContent(
    store, locale, dict.launch, "published", launchFieldsFromBlocks(page?.blocks, locale),
  );
  return {
    ...canonical,
    title: content["seo.title"],
    description: content["seo.description"],
    openGraph: {
      title: content["seo.ogTitle"],
      description: content["seo.ogDescription"],
      type: "website",
      url: "/",
      ...(content["hero.image"] ? { images: [content["hero.image"]] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: content["seo.ogTitle"],
      description: content["seo.ogDescription"],
    },
  };
}

export default async function LandingPage({ searchParams }: {
  searchParams: Promise<{ preview?: string; draft?: string }>;
}) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const supabase = await createClient();
  const { preview, draft } = await searchParams;
  const [{ data: { user: visitor } }, liveMode, access] = await Promise.all([
    supabase.auth.getUser(),
    getHomepageMode(supabase),
    // One read, shared by both front doors below (React cache dedupes it with
    // the dialog's own lookup). Presentation only — the server routes enforce.
    getPlatformAccess(supabase),
  ]);

  // "Podgląd" from the admin panel: an admin — and only an admin — can look at
  // the other version, or at the unpublished draft, without switching what the
  // public sees. For everyone else the query string does nothing at all.
  let mode = liveMode;
  let which: "published" | "draft" = "published";
  if (preview === "full" || preview === "waitlist") {
    const { data: profile } = visitor
      ? await supabase.from("profiles").select("role").eq("id", visitor.id).maybeSingle()
      : { data: null };
    if (profile?.role === "admin") {
      mode = preview;
      if (draft === "1") which = "draft";
    }
  }

  // One switch, one route. `waitlist` renders the pre-launch page in place —
  // no redirect, no second copy of the app, and the full landing below is
  // untouched and one setting away from coming back.
  if (mode === "waitlist") {
    // Published snapshot for a visitor; the admin's draft only when they
    // explicitly asked for the draft preview.
    const [store, site, published, draftBlocks, registration] = await Promise.all([
      getLaunchStore(supabase),
      getPublicSite(supabase),
      getPublishedPage(supabase, "premiera"),
      which === "draft" ? getDraftBlocks(supabase, "premiera") : Promise.resolve([]),
      // Which optional fields the signup form asks for. Read here rather than
      // in the form so both copies of it get the same answer in one round trip.
      getRegistrationConfig(supabase),
    ]);
    const blocks = which === "draft" ? draftBlocks : published?.blocks;
    return (
      <LaunchPage
        social={site}
        content={resolveLaunchContent(
          store, locale, dict.launch, which, launchFieldsFromBlocks(blocks, locale),
        )}
        signedIn={Boolean(visitor)}
        showAuthEntry={access.showAuthEntry}
        waitlistFields={registration.waitlist}
        loginLabel={t("launch.login")}
        privacyLabel={t("launch.privacyPage")}
        termsLabel={t("launch.terms")}
        rightsLabel={t("launch.rights")}
      />
    );
  }
  // THE FULL PUBLIC HOMEPAGE — the other front door, reached when an admin
  // switches the mode away from `waitlist`. It renders the CMS page `home`
  // through the same builder, header and footer as every other public page,
  // so what an admin arranges in the editor is exactly what ships.
  //
  // In draft preview an admin sees their unpublished work; everyone else gets
  // the published snapshot, and the curated defaults if nothing is published,
  // so this page is never empty.
  const [published, homeDraft, { data: { user } }] = await Promise.all([
    getPublishedPage(supabase, "home"),
    which === "draft" ? getDraftBlocks(supabase, "home") : Promise.resolve([]),
    supabase.auth.getUser(),
  ]);
  const authored = which === "draft" ? homeDraft : (published?.blocks ?? []);
  const blocks = (authored.length > 0 ? authored : DEFAULT_HOME_BLOCKS).filter((b) => b.visible);

  const [media, data, global, nav, site] = await Promise.all([
    loadMediaIndex(supabase, collectMediaUrls(blocks)),
    loadLiveData(supabase, new Set(blocks.map((b) => b.type))),
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
          blocks={blocks}
          ctx={renderContext({ locale, t, media, data, showAuth: access.showAuthEntry, signedIn: Boolean(user) })}
        />
      </main>
      <SiteFooter {...shell} />
    </div>
  );
}
