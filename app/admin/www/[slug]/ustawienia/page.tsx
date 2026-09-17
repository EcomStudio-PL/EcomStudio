import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { PageSettings } from "@/components/admin/cms/page-settings";
import { getPage } from "@/lib/services/cms";

export default async function PageSettingsRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const page = await getPage(supabase, slug);
  if (!page) notFound();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  return (
    <div>
      <PageHeader overline={t("cms.pagesTitle")} title={t("cms.pageSettings")} sub={t("cms.pageSettingsSub")} />
      <PageSettings page={page} />
    </div>
  );
}
