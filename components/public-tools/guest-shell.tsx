import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { getPlatformAccess } from "@/lib/server/platform-access";
import { signupOpen } from "@/lib/platform-access";
import { readToolPopularity } from "@/lib/server/tool-popularity";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { readToolSearchTags } from "@/lib/server/tool-search-tags";
import { menuItemKeys } from "@/lib/tool-layout";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { CustomerBottomNav } from "@/components/layout/customer-bottom-nav";
import { DrawerProvider } from "@/components/layout/shell-context";
import { accessViewAction } from "@/app/actions/platform-access";
import { registrationFormConfig } from "@/app/actions/registration-config";
import type { AuthDialogSeed } from "@/components/auth/auth-dialog-context";
import { GuestPreviewBar } from "./preview-bar";
import { AuthDialogSeeder } from "./auth-seed";

/**
 * THE APP'S OWN SHELL, FOR A VISITOR (Public Tools V1) — what app/(app)/layout
 * renders around a public tool page when nobody is signed in, or when an admin
 * looks through "Podgląd jako gość".
 *
 * The same bar the product homepage and the public cennik already give a
 * visitor (components/home/product-surface.tsx): identical menus, search and
 * "Plany", and in place of a wallet, a bell and an avatar, the two doors in.
 * No hamburger — the customer drawer is an account's, and a control with
 * nothing behind it would silently do nothing.
 *
 * WHAT IT READS: public facts only — the availability map, the catalogue
 * layout, the tool ranking, the search tags. No profile, no wallet, no
 * notifications. In the preview the admin's session exists and is not used.
 *
 * THE PREVIEW'S SIGN-IN DIALOG. A visitor's dialog asks two server actions,
 * when it opens, whether signup is open and what the form needs. The preview
 * refuses every server action, so here the page reads both itself, with the
 * same two functions (they read settings only, never the account), and hands
 * them to the dialog. Generate in the preview then shows exactly the dialog a
 * visitor gets — the pre-launch notice while signup is closed.
 */
async function previewAuthSeed(): Promise<AuthDialogSeed> {
  const [desktop, mobile, registration] = await Promise.all([
    accessViewAction(false), accessViewAction(true), registrationFormConfig(),
  ]);
  return { access: { desktop, mobile }, registration };
}

export async function GuestShell({ preview, children }: { preview: boolean; children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ dict }, { dict: appDict }, availability, layout, popularity, searchTags, seed, access] = await Promise.all([
    getDictionary(),
    // The app's namespaces on a visitor's page, scoped to this subtree — the
    // same as the signed-in layout sends (see lib/i18n/scopes.ts).
    getScopedDictionary("app"),
    getAvailabilityMap(supabase),
    getToolsLayout(supabase),
    readToolPopularity(supabase),
    readToolSearchTags(supabase),
    preview ? previewAuthSeed() : Promise.resolve(null),
    getPlatformAccess(supabase),
  ]);
  const t = makeT(dict);
  return (
    <I18nScope dict={appDict}>
      <DrawerProvider>
        <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col" data-guest-shell={preview ? "preview" : "visitor"}>
          {preview && <GuestPreviewBar />}
          {seed && <AuthDialogSeeder seed={seed} />}
          <MegaTopbar
            guest
            menu={false}
            brandHref="/"
            name=""
            credits={0}
            plan="Free"
            isAdmin={false}
            navAdmin={false}
            availability={availability}
            menuItems={menuItemKeys(layout)}
            popularTools={popularity.keys}
            searchTags={searchTags}
            signupOpen={signupOpen(access, new Date())}
          />
          {/* The customer's own frame: the same width, padding and room under
              the phone's dock (`--page-bottom`, or a generator's docked bar).
              The footer is the last thing INSIDE it, so that room is reserved
              below the footer and the dock never covers it. */}
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
            {children}
            <footer className="mt-12 border-t border-line">
              <div className="flex w-full flex-wrap items-center justify-between gap-3 py-5 text-[12px] text-faint">
                <span>© {new Date().getFullYear()} GrovBase</span>
                <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <Link href="/plany" className="transition-colors duration-200 hover:text-ink">{t("nav.plans")}</Link>
                  <Link href="/faq" className="transition-colors duration-200 hover:text-ink">{t("publicTools.footer.faq")}</Link>
                  <Link href="/regulamin" className="transition-colors duration-200 hover:text-ink">{t("launch.terms")}</Link>
                  <Link href="/polityka-prywatnosci" className="transition-colors duration-200 hover:text-ink">{t("launch.privacyPage")}</Link>
                  <Link href="/kontakt" className="transition-colors duration-200 hover:text-ink">{t("nav.support")}</Link>
                </nav>
              </div>
            </footer>
          </main>
          {/* The phone's dock, as a customer has it (hidden from lg). The
              account slots open the sign-in dialog in place. */}
          <CustomerBottomNav availability={availability} guest />
        </div>
      </DrawerProvider>
    </I18nScope>
  );
}
