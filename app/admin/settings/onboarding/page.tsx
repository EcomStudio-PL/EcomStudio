import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { OnboardingPanel } from "@/components/admin/onboarding-panel";
import { onboardingConfigAction, onboardingStatsAction } from "@/app/actions/onboarding-admin";

export const dynamic = "force-dynamic";

/**
 * REJESTRACJA I BONUS POWITALNY — one place for the whole new-customer flow:
 * what the welcome offer is worth, how long it runs, what it says on every
 * surface, and which questions the onboarding survey asks. The admin layout
 * above gates on role; every write re-checks it.
 */
export default async function AdminOnboarding() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [config, stats] = await Promise.all([
    onboardingConfigAction(),
    onboardingStatsAction(),
  ]);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.system")}
        title={t("onb.title")}
        sub={t("onb.sub")}
      />
      {config
        ? <OnboardingPanel initial={config} stats={stats} />
        : <p className="text-sm text-muted">{t("common.error")}</p>}
    </div>
  );
}
