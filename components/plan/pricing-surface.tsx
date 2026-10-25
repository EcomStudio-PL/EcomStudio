import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { readToolPopularity } from "@/lib/server/tool-popularity";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { readToolSearchTags } from "@/lib/server/tool-search-tags";
import { loadPricingPage } from "@/lib/server/pricing-page";
import { jsonLdScript } from "@/lib/grovnews-blog";
import { menuItemKeys } from "@/lib/tool-layout";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { SiteFooter } from "@/components/cms/site-shell";
import { getGlobalSections, getNavPages, getPublicSite } from "@/lib/server/public-site";
import { DrawerProvider } from "@/components/layout/shell-context";
import { PricingPage } from "./pricing-page";
import { getFaq } from "@/lib/server/faq";
import { faqJsonLd } from "@/lib/faq";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * /plany's metadata. Lives here, inside the app-scoped subtree, rather than in
 * the route file: the i18n scope scanner (scripts/i18n-scope-tests.ts) walks
 * route files into the PUBLIC scope, and a `pricing.*` key there would ship
 * the whole namespace inline with every public page. The title is the bare
 * name — the root layout's template appends "· GrovBase".
 */
export async function pricingMetadata(): Promise<Metadata> {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const title = t("pricing.meta.title");
  const description = t("pricing.meta.description");
  return {
    title,
    description,
    alternates: { canonical: "/plany" },
    openGraph: { title, description, url: "/plany", type: "website", siteName: "GrovBase" },
  };
}

/**
 * THE PRICING PAGE — the one read that feeds it, and the chrome around it.
 *
 * TWO SCOPES, ONE BODY (the pattern of components/home/product-surface.tsx):
 *
 *   "page"   /plany — public. Wears the application's own top bar in whichever
 *            state applies (a visitor gets the signed-out bar: no balance, no
 *            avatar) and the public site's footer. Never relaxes a gate to render.
 *   "shell"  /plan — inside app/(app)/layout.tsx, which already drew the bar,
 *            the navigation and the login-security gate. Body only.
 *
 * Both render PricingPage from `loadPricingPage`. There is no second cennik
 * to drift out of step, and no price computed anywhere but the server.
 */
export async function PricingSurface({ scope, notice = null }: {
  scope: "page" | "shell";
  /** A validated `?checkout=` status, shown above the plans. */
  notice?: string | null;
}) {
  const supabase = await createClient();
  // The FAQ base's /plany questions (FAQ V1): the same for every visitor, in
  // their language, the premiere one only while it runs.
  const [data, faq] = await Promise.all([
    loadPricingPage(supabase),
    getDictionary().then(({ locale }) => getFaq("plany", locale)),
  ]);
  const body = <PricingPage data={data} notice={notice} faq={faq.items} />;
  if (scope === "shell") return body;

  const [{ dict, locale }, { dict: appDict }, availability, isAdmin, layout, popularity, searchTags, member, global, nav, site] = await Promise.all([
    getDictionary(),
    // The app's namespaces on a public route, scoped to this subtree — see
    // scripts/i18n-scope-tests.ts, which knows this file is an app surface.
    getScopedDictionary("app"),
    getAvailabilityMap(supabase),
    data.viewer.signedIn ? viewerIsAdmin(supabase) : Promise.resolve(false),
    getToolsLayout(supabase),
    readToolPopularity(supabase),
    readToolSearchTags(supabase),
    data.viewer.signedIn ? memberChrome(supabase) : Promise.resolve(null),
    // The public site's footer — the same cached reads every public page makes.
    getGlobalSections(),
    getNavPages(),
    getPublicSite(supabase),
  ]);
  const t = makeT(dict);

  // FAQPage structured data: exactly the questions on the page, in its words.
  const ld = faqJsonLd(faq.items);

  return (
    <I18nScope dict={appDict}>
    <DrawerProvider>
      <div className="flex min-h-dvh flex-col bg-bg">
        <MegaTopbar
          guest={!data.viewer.signedIn}
          menu={false}
          brandHref="/"
          name={member?.name ?? ""}
          email={member?.email}
          credits={member?.credits ?? 0}
          plan={member?.plan ?? "Free"}
          isAdmin={isAdmin}
          availability={availability}
          menuItems={menuItemKeys(layout)}
          popularTools={popularity.keys}
          searchTags={searchTags}
        />
        <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10 xl:px-10">
          {body}
        </main>
        {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
        {/* The public site's footer (documents, O nas, Kontakt, Cennik). It
            replaced this page's own thin bar, so there is still exactly one. */}
        <SiteFooter global={global} nav={nav} site={site} locale={locale} t={t} />
      </div>
    </DrawerProvider>
    </I18nScope>
  );
}

/**
 * The bar's own facts about a signed-in visitor — name, balance, plan name —
 * exactly what the application's bar shows elsewhere. Failure degrades to a
 * bar without them rather than taking the public page down.
 */
async function memberChrome(
  supabase: Supabase,
): Promise<{ name: string; email?: string; credits: number; plan: string } | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const [profile, workspace] = await Promise.all([
      getProfile(supabase, user.id),
      getCurrentWorkspace(supabase, user.id),
    ]);
    if (!profile || !workspace) return null;
    const [wallet, { data: sub }] = await Promise.all([
      getWallet(supabase, workspace.id),
      supabase.from("subscriptions").select("subscription_plans(name)")
        .eq("workspace_id", workspace.id).eq("status", "active").limit(1),
    ]);
    const plan = (sub ?? [])[0]?.subscription_plans as { name?: string } | null | undefined;
    return {
      name: profile.full_name ?? profile.email,
      email: profile.email,
      credits: wallet?.balance ?? 0,
      plan: plan?.name ?? "Free",
    };
  } catch {
    return null;
  }
}
