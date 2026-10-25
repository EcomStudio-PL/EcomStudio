import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { readToolPopularity } from "@/lib/server/tool-popularity";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { readToolSearchTags } from "@/lib/server/tool-search-tags";
import { menuItemKeys } from "@/lib/tool-layout";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { DrawerProvider } from "@/components/layout/shell-context";
import { GuestPreviewBar } from "./preview-bar";

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
 */
export async function GuestShell({ preview, children }: { preview: boolean; children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ dict }, { dict: appDict }, availability, layout, popularity, searchTags] = await Promise.all([
    getDictionary(),
    // The app's namespaces on a visitor's page, scoped to this subtree — the
    // same as the signed-in layout sends (see lib/i18n/scopes.ts).
    getScopedDictionary("app"),
    getAvailabilityMap(supabase),
    getToolsLayout(supabase),
    readToolPopularity(supabase),
    readToolSearchTags(supabase),
  ]);
  const t = makeT(dict);
  return (
    <I18nScope dict={appDict}>
      <DrawerProvider>
        <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col" data-guest-shell={preview ? "preview" : "visitor"}>
          {preview && <GuestPreviewBar />}
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
          />
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pb-16 pt-4 sm:px-6 sm:pt-5 lg:px-8 lg:pt-6 xl:px-10">
            {children}
          </main>
          <footer className="border-t border-line">
            <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-wrap items-center justify-between gap-3 px-[var(--page-x)] py-5 text-[12px] text-faint sm:px-6 lg:px-8">
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
        </div>
      </DrawerProvider>
    </I18nScope>
  );
}
