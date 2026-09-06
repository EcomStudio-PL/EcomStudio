import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { FeatureAvailabilityPanel } from "@/components/admin/feature-availability-panel";
import { listFeatureAvailabilityAction } from "@/app/actions/features";

export const dynamic = "force-dynamic";

/**
 * DOSTĘPNOŚĆ FUNKCJI — the switchboard for real product modules. The admin
 * layout above gates on role; every write re-checks it. Login, auth confirm,
 * the security challenge, settings and billing have no tile here on purpose
 * (C11) — the registry does not know them.
 */
export default async function AdminFeatureAvailability() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const rows = await listFeatureAvailabilityAction();

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("featAdm.title")}
        sub={t("featAdm.sub")}
      />
      {rows
        ? <FeatureAvailabilityPanel rows={rows} />
        : <p className="text-sm text-muted">{t("common.error")}</p>}
    </div>
  );
}
