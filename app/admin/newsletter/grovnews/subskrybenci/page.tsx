import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { adminListEntitlements } from "@/lib/services/grovnews";
import { adminMailEligibility } from "@/lib/services/grovnews-research";
import { adminLaunchClaims, adminPaidSubscribers } from "@/lib/services/grovnews-billing";
import { formatMoney, formatWarsawNumeric } from "@/lib/grovnews-billing";
import { SubscribersManager } from "@/components/admin/grovnews/subscribers";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const PAID_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success", trialing: "success", past_due: "warning", unpaid: "danger", canceled: "neutral", paused: "neutral",
};

/** Access to GrovNews is not consent to e-mail: each row also says whether
 *  the newsletter would mail that person, by the newsletter's own rules.
 *  Above the granted access: PAID subscribers (from the signed webhook) and
 *  launch-campaign claims — statuses and dates only, no Stripe objects. */
export default async function GrovNewsSubscribers() {
  const supabase = await createClient();
  const [rows, paid, launch, { dict, locale }] = await Promise.all([
    adminListEntitlements(supabase), adminPaidSubscribers(supabase), adminLaunchClaims(supabase), getDictionary(),
  ]);
  const t = makeT(dict);
  const users = [...new Map(rows.map((r) => [r.userId, { id: r.userId, email: r.email }])).values()];
  const mail = await adminMailEligibility(supabase, users);
  const date = (iso: string | null) => formatWarsawNumeric(iso, locale);
  const yesNo = (v: boolean) => (v ? t("grovnewsAdm.mon.yes") : t("grovnewsAdm.mon.no"));
  return (
    <div className="space-y-6">
      <section className="space-y-2.5" data-grovnews-paid>
        <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.mon.paidTitle")}</h2>
        <AdminTable
          empty={t("grovnewsAdm.mon.noPaid")}
          headers={[t("grovnewsAdm.colUser"), t("grovnewsAdm.mon.colStripeStatus"), t("grovnewsAdm.mon.price"),
            t("grovnewsAdm.mon.colPeriodEnd"), t("grovnewsAdm.mon.colCancelAtEnd"), t("grovnewsAdm.mon.colCampaign"),
            t("grovnewsAdm.mon.colCode")]}
          rows={paid.map((p) => [
            <span key="u" className="break-all">{p.email}</span>,
            <Badge key="s" tone={PAID_TONE[p.status] ?? "neutral"}>{p.status}</Badge>,
            p.priceCents !== null ? formatMoney(p.priceCents, p.currency, locale) : "—",
            date(p.paidThrough ?? p.currentPeriodEnd),
            yesNo(p.cancelAtPeriodEnd),
            p.campaign ?? "—",
            p.codeIssued ? (p.codeUsed ? t("grovnewsAdm.mon.codeUsed") : t("grovnewsAdm.mon.codeIssued")) : "—",
          ])}
        />
      </section>
      <section className="space-y-2.5" data-grovnews-launch-claims>
        <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.mon.launchClaimsTitle")}</h2>
        <AdminTable
          empty={t("grovnewsAdm.mon.noClaims")}
          headers={[t("grovnewsAdm.colUser"), t("grovnewsAdm.mon.colCampaign"), t("grovnewsAdm.mon.colClaimed"),
            t("grovnewsAdm.mon.colAccess"), t("grovnewsAdm.mon.colCode")]}
          rows={launch.map((c) => [
            <span key="u" className="break-all">{c.email}</span>,
            c.campaign ?? "—",
            date(c.claimedAt),
            c.accessGranted ? (c.accessUntil ? date(c.accessUntil) : t("grovnewsAdm.forever")) : "—",
            c.codeIssued ? (c.codeUsed ? t("grovnewsAdm.mon.codeUsed") : t("grovnewsAdm.mon.codeIssued")) : "—",
          ])}
        />
      </section>
      <section className="space-y-2.5">
        <h2 className="text-[15px] font-semibold">{t("grovnewsAdm.mon.grantedTitle")}</h2>
        <SubscribersManager rows={rows.map((r) => ({ ...r, mail: mail.get(r.userId) ?? "no_contact" }))} />
      </section>
    </div>
  );
}
