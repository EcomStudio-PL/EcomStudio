import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CmsNav } from "@/components/admin/cms/cms-nav";
import { PageList } from "@/components/admin/cms/page-list";
import { getHomepageMode } from "@/lib/server/launch-page";
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

  const [pages, mode] = await Promise.all([
    listPages(supabase),
    getHomepageMode(supabase),
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

      {/* THE LIST IS THE SCREEN. Global settings moved to their own view —
          they were a full form above the pages, which is the least-used
          thing on this screen taking the most of it. */}
      <CmsNav />

      <PageList pages={pages} editors={editors} mode={mode} locale={locale} />
    </div>
  );
}
