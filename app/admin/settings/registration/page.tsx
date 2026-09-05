import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getRegistrationConfig } from "@/lib/server/registration-config";
import { PageHeader } from "@/components/ui/page-header";
import { RegistrationSettings } from "@/components/admin/registration-settings";

/**
 * REJESTRACJA I BEZPIECZEŃSTWO — the admin's side of the two signup forms.
 *
 * Read server-side so the screen opens on what is actually stored, defaults
 * included: getRegistrationConfig answers with the seeded modes when the row
 * is missing, which is exactly what /register and the launch page will draw.
 */
export default async function AdminRegistrationSettings() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const settings = await getRegistrationConfig(supabase);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("reg.title")}
        sub={t("reg.sub")}
      />
      <RegistrationSettings settings={settings} />
    </div>
  );
}
