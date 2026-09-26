import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/grovnews-billing";
import {
  adminBilling, adminCampaigns, adminMonetizationStats, adminPlanOptions,
} from "@/lib/services/grovnews-billing";
import { MonetizationManager } from "@/components/admin/grovnews/monetization";

export const dynamic = "force-dynamic";

/** GrovNews → Monetyzacja: price, sales, launch campaign — and only real
 *  numbers, each counted or summed from existing rows. */
export default async function GrovNewsMonetization() {
  const supabase = await createClient();
  const [{ dict, locale }, billing, stats, campaigns, plans] = await Promise.all([
    getDictionary(), adminBilling(supabase), adminMonetizationStats(supabase),
    adminCampaigns(supabase), adminPlanOptions(supabase),
  ]);
  const t = makeT(dict);
  return (
    <div className="space-y-5" data-grovnews-monetization-page>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label={t("grovnewsAdm.mon.statPaid")} value={stats.activePaid} tone="success"
          hint={t("grovnewsAdm.mon.statPaidHint", { cancelling: stats.cancellingPaid, pastDue: stats.pastDue })} />
        <Stat label={t("grovnewsAdm.mon.statMrr")} value={formatMoney(stats.mrrCents, billing?.currency ?? "PLN", locale)}
          tone="accent" hint={t("grovnewsAdm.mon.statMrrHint")} />
        <Stat label={t("grovnewsAdm.mon.statLaunch")} value={stats.launchGrants}
          hint={stats.launchToPaid === null ? undefined : t("grovnewsAdm.mon.statLaunchHint", { n: stats.launchToPaid })} />
        <Stat label={t("grovnewsAdm.mon.statCodes")} value={`${stats.codesUsed} / ${stats.codesIssued}`}
          hint={t("grovnewsAdm.mon.statCodesHint")} />
        <Stat label={t("grovnewsAdm.statExpiring")} value={stats.expiringSoon} hint={t("grovnewsAdm.statExpiringHint")} />
      </div>
      <MonetizationManager billing={billing} campaigns={campaigns} plans={plans} />
    </div>
  );
}
