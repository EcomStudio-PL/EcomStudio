import type { Metadata, Viewport } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import {
  AnnouncementBar, MinimalFooter, MinimalHeader, SiteHeader, SiteFooter,
} from "@/components/cms/site-shell";
import { LaunchPage } from "@/components/launch/launch-page";
import { ProductSurface } from "@/components/home/product-surface";
import {
  getLaunchStore, resolveLaunchContent, launchFieldsFromBlocks, launchDefaultsFrom,
} from "@/lib/server/launch-page";
import { getLaunchConsents, getPrelaunchPublicConfig } from "@/lib/server/prelaunch/public";
import {
  launchOptionsFromBlocks, loadLaunchView, safeLaunchCopy, seoText, trafficSourceFrom,
} from "@/lib/server/prelaunch/landing";
import { collectEventContext } from "@/lib/server/event-context";
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
 *   kind 'launch'  → the pre-launch page (the long V2 page, components/launch)
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
    const defaults = launchDefaultsFrom(dict);
    const content = safeLaunchCopy(resolveLaunchContent(
      store, locale, defaults, "published", launchFieldsFromBlocks(page?.blocks, locale),
    ), defaults);
    // THE SHARE IMAGE. A file the owner picked in the builder (a media-bucket
    // URL, checked in landing.ts), else the 1200×630 JPEG cut from the hero
    // artwork — a JPEG because some unfurlers still mishandle WebP, and the
    // exact size the large card is drawn at, so nothing is cropped blind.
    const og = launchOptionsFromBlocks(page?.blocks).ogImage;
    const image = og ? { url: og } : { url: "/launch/og.jpg", width: 1200, height: 630 };
    // Editor markers never reach a <title> or a share card (an admin's own
    // render of an edited page carries them; see lib/ice/stega.ts).
    const ogTitle = seoText(content["seo.ogTitle"]);
    const ogDescription = seoText(content["seo.ogDescription"]);
    return {
      ...canonical,
      title: seoText(content["seo.title"]),
      description: seoText(content["seo.description"]),
      openGraph: {
        title: ogTitle,
        description: ogDescription,
        type: "website",
        url: "/",
        images: [image],
      },
      twitter: {
        card: "summary_large_image",
        title: ogTitle,
        description: ogDescription,
        images: [image.url],
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

/**
 * THE LAUNCH PAGE MAY BE ZOOMED.
 *
 * The root layout pins every page at 1:1 on a touch device — GrovBase is a
 * tool, and a double tap that throws the interface to 180% breaks it. The
 * launch page is not a tool: it is a document a stranger reads once, with
 * consent sentences and small print they are entitled to enlarge (WCAG
 * 1.4.4). Next merges a page's viewport over the layout's KEY BY KEY
 * (resolve-metadata.js mergeViewport), so this overrides only the two zoom
 * directives — width, initial scale, viewport-fit and the theme colours stay
 * the layout's — and only while "/" IS the launch page; any other homepage
 * keeps the lock.
 */
export async function generateViewport(): Promise<Viewport> {
  const home = await getActiveHomepage().catch(() => null);
  return home?.kind === "launch" ? { maximumScale: 5, userScalable: true } : {};
}

export default async function LandingPage({ searchParams }: {
  searchParams: Promise<{
    preview?: string; draft?: string;
    utm_source?: string | string[]; ref_code?: string | string[];
  }>;
}) {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const supabase = await createClient();
  const params = await searchParams;
  const { preview, draft } = params;
  const [{ data: { user: visitor } }, live, access] = await Promise.all([
    supabase.auth.getUser(),
    getActiveHomepage(),
    // One read, shared by both front doors below (React cache dedupes it with
    // the dialog's own lookup). Presentation only — the server routes enforce.
    getPlatformAccess(supabase),
  ]);

  // The role is read once, and only when it can matter: it decides whether a
  // preview is allowed AND whether the launch page shows an admin its gallery
  // placeholders. Every other homepage costs a signed-in visitor no query.
  const admin = preview || live?.kind === "launch" ? await viewerIsAdmin(supabase, visitor?.id) : false;

  // "Podgląd" from the admin panel: an admin — and only an admin — can look at
  // another page as the homepage, or at an unpublished draft, without changing
  // what the public sees. For everyone else the query string does nothing.
  const previewing = await previewTarget(supabase, preview, admin);
  const target = previewing ?? live;
  const which: "published" | "draft" = previewing && draft === "1" ? "draft" : "published";

  // ── THE PRE-LAUNCH PAGE ────────────────────────────────────────────────
  // The long V2 page. What it may promise (approved campaign values only),
  // which galleries a visitor sees and the consent sentences it records are
  // all resolved here, on the server, and handed down as finished values —
  // see lib/server/prelaunch/landing.ts.
  if (target?.kind === "launch") {
    const [store, site, published, draftBlocks, registration, config, consents, context] = await Promise.all([
      getLaunchStore(supabase),
      getPublicSite(supabase),
      getPublishedPage(supabase, target.slug),
      which === "draft" ? getDraftBlocks(supabase, target.slug) : Promise.resolve([]),
      // Which optional fields the signup form asks for. Read here rather than
      // in the form so both copies of it get the same answer in one round trip.
      getRegistrationConfig(supabase),
      getPrelaunchPublicConfig(),
      getLaunchConsents(locale, supabase),
      collectEventContext().catch(() => null),
    ]);
    const blocks = (which === "draft" ? draftBlocks : published?.blocks) ?? [];
    const defaults = launchDefaultsFrom(dict);
    const content = safeLaunchCopy(resolveLaunchContent(
      store, locale, defaults, which, launchFieldsFromBlocks(blocks, locale),
    ), defaults);
    const serverNow = Date.now();
    // Placeholders for empty galleries are an admin's view of the LIVE page;
    // a ?preview render is "what a visitor will see", so it gets none.
    const isAdmin = admin && !preview;
    const view = await loadLaunchView(supabase, { blocks, copy: content, locale, config, isAdmin, now: serverNow });
    const trafficSource = trafficSourceFrom({
      firstTouchUtm: context?.utmSource,
      firstTouchHost: context?.referrer,
      utmSource: typeof params.utm_source === "string" ? params.utm_source : null,
      refCode: typeof params.ref_code === "string" ? params.ref_code : null,
    });
    return (
      <LaunchPage
        social={site}
        content={content}
        signedIn={Boolean(visitor)}
        showAuthEntry={access.showAuthEntry}
        waitlistFields={registration.waitlist}
        loginLabel={t("launch.login")}
        privacyLabel={t("launch.privacyPage")}
        termsLabel={t("launch.terms")}
        rightsLabel={t("launch.rights")}
        options={view.options}
        campaign={view.campaign}
        galleries={view.galleries}
        isAdmin={isAdmin}
        consents={consents}
        serverNow={serverNow}
        analytics={{ trafficSource }}
      />
    );
  }

  // ── THE PRODUCT ITSELF AS THE FRONT DOOR ───────────────────────────────
  //
  // The third kind, added in migration 0116. It renders no authored blocks and
  // wears no marketing chrome: it IS the application's catalogue, assembled
  // from lib/features.ts, lib/categories.ts and lib/tool-cards.ts, in the
  // application's own top bar. A visitor sees everything and can start
  // nothing; a customer sees the same screen with the actions live.
  //
  // It sits here, inside the same resolver, for the same reason the launch
  // page does: "/" has exactly one answer, `is_homepage` gives it, and a
  // second way to decide what the front door is would be the bug 0104 already
  // fixed once.
  if (target?.kind === "app") return <ProductSurface />;

  // ── AN ORDINARY CMS PAGE AS THE FRONT DOOR ─────────────────────────────
  // The same builder, header and footer as every other public page, so what an
  // admin arranges in the editor is exactly what ships.
  const [page, pageDraft] = await Promise.all([
    target ? getPublishedPage(supabase, target.slug) : Promise.resolve(null),
    target && which === "draft" ? getDraftBlocks(supabase, target.slug) : Promise.resolve([]),
  ]);
  const authored = which === "draft" ? pageDraft : (page?.blocks ?? []);

  /*
    A FLAGGED PAGE RENDERS ITS OWN CONTENT. FULL STOP.

    This used to read `authored.length > 0 ? authored : DEFAULT_HOME_BLOCKS`,
    which sounds like a safety net and is actually the old bug wearing a
    different hat: an admin who points "/" at "O nas" and gets the built-in
    marketing landing has been overruled by a fallback, silently, with the panel
    still claiming "O nas" is the homepage. The same disagreement, one layer in.

    So the defaults are reached only when NOTHING is flagged at all — a fresh
    install, or a database where the homepage was cleared. Then "/" is nobody's
    page and a curated default beats a blank screen. Once a page owns "/", what
    it contains is what ships, including nothing.
  */
  const blocks = (target ? authored : DEFAULT_HOME_BLOCKS).filter((b) => b.visible);

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
 * IS THE VIEWER AN ADMIN? Re-read from `profiles` on every request rather than
 * trusted from anywhere: it unlocks the preview below and the launch page's
 * admin-only gallery placeholders. A signed-out visitor costs no query.
 */
async function viewerIsAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  visitorId: string | undefined,
): Promise<boolean> {
  if (!visitorId) return false;
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", visitorId).maybeSingle();
  return profile?.role === "admin";
}

/**
 * WHAT AN ADMIN ASKED TO SEE INSTEAD, IF THEY ARE AN ADMIN.
 *
 * `?preview=<slug>` renders that page at "/" for this request only. The two
 * legacy values are kept working because they are in links that already exist:
 * `waitlist` is what /podglad/<launch page> redirects to, and `full` was the
 * other half of the retired enum.
 *
 * The role comes from viewerIsAdmin, re-read on this request — a query string
 * is attacker-controlled, and this is the one place it can change what renders.
 *
 * `null` means "no preview is in effect" — not "show nothing" — so a bad slug
 * or a customer who guessed the parameter simply gets the real homepage.
 */
async function previewTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  preview: string | undefined,
  isAdmin: boolean,
): Promise<ActiveHomepage | null> {
  if (!preview || !isAdmin) return null;

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
