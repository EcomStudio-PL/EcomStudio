import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CmsNav } from "@/components/admin/cms/cms-nav";
import { SiteSettings } from "@/components/admin/site-settings";
import { getActiveHomepage } from "@/lib/server/homepage";
import { getPublicSite } from "@/lib/server/public-site";

/**
 * GLOBAL SETTINGS, on their own screen.
 *
 * They used to sit above the page list: the least-used form on the screen
 * occupying the most of it, and pushing the pages themselves below the fold
 * on a phone. Same form, same fields, one click away instead of always there.
 *
 * The homepage is REPORTED here, never chosen here — and it is reported by
 * calling the same resolver the public route calls, so the sentence this
 * screen prints is the sentence a visitor is actually being served. A
 * second switch on this page is exactly what produced the defect this module
 * was rebuilt to remove.
 */
export default async function GlobalSettingsRoute() {
  const supabase = await createClient();
  const [{ dict }, home, site] = await Promise.all([
    getDictionary(),
    getActiveHomepage(),
    getPublicSite(supabase),
  ]);
  const t = makeT(dict);

  // The resolver answers with a slug; the card wants the name an admin gave
  // the page. One lookup, and only when there is something to look up.
  let homepageTitle: string | null = null;
  if (home) {
    const { data } = await supabase.from("cms_pages")
      .select("title").eq("slug", home.slug).maybeSingle();
    homepageTitle = data?.title ?? home.slug;
  }

  return (
    <div>
      <PageHeader overline={t("cms.pagesTitle")} title={t("cms.nav.settings")}
        sub={t("cms.globalSettingsSub")} />
      <CmsNav />
      <SiteSettings homepageTitle={homepageTitle} instagramUrl={site.instagramUrl}
        facebookUrl={site.facebookUrl} linkedinUrl={site.linkedinUrl} xUrl={site.xUrl} />
    </div>
  );
}
