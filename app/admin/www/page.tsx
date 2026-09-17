import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { SiteSettings } from "@/components/admin/site-settings";
import { PageList } from "@/components/admin/cms/page-list";
import { getHomepageMode } from "@/lib/server/launch-page";
import { getPublicSite } from "@/lib/server/public-site";
import { listPages } from "@/lib/services/cms";

/**
 * CMS → STRONY — every public page in one list.
 *
 * This screen replaced three menu entries that all edited the public site:
 * the homepage mode switch, the block CMS and the separate launch-page
 * editor. They were the same job seen from three angles.
 */
export default async function AdminWww() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const [pages, mode, site] = await Promise.all([
    listPages(supabase),
    getHomepageMode(supabase),
    getPublicSite(supabase),
  ]);

  // "Autor zmian" is a name, not a uuid. One query for every editor on the
  // list rather than one per row.
  const editorIds = [...new Set(pages.map((p) => p.updatedBy).filter((id): id is string => !!id))];
  const editors: Record<string, string> = {};
  if (editorIds.length > 0) {
    const { data } = await supabase.from("profiles")
      .select("id, full_name, email").in("id", editorIds);
    for (const row of data ?? []) editors[row.id] = row.full_name || row.email;
  }

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("cms.pagesTitle")}
        sub={t("cms.pagesSub")}
      />

      <SiteSettings mode={mode} instagramUrl={site.instagramUrl} facebookUrl={site.facebookUrl}
        linkedinUrl={site.linkedinUrl} xUrl={site.xUrl} />

      <PageList pages={pages} editors={editors} mode={mode} locale={locale} />
    </div>
  );
}
