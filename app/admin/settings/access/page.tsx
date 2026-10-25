import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AccessPanel } from "@/components/admin/access-panel";
import { accessConfigAction } from "@/app/actions/access-admin";
import { PublicToolsCard } from "@/components/admin/public-tools-card";
import { createClient } from "@/lib/supabase/server";
import { getPublicToolsFlag } from "@/lib/server/public-tools";
import { signupOpen } from "@/lib/platform-access";

export const dynamic = "force-dynamic";

/**
 * DOSTĘP DO PLATFORMY — who may sign in, who may sign up, and what a shut door
 * says. The admin layout above gates on role; every write re-checks it.
 */
export default async function AdminAccess() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const config = await accessConfigAction();
  // The admin layout above gates on role; the card's own write re-checks it.
  const publicTools = await getPublicToolsFlag(await createClient());

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("acc.title")}
        sub={t("acc.sub")}
      />
      {config
        ? <AccessPanel initial={config} />
        : <p className="text-sm text-muted">{t("common.error")}</p>}
      {config && (
        <PublicToolsCard
          initial={publicTools}
          signupOpen={signupOpen(config, new Date())}
          loginOpen={config.allowLogin}
          waitlistEnabled={config.waitlistEnabled}
        />
      )}
    </div>
  );
}
