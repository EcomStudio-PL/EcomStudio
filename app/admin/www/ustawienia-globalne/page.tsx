import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CmsNav } from "@/components/admin/cms/cms-nav";
import { SiteSettings } from "@/components/admin/site-settings";
import { getHomepageMode } from "@/lib/server/launch-page";
import { getPublicSite } from "@/lib/server/public-site";

/**
 * GLOBAL SETTINGS, on their own screen.
 *
 * They used to sit above the page list: the least-used form on the screen
 * occupying the most of it, and pushing the pages themselves below the fold
 * on a phone. Same form, same fields, one click away instead of always there.
 */
export default async function GlobalSettingsRoute() {
  const supabase = await createClient();
  const [{ dict }, mode, site] = await Promise.all([
    getDictionary(),
    getHomepageMode(supabase),
    getPublicSite(supabase),
  ]);
  const t = makeT(dict);

  return (
    <div>
      <PageHeader overline={t("cms.pagesTitle")} title={t("cms.nav.settings")}
        sub={t("cms.globalSettingsSub")} />
      <CmsNav />
      <SiteSettings mode={mode} instagramUrl={site.instagramUrl} facebookUrl={site.facebookUrl}
        linkedinUrl={site.linkedinUrl} xUrl={site.xUrl} />
    </div>
  );
}
