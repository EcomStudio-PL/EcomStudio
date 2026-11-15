import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { FinanceTabs } from "@/components/admin/finance-tabs";
import { ProviderFundsCard, ReserveSettingsForm, ReserveReportsPanel, type ReportLogRow } from "@/components/admin/api-reserves";
import { loadReserveReport } from "@/lib/server/api-reserves/reports";
import { PROVIDER_FUNDS } from "@/lib/server/api-reserves/providers";
import type { ProviderStatus, Scenario } from "@/lib/finance/api-reserves";
import { cn } from "@/lib/utils";

/**
 * FINANSE → REZERWY API (0180). Admin only: the admin layout redirects anyone
 * else, and every figure comes from api_reserve_snapshot(), which re-checks
 * is_admin() in the database. What the providers hold, what customers can
 * still spend, the forecast and the money to keep ready. A value the system
 * cannot know reads "Brak danych" — never $0.
 */
export const dynamic = "force-dynamic";

const REPORT_EVENTS = ["finance.reserve_sale", "finance.reserve_hourly", "finance.reserve_daily", "finance.funds_low"];

const TONE: Record<ProviderStatus, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success", warning: "warning", critical: "danger", no_data: "neutral", off: "neutral",
};

export default async function ApiReserves() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const [loaded, history] = await Promise.all([
    loadReserveReport(supabase, false),
    supabase.from("notification_outbox").select("id, event_type, channel, status, last_error_safe, created_at, sent_at, payload")
      .in("event_type", REPORT_EVENTS).order("created_at", { ascending: false }).limit(40),
  ]);

  const money = (micros: number | null | undefined) =>
    micros === null || micros === undefined ? t("admin.reserves.noData") : `$${(micros / 1_000_000).toFixed(2)}`;
  const nf = (n: number) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(n);
  const sc = (s: Scenario) => `${money(s.standard)} · ${t("admin.reserves.cautiousShort")} ${money(s.cautious)}`;

  if (!loaded) {
    return (
      <div>
        <PageHeader title={t("admin.nav.financeView")} sub={t("admin.reserves.sub")} />
        <FinanceTabs />
        <Card className="p-5 text-sm text-muted">{t("admin.reserves.unavailable")}</Card>
      </div>
    );
  }
  const { report } = loaded;
  const st = report.settings;
  const c = report.credits;

  const log: ReportLogRow[] = (history.data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as { title?: string };
    return {
      id: row.id, type: row.event_type, channel: row.channel, status: row.status, error: row.last_error_safe,
      title: typeof payload.title === "string" ? payload.title : row.event_type,
      at: new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" }).format(new Date(row.sent_at ?? row.created_at)),
    };
  });

  return (
    <div>
      <PageHeader title={t("admin.nav.financeView")} sub={t("admin.reserves.sub")} />
      <FinanceTabs />

      {/* Overall state, and the assumptions the numbers rest on. */}
      <Card className={cn("mb-5 p-4 sm:p-5", report.status === "critical" && "ring-1 ring-[rgb(var(--danger)/0.4)]")}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[report.status]} dot>{t(`admin.reserves.status.${report.status}`)}</Badge>
          {!st.enabled && <Badge tone="warning">{t("admin.reserves.disabled")}</Badge>}
          <span className="text-sm text-muted">
            {report.missing > 0 ? t("admin.reserves.needsTopup", { amount: money(report.missing) }) : t("admin.reserves.covered")}
          </span>
        </div>
        {report.assumptions.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs leading-relaxed text-muted">
            {report.assumptions.map((a) => <li key={a}>• {t(`admin.reserves.assume.${a}`, { n: nf(st.min_history_credits) })}</li>)}
          </ul>
        )}
        {report.unknownFunds.length > 0 && (
          <p className="mt-2 text-xs text-warning">{t("admin.reserves.unknownFunds", { list: report.unknownFunds.join(", ") })}</p>
        )}
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("admin.reserves.kpi.available")} value={money(report.available.micros)} hint={t(`admin.reserves.basis.${report.available.basis}`)} />
        <Stat label={t("admin.reserves.kpi.spendToday")} value={money(report.spend.total.today)}
          hint={t("admin.reserves.kpi.spendWindows", { h24: money(report.spend.total.d1), d7: money(report.spend.total.d7), d30: money(report.spend.total.d30) })} />
        <Stat label={t("admin.reserves.kpi.reserve")} value={money(report.reserve)}
          hint={t("admin.reserves.kpi.reserveHint", { buffer: nf(st.buffer_percent), days: st.horizon_days, scenario: t(`admin.reserves.scenario.${st.scenario}`) })} />
        <Stat label={t("admin.reserves.kpi.missing")} value={money(report.missing)} tone={report.missing > 0 ? "accent" : "success"}
          hint={t("admin.reserves.kpi.missingHint", { topup: money(report.topupTotal), secure: money(report.secureTotal) })} />
        <Stat label={t("admin.reserves.kpi.customerCredits")} value={nf(c.customer.total)}
          hint={t("admin.reserves.kpi.customerCreditsHint", { internal: nf(c.internal.total) })} />
        <Stat label={t("admin.reserves.kpi.soldMonth")} value={nf(c.month.granted_subscription + c.month.granted_topup)}
          hint={t("admin.reserves.kpi.soldHint", { sub: nf(c.month.granted_subscription), topup: nf(c.month.granted_topup), bonus: nf(c.month.granted_bonus) })} />
        <Stat label={t("admin.reserves.kpi.usedMonth")} value={nf(c.month.used)} hint={t("admin.reserves.kpi.expiredHint", { n: nf(c.month.expired) })} />
        <Stat label={t("admin.reserves.kpi.exposure")} value={report.exposure ? money(report.exposure.standard) : t("admin.reserves.noData")}
          hint={report.exposure ? t("admin.reserves.kpi.exposureHint", { cautious: money(report.exposure.cautious) }) : undefined} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.reserves.credits.title")} sub={t("admin.reserves.credits.sub")} />
          <div className="overflow-x-auto px-4 pb-4 sm:px-5">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">{t("admin.reserves.credits.pool")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("admin.reserves.credits.customers")}</th>
                <th className="py-2 text-right font-medium">{t("admin.reserves.credits.internal")}</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {(["subscription", "topup", "bonus", "legacy"] as const).map((k) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-2 pr-3">{t(`admin.reserves.pool.${k}`)}</td>
                    <td className="py-2 pr-3 text-right">{nf(c.customer[k])}</td>
                    <td className="py-2 text-right text-muted">{nf(c.internal[k])}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="py-2 pr-3">{t("admin.reserves.pool.tranches")}</td>
                  <td className="py-2 pr-3 text-right">{nf(c.customer.tranches.total)}</td>
                  <td className="py-2 text-right text-muted">{nf(c.internal.tranches.total)}</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-2 pr-3">{t("admin.reserves.pool.expiring", { days: st.horizon_days })}</td>
                  <td className="py-2 pr-3 text-right">{nf(c.customer.expiring_horizon)}</td>
                  <td className="py-2 text-right text-muted">{nf(c.internal.expiring_horizon)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("admin.reserves.forecast.title")} sub={t(`admin.reserves.source.${report.costPerCredit.source}`)} />
          <div className="space-y-2 px-4 pb-4 text-sm sm:px-5">
            <Row label={t("admin.reserves.forecast.cpc")} value={report.costPerCredit.standard === null ? t("admin.reserves.noData")
              : `${money(report.costPerCredit.standard)} · ${t("admin.reserves.cautiousShort")} ${money(report.costPerCredit.cautious)}`} />
            <Row label={t("admin.reserves.forecast.utilization")} value={`${nf(report.costPerCredit.utilization * 100)}%`} />
            <Row label={t("admin.reserves.forecast.h24")} value={sc(report.need.h24)} />
            <Row label={t("admin.reserves.forecast.d7")} value={sc(report.need.d7)} />
            <Row label={t("admin.reserves.forecast.horizon", { days: st.horizon_days })} value={sc(report.need.horizon)} />
            <div className="border-t border-line pt-2">
              <Row label={t("admin.reserves.forecast.spendSplit")} value={t("admin.reserves.forecast.spendSplitValue", {
                customers: money(report.spend.customer.month), internal: money(report.spend.internal.month), system: money(report.spend.system.month) })} />
              {report.unknownCalls.month > 0 && (
                <p className="mt-1 text-xs text-warning">{t("admin.reserves.forecast.unknownCalls", { n: report.unknownCalls.month })}</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <h2 className="mb-3 mt-6 text-base font-semibold">{t("admin.reserves.providers.title")}</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {report.providers.map((p) => (
          <ProviderFundsCard key={p.id} p={p} scenario={st.scenario} capability={PROVIDER_FUNDS[p.slug]?.balance ?? "manual"} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReserveSettingsForm settings={st} />
        <ReserveReportsPanel log={log} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
