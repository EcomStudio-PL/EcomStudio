import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import {
  AnnouncementBar, MinimalFooter, MinimalHeader, SiteHeader, SiteFooter,
} from "@/components/cms/site-shell";
import { LaunchPage } from "@/components/launch/launch-page";
import { getLaunchStore, resolveLaunchContent, launchFieldsFromBlocks } from "@/lib/server/launch-page";
import { getActiveHomepage, type ActiveHomepage } from "@/lib/server/homepage";
import {
  getGlobalSections, getNavPages, getPublicSite, getPublishedPage, getDraftBlocks,
} from "@/lib/server/public-site";
import { collectMediaUrls, loadMediaIndex } from "@/lib/server/cms-media";
import { loadLiveData } from "@/lib/server/cms-data";
import { getRegistrationConfig } from "@/lib/server/registration-config";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { hasSeoTitle, pageMetadata } from "@/lib/server/cms-page";
import { DEFAULT_HOME_BLOCKS } from "@/lib/cms-defaults";

/**
 * "/" RENDERS WHICHEVER PAGE IS FLAGGED AS THE HOMEPAGE.
 *
 * There is no "mode" here any more. `getActiveHomepage()` is the only thing
 * that decides what a visitor gets, it reads one flag on one row, and the
 * database refuses to let two rows carry it — see lib/server/homepage.ts for
 * what this replaced and why it had to be replaced.
 *
 * Three outcomes, and the first two are the same two pages that used to be the
 * two halves of the enum:
 *   kind 'launch'  → the pre-launch page, rendered exactly as before
 *   any other page → its published sections, in the site chrome IT asks for
 *   nothing flagged → the built-in default layout, as an unpublished `home`
 *                     has always produced
 */

/** The title and description follow whichever page is the front door. */
export async function generateMetadata(): Promise<Metadata> {
  // The homepage is the one page that must always name itself canonically:
  // it is reachable through the apex, through www, and through the old Vercel
  // hostname, and all three should credit https://grovbase.com/.
  const canonical: Metadata = { alternates: { canonical: "/" }, openGraph: { url: "/" } };
  const home = await getActiveHomepage();
  if (!home) return canonical;

  const supabase = await createClient();
  const { dict, locale } = await getDictionary();

  if (home.kind === "launch") {
    const [store, page] = await Promise.all([
      getLaunchStore(supabase), getPublishedPage(supabase, home.slug),
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

  // An ordinary page as the front door gets its own SEO — but only what an
  // admin actually typed. With nothing typed, "/" keeps the site-wide title
  // rather than inheriting the page's internal name.
  const page = await getPublishedPage(supabase, home.slug);
  if (!page || !hasSeoTitle(page.seo, locale)) return canonical;
  return pageMetadata(page, locale, "/");
}

export default async function LandingPage({ searchParams }: {
  searchParams: Promise<{ preview?: string; draft?: string }>;
}) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const supabase = await createClient();
  const { preview, draft } = await searchParams;
  const [{ data: { user: visitor } }, live, access] = await Promise.all([
    supabase.auth.getUser(),
    getActiveHomepage(),
    // One read, shared by both front doors below (React cache dedupes it with
    // the dialog's own lookup). Presentation only — the server routes enforce.
    getPlatformAccess(supabase),
  ]);

  // "Podgląd" from the admin panel: an admin — and only an admin — can look at
  // another page as the homepage, or at an unpublished draft, without changing
  // what the public sees. For everyone else the query string does nothing.
  const previewing = await previewTarget(supabase, preview, visitor?.id);
  const target = previewing ?? live;
  const which: "published" | "draft" = previewing && draft === "1" ? "draft" : "published";

  // ── THE PRE-LAUNCH PAGE ────────────────────────────────────────────────
  // Unchanged in every respect a visitor can see. The only thing that moved is
  // how the route learns that this is the page to render.
  if (target?.kind === "launch") {
    const [store, site, published, draftBlocks, registration] = await Promise.all([
      getLaunchStore(supabase),
      getPublicSite(supabase),
      getPublishedPage(supabase, target.slug),
      which === "draft" ? getDraftBlocks(supabase, target.slug) : Promise.resolve([]),
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

  // ── AN ORDINARY CMS PAGE AS THE FRONT DOOR ─────────────────────────────
  // The same builder, header and footer as every other public page, so what an
  // admin arranges in the editor is exactly what ships. With nothing flagged —
  // or a flagged page that has never been published — the curated defaults
  // render, so "/" is never empty.
  const [page, pageDraft] = await Promise.all([
    target ? getPublishedPage(supabase, target.slug) : Promise.resolve(null),
    target && which === "draft" ? getDraftBlocks(supabase, target.slug) : Promise.resolve([]),
  ]);
  const authored = which === "draft" ? pageDraft : (page?.blocks ?? []);
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
    signedIn: Boolean(visitor),
  };

  // What the page wears is the page's own setting, the same rule /[slug]
  // follows — a campaign landing promoted to the homepage has to keep the
  // minimal chrome it was designed with. The defaults answer "global", which
  // is what "/" has always worn.
  const headerMode = page?.headerMode ?? "global";
  const footerMode = page?.footerMode ?? "global";

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {headerMode === "global" && <AnnouncementBar global={global} locale={locale} />}
      {headerMode === "global" && <SiteHeader {...shell} />}
      {headerMode === "minimal" && <MinimalHeader />}
      <main className="flex-1">
        <BlockRenderer
          blocks={blocks}
          ctx={renderContext({ locale, t, media, data, showAuth: access.showAuthEntry, signedIn: Boolean(visitor) })}
        />
      </main>
      {footerMode === "global" && <SiteFooter {...shell} />}
      {footerMode === "minimal" && <MinimalFooter t={t} />}
    </div>
  );
}

/**
 * WHAT AN ADMIN ASKED TO SEE INSTEAD, IF THEY ARE AN ADMIN.
 *
 * `?preview=<slug>` renders that page at "/" for this request only. The two
 * legacy values are kept working because they are in links that already exist:
 * `waitlist` is what /podglad/<launch page> redirects to, and `full` was the
 * other half of the retired enum.
 *
 * The role is re-read here rather than trusted from anywhere: a query string is
 * attacker-controlled, and this is the one place it can change what renders.
 *
 * `null` means "no preview is in effect" — not "show nothing" — so a bad slug
 * or a customer who guessed the parameter simply gets the real homepage.
 */
async function previewTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  preview: string | undefined,
  visitorId: string | undefined,
): Promise<ActiveHomepage | null> {
  if (!preview || !visitorId) return null;
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", visitorId).maybeSingle();
  if (profile?.role !== "admin") return null;

  if (preview === "waitlist") {
    const { data } = await supabase
      .from("cms_pages").select("slug, kind").eq("kind", "launch")
      .order("sort_order").limit(1).maybeSingle();
    return data ? { slug: data.slug, kind: data.kind } : null;
  }
  const slug = preview === "full" ? "home" : preview;
  const { data } = await supabase
    .from("cms_pages").select("slug, kind").eq("slug", slug).maybeSingle();
  return data ? { slug: data.slug, kind: data.kind } : null;
}
