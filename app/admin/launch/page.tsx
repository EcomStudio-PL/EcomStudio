import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { LOCALES } from "@/lib/i18n/config";
import { PageHeader } from "@/components/ui/page-header";
import { LaunchEditor, type LaunchEditorData } from "@/components/admin/launch-editor";
import { getLaunchStore, LAUNCH_FIELDS, launchDefault } from "@/lib/server/launch-page";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

// The shipped copy for every language, so the editor can show each field's
// translated default as a placeholder no matter which language the admin's own
// interface is in.
const LAUNCH_DICTS: Record<string, Record<string, unknown>> = {
  pl: pl.launch, en: (en as typeof pl).launch, de: (de as typeof pl).launch,
};

export default async function AdminLaunchPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const store = await getLaunchStore(supabase);

  const defaults: LaunchEditorData["defaults"] = {};
  for (const locale of LOCALES) {
    const source = LAUNCH_DICTS[locale] ?? {};
    defaults[locale] = Object.fromEntries(
      LAUNCH_FIELDS.map((field) => [field, launchDefault(source, field)]),
    );
  }

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("launchAdmin.launchTitle")}
        sub={t("launchAdmin.launchSub")}
      />
      <LaunchEditor data={{ locales: [...LOCALES], draft: store.draft, defaults }} />
    </div>
  );
}
