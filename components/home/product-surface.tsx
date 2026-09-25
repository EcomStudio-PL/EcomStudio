import Link from "next/link";
import { createClient, getRequestUser } from "@/lib/supabase/server";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { readToolPopularity } from "@/lib/server/tool-popularity";
import { loadSlots, loadBanners } from "@/lib/server/media-slots";
import { bannerSlotKey } from "@/lib/media-slots";
import { homeModel } from "@/lib/home-sections";
import { menuItemKeys } from "@/lib/tool-layout";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { DrawerProvider } from "@/components/layout/shell-context";
import { ProductHome } from "./product-home";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * THE HOME / START — the one read that feeds it, and the chrome around it.
 *
 * TWO SCOPES, ONE BODY.
 *
 *   "page"   /start, and "/" when the CMS flags the `app` page as the
 *            homepage. A public route: it must render for somebody who has
 *            never signed up, so it assembles the application's OWN top bar
 *            from the same component, with the props it can honestly fill,
 *            and never relaxes a gate to do it.
 *
 *   "shell"  /home — the signed-in Start, inside app/(app)/layout.tsx, which
 *            already drew the bar, the bottom navigation, the drawer and the
 *            login-security gate. It renders the body and nothing else, so the
 *            chrome is never doubled.
 *
 * Both render ProductHome from the same model with the same read. There is no
 * second Home to drift out of step.
 *
 * WHAT A VISITOR COSTS: public reads only — the availability map and the
 * page's media slots. No wallet, no profile, no banners (their read is
 * signed-in only), no search index over anybody's content. The dictionary the
 * client receives is the `app` scope the bar needs, exactly as before.
 *
 * WHAT A CUSTOMER COSTS on top: their own name, balance and plan for the bar
 * ("page" only — the shell has them already) and the Start's scheduled
 * campaigns.
 */
export async function ProductSurface({ scope = "page" }: {
  scope?: "page" | "shell";
}) {
  const supabase = await createClient();
  const [{ dict, locale }, user] = await Promise.all([getDictionary(), getRequestUser()]);
  const t = makeT(dict);
  const signedIn = Boolean(user);

  // The bar's own reads ("page" only) start NOW, beside the page's — neither
  // depends on the other, so neither waits.
  const chrome = scope === "page"
    ? Promise.all([
        readToolPopularity(supabase),
        // THE APP'S OWN NAMESPACES, ON A PUBLIC ROUTE. This page wears the
        // application's bar, and that bar speaks the `app` scope, which the
        // root layout deliberately does not serialise. Scoping them to this
        // subtree is what I18nScope is for — see scripts/i18n-scope-tests.ts,
        // which knows this file is an app-scoped surface.
        getScopedDictionary("app"),
        user ? memberChrome(supabase, user.id) : Promise.resolve(null),
      ])
    : null;

  // The availability map is React-cached and public; the admin check and the
  // Start's campaigns are asked for only when somebody is signed in.
  // The catalogue layout is public too: it decides which items Start promotes
  // and which the header menu lists.
  const [availability, isAdmin, banners, layout] = await Promise.all([
    getAvailabilityMap(supabase),
    user ? viewerIsAdmin(supabase) : Promise.resolve(false),
    user ? loadBanners(supabase, "dashboard") : Promise.resolve([]),
    getToolsLayout(supabase),
  ]);
  const model = homeModel(availability, isAdmin, layout);
  // Exactly the slots this page can paint — its cards, its galleries and a
  // scheduled campaign — in one read, rather than every slot the product has.
  const slots = await loadSlots(supabase, [...model.slotKeys, ...banners.map((b) => bannerSlotKey(b.key))]);

  const body = (
    <ProductHome signedIn={signedIn} model={model} slots={slots} t={t} banners={banners} locale={locale} />
  );
  if (!chrome) return body;
  const [popularity, { dict: appDict }, member] = await chrome;

  return (
    <I18nScope dict={appDict}>
    <DrawerProvider>
      <div className="flex min-h-dvh flex-col bg-bg">
        {/* THE SAME BAR THE APPLICATION WEARS, in whichever of its two states
            applies — a visitor gets the signed-out bar (sign in, create an
            account; no balance, no avatar). `menu={false}` because this page
            mounts no drawer: a hamburger with nothing behind it would be a
            control that silently does nothing. The brand points at "/". */}
        <MegaTopbar
          guest={!signedIn}
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
        />

        <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pb-16 pt-4 sm:px-6 sm:pt-5 lg:px-8 lg:pt-6 xl:px-10">
          {body}
        </main>

        {/* A FOOTER THIN ENOUGH TO BE A FOOTER: the three links a regulator
            and a confused visitor look for, and nothing else. */}
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
 * What the bar needs about a signed-in visitor, and nothing more.
 *
 * Every failure degrades to a usable bar rather than to an error page: a
 * customer whose workspace read hiccups still gets the page, with the wallet
 * reading zero. The alternative — throwing — would take the PUBLIC front door
 * down because one private read failed.
 */
async function memberChrome(
  supabase: Supabase,
  userId: string,
): Promise<{ name: string; email?: string; credits: number; plan: string } | null> {
  try {
    const [profile, workspace] = await Promise.all([
      getProfile(supabase, userId),
      getCurrentWorkspace(supabase, userId),
    ]);
    if (!profile || !workspace) return null;
    const [wallet, { data: sub }] = await Promise.all([
      getWallet(supabase, workspace.id),
      supabase.from("subscriptions").select("subscription_plans(name)")
        .eq("workspace_id", workspace.id).eq("status", "active").maybeSingle(),
    ]);
    return {
      name: profile.full_name ?? profile.email,
      email: profile.email,
      credits: wallet?.balance ?? 0,
      plan: sub?.subscription_plans?.name ?? "Free",
    };
  } catch {
    return null;
  }
}
