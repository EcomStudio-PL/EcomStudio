import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { CmsNav } from "@/components/admin/cms/cms-nav";
import { GlobalSectionsEditor } from "@/components/admin/cms/global-sections";
import { getGlobalDrafts } from "@/lib/server/public-site";

export default async function GlobalSectionsRoute() {
  const supabase = await createClient();
  const [{ dict }, sections] = await Promise.all([getDictionary(), getGlobalDrafts(supabase)]);
  const t = makeT(dict);

  return (
    <div>
      <PageHeader overline={t("cms.pagesTitle")} title={t("cms.globalTitle")} sub={t("cms.globalSub")} />
      <CmsNav />
      <GlobalSectionsEditor sections={sections} />
    </div>
  );
}
