import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { readToolPopularity } from "@/lib/server/tool-popularity";
import { loadSlots } from "@/lib/server/media-slots";
import { MEDIA_SLOTS } from "@/lib/media-slots";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { DrawerProvider } from "@/components/layout/shell-context";
import { ProductHome } from "./product-home";

/**
 * THE PRODUCT SURFACE — the page, its chrome, and the one read that feeds both.
 *
 * WHY THE CHROME IS BUILT HERE RATHER THAN IN A LAYOUT. Because this page has
 * two audiences and only one of them is signed in. app/(app)/layout.tsx is the
 * customer shell: its first three statements are `getUser()`, `redirect
 * ("/login")` and the login-security gate, and that is exactly right for every
 * page it wraps. This one must render for somebody who has never signed up, so
 * it assembles the SAME bar from the same component with the props it can
 * honestly fill, and never relaxes a gate to do it.
 *
 * WHAT A VISITOR COSTS: two reads, both cached, neither about them —
 * the availability map and the media slots. No wallet, no profile, no
 * notifications, no search index over anybody's content.
 *
 * WHAT A CUSTOMER COSTS: those two plus their own name, balance and role, in
 * one batch. Still no library, no generations, no counters — this is the
 * catalogue, and the numbers live on /home where they are the point.
 */
export async function ProductSurface({ scope = "page" }: {
  /** "page" renders the full document chrome. Reserved for a future in-shell
   *  embed that would bring its own bar. */
  scope?: "page";
}) {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();

  // ONE BATCH. `getAvailabilityMap` and `readToolPopularity` are both React-
  // cached and both read public rows, so they cost the same for a stranger and
  // for a customer. The slot read asks for every key the page can paint, once.
  const [availability, popularity, slots, { dict: appDict }] = await Promise.all([
    getAvailabilityMap(supabase),
    readToolPopularity(supabase),
    loadSlots(supabase, MEDIA_SLOTS.map((s) => s.key)),
    // THE APP'S OWN NAMESPACES, ON A PUBLIC ROUTE.
    //
    // This page wears the application's bar, and that bar speaks `features`,
    // `creditsPanel`, `notif`, `account`, `search` and a dozen more — the
    // `app` scope, which the root layout deliberately does not serialise.
    //
    // Adding them to `root` instead would have been one line and would have
    // put seventeen namespaces on EVERY public document, including the launch
    // page, which is the exact regression P0-03 existed to undo. Scoping them
    // to this subtree is what I18nScope is for, and scripts/i18n-scope-tests.ts
    // now knows this file is an app-scoped surface so the generated lists stay
    // honest about which page pays for what.
    getScopedDictionary("app"),
  ]);

  // Only now, and only for somebody who is actually signed in.
  const member = user
    ? await memberChrome(supabase, user.id)
    : null;
  const isAdmin = user ? await viewerIsAdmin(supabase) : false;
  const signedIn = Boolean(user);

  return (
    <I18nScope dict={appDict}>
    <DrawerProvider>
      <div className="flex min-h-dvh flex-col bg-bg">
        {/* THE SAME BAR THE APPLICATION WEARS, in whichever of its two states
            applies. `menu={false}` because this page mounts no drawer: a
            hamburger with nothing behind it is a control that silently does
            nothing, and useDrawer's default setter outside DrawerProvider is
            exactly that. The brand points at "/" rather than /home — on the
            front door the logo is "back to the top", not "go to my dashboard". */}
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
          popularTools={popularity.keys}
        />

        <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pb-16 pt-4 sm:px-6 sm:pt-5 lg:px-8 lg:pt-6 xl:px-10">
          <ProductHome
            signedIn={signedIn}
            availability={availability}
            slots={slots}
            t={t}
            isAdmin={isAdmin}
          />
        </main>

        {/* A FOOTER THIN ENOUGH TO BE A FOOTER. The marketing footer belongs to
            the marketing pages; a product screen needs the three links a
            regulator and a confused visitor look for, and nothing else. */}
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
 * customer whose workspace read hiccups still gets the catalogue, with the
 * wallet reading zero, which is the same thing the bar shows before the number
 * arrives anywhere else. The alternative — throwing — would take the PUBLIC
 * front door down because one private read failed.
 */
async function memberChrome(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
