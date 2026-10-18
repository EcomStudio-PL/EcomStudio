import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { OnboardingPanel } from "@/components/admin/onboarding-panel";
import { TrialWatermarkSettings } from "@/components/admin/trial-watermark-settings";
import { onboardingConfigAction, onboardingStatsAction } from "@/app/actions/onboarding-admin";
import { trialWatermarkPanelAction } from "@/app/actions/trial-watermark-admin";

export const dynamic = "force-dynamic";

/**
 * REJESTRACJA I BONUS POWITALNY — one place for the whole new-customer flow:
 * what the welcome offer is worth, how long it runs, what it says on every
 * surface, and which questions the onboarding survey asks. The admin layout
 * above gates on role; every write re-checks it.
 *
 * Below it, the other half of what a new customer meets: the watermark on
 * generations made with free credits only (its own section, its own row,
 * no menu entry of its own).
 */
export default async function AdminOnboarding() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [config, stats, trialWatermark] = await Promise.all([
    onboardingConfigAction(),
    onboardingStatsAction(),
    trialWatermarkPanelAction(),
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

      <div id="znak-wodny" className="mt-10 scroll-mt-4 border-t border-line pt-6">
        {trialWatermark
          ? <TrialWatermarkSettings panel={trialWatermark} />
          : (
            <>
              <h2 className="font-display text-lg font-semibold text-ink">{t("admin.trialWm.title")}</h2>
              <p className="mt-1 text-sm text-muted">{t("common.error")}</p>
            </>
          )}
      </div>
    </div>
  );
}
