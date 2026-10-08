import type { Metadata } from "next";
import Link from "next/link";
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
import { DrawerProvider } from "@/components/layout/shell-context";
import { PricingPage } from "./pricing-page";
import { FAQ } from "./pricing-config";

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
 *            avatar) and a thin footer. Never relaxes a gate to render.
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
  const data = await loadPricingPage(supabase);
  const body = <PricingPage data={data} notice={notice} />;
  if (scope === "shell") return body;

  const [{ dict }, { dict: appDict }, availability, isAdmin, layout, popularity, searchTags, member] = await Promise.all([
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
  ]);
  const t = makeT(dict);

  // FAQPage structured data: exactly the questions on the page, in its words.
  const faq = FAQ.filter((f) => f.when !== "premiere" || data.premiere);
  const ld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: t(`pricing.faq.${f.key}.q`),
      acceptedAnswer: { "@type": "Answer", text: t(`pricing.faq.${f.key}.a`) },
    })),
  };

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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-wrap items-center justify-between gap-3 px-[var(--page-x)] py-5 text-[12px] text-faint sm:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} GrovBase</span>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <Link href="/regulamin" className="transition-colors duration-200 hover:text-ink">{t("launch.terms")}</Link>
              <Link href="/polityka-prywatnosci" className="transition-colors duration-200 hover:text-ink">{t("launch.privacyPage")}</Link>
              <Link href="/kontakt" className="transition-colors duration-200 hover:text-ink">{t("nav.support")}</Link>
            </nav>
          </div>
        </footer>
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
