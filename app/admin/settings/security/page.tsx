import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getLoginSecuritySettings } from "@/lib/server/login-security";
import { PageHeader } from "@/components/ui/page-header";
import { LoginSecuritySettingsForm } from "@/components/admin/login-security-settings";

export const dynamic = "force-dynamic";

/**
 * BEZPIECZEŃSTWO LOGOWANIA — admin knobs for the step-up challenge.
 *
 * Read server-side so the form opens on what is actually stored (defaults
 * included, since getLoginSecuritySettings answers with the seeded values when
 * the row is missing or unreadable).
 */
export default async function AdminLoginSecurity() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const settings = await getLoginSecuritySettings(supabase);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("admin.nav.loginSecurity")}
        sub={t("loginSec.whenSub")}
      />
      <LoginSecuritySettingsForm settings={settings} />
    </div>
  );
}
