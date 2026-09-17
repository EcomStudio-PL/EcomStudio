import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { VersionHistory } from "@/components/admin/cms/version-history";
import { getPage, listVersions } from "@/lib/services/cms";

/**
 * HISTORIA — every version this page has ever had.
 *
 * A row per publish, plus a row for every rollback (the state it replaced is
 * kept too). Nothing in this feature deletes a version, which is the whole
 * point for the legal documents: an old Regulamin has to stay readable long
 * after it has been superseded.
 */
export default async function HistoryRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const page = await getPage(supabase, slug);
  if (!page) notFound();

  const [{ dict, locale }, versions] = await Promise.all([
    getDictionary(),
    listVersions(supabase, page.id),
  ]);
  const t = makeT(dict);

  const authorIds = [...new Set(versions.map((v) => v.createdBy).filter((id): id is string => !!id))];
  const authors: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", authorIds);
    for (const row of data ?? []) authors[row.id] = row.full_name || row.email;
  }

  return (
    <div>
      <PageHeader overline={page.title} title={t("cms.history")} sub={t("cms.historySub")} />
      <VersionHistory pageId={page.id} slug={page.slug} title={page.title}
        versions={versions} authors={authors} locale={locale} />
    </div>
  );
}
