import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { HomepageSwitch } from "@/components/admin/homepage-switch";
import { getHomepageMode } from "@/lib/server/launch-page";

export default async function AdminHomepage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const mode = await getHomepageMode(supabase);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("launchAdmin.homepageTitle")}
        sub={t("launchAdmin.homepageSub")}
      />
      <HomepageSwitch mode={mode} />
    </div>
  );
}
