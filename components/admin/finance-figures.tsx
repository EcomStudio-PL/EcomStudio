import Link from "next/link";
import type { makeT } from "@/lib/i18n/t";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { approxPln } from "@/components/plan/pricing-model";
import { contributionCents, microsToCents, type FinanceEvent, type FinanceOverview } from "@/lib/services/finance";

type T = ReturnType<typeof makeT>;

/**
 * The finance figures of CENNIK V2 (0176), shared by /admin/finance and the
 * customer card. Server-rendered, admin-only. Money is USD (what Stripe
 * charges) with an informational "≈ zł" at the NBP rate; a figure nobody
 * recorded reads "Brak danych" — never $0.00.
 */
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdFine = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const usd = (cents: number) => usdFmt.format(cents / 100);
const usdMicros = (micros: number) => usdFine.format(micros / 1_000_000);

const creditsIn = (locale: string) => (n: number) => (Math.round(Number(n) * 100) / 100).toLocaleString(locale);

function plnHint(cents: number, rate: number | null, extra?: string | null): string | undefined {
  const pln = approxPln(cents, rate);
  const parts = [pln ? `≈ ${pln}` : null, extra ?? null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export function FinanceFigures({ overview: o, rate, t, locale }: { overview: FinanceOverview; rate: number | null; t: T; locale: string }) {
  const credits = creditsIn(locale);
  const noData = t("admin.noData");
  const p = o.payments, u = o.usage, d = o.deferred, c = o.credits;
  const paid = p.count > 0;
  const payingRuns = u.runs - u.runs_internal;
  const feesKnown = paid && p.fees_unknown < p.count;
  const margin = contributionCents(u);
  const vatHint = p.vat_estimated === false ? t("admin.finance.vatStripe") : t("admin.finance.vatEstimated", { vat: Math.round(o.vat_rate_estimate * 100) });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title={t("admin.finance.cashTitle")} sub={t("admin.finance.cashSub")} />
        <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 lg:grid-cols-4">
          <Stat label={t("admin.finance.gross")} value={paid ? usd(p.gross) : noData} tone="accent2"
            hint={paid ? plnHint(p.gross, rate, t("admin.finance.payments", { n: p.count })) : undefined} />
          <Stat label={t("admin.finance.net")} value={paid ? usd(p.net) : noData} hint={paid ? plnHint(p.net, rate, vatHint) : undefined} />
          <Stat label={t("admin.finance.subMonthly")} value={paid ? usd(p.subscription_monthly) : noData} hint={paid ? plnHint(p.subscription_monthly, rate) : undefined} />
          <Stat label={t("admin.finance.subAnnual")} value={paid ? usd(p.subscription_annual) : noData}
            hint={paid ? plnHint(p.subscription_annual, rate, t("admin.finance.annualCash")) : undefined} />
          <Stat label={t("admin.finance.topups")} value={paid ? usd(p.topups) : noData} hint={paid ? plnHint(p.topups, rate) : undefined} />
          <Stat label={t("admin.finance.fees")} value={feesKnown ? usd(p.fees) : noData}
            hint={paid && p.fees_unknown > 0 ? t("admin.finance.feesUnknown", { n: p.fees_unknown }) : feesKnown ? plnHint(p.fees, rate) : undefined} />
          <Stat label={t("admin.finance.refunded")} value={paid ? usd(p.refunded) : noData} />
          <Stat label={t("admin.finance.internalPayments")} value={paid ? usd(p.internal) : noData} hint={t("admin.finance.internalHint")} />
        </div>
        {p.other_currency > 0 && (
          <p className="px-5 pb-4 text-xs text-warning">{t("admin.finance.otherCurrency", { n: p.other_currency })}</p>
        )}
      </Card>

      <Card>
        <CardHeader title={t("admin.finance.usageTitle")} sub={t("admin.finance.usageSub")} />
        <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 lg:grid-cols-4">
          <Stat label={t("admin.finance.creditsUsed")} value={u.runs > 0 ? credits(u.credits_used) : noData}
            hint={u.runs > 0 ? t("admin.finance.paidFree", { paid: credits(u.paid_credits), free: credits(u.free_credits) }) : undefined} />
          <Stat label={t("admin.finance.revenueGross")} value={u.runs > 0 ? usd(u.revenue_gross) : noData} hint={u.runs > 0 ? plnHint(u.revenue_gross, rate) : undefined} />
          <Stat label={t("admin.finance.revenueNet")} value={u.runs > 0 ? usd(u.revenue_net) : noData} hint={u.runs > 0 ? plnHint(u.revenue_net, rate) : undefined} />
          <Stat label={t("admin.finance.feeAttributed")} value={u.runs > 0 ? usd(u.fee_attributed) : noData} />
          <Stat label={t("admin.finance.apiPaying")} value={payingRuns > 0 ? usdMicros(u.api_cost_paying_usd_micros) : noData}
            hint={payingRuns > 0 ? plnHint(microsToCents(u.api_cost_paying_usd_micros), rate) : undefined} />
          <Stat label={t("admin.finance.apiInternal")} value={u.runs_internal > 0 ? usdMicros(u.api_cost_internal_usd_micros) : noData}
            hint={u.runs_internal > 0 ? t("admin.finance.runs", { n: u.runs_internal }) : undefined} />
          <Stat label={t("admin.finance.apiUnknown")} value={u.runs > 0 ? String(u.api_cost_unknown_calls) : noData}
            hint={t("admin.finance.apiUnknownHint")} />
          <Stat label={t("admin.finance.margin")} value={payingRuns > 0 ? usd(Math.round(margin)) : noData}
            tone={margin >= 0 ? "success" : "default"}
            hint={payingRuns > 0 ? (u.api_cost_unknown_calls > 0 ? t("admin.finance.marginIncomplete") : t("admin.finance.marginHint")) : undefined} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.finance.deferredTitle")} sub={t("admin.finance.deferredSub")} />
          <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4">
            <Stat label={t("admin.finance.pendingTranches")} value={d.pending_tranches > 0 ? credits(d.pending_tranche_credits) : noData}
              hint={d.pending_tranches > 0 ? t("admin.finance.tranches", { n: d.pending_tranches, value: usd(d.pending_tranche_net) }) : undefined} />
            <Stat label={t("admin.finance.unusedPaid")} value={d.unused_paid_credits > 0 ? credits(d.unused_paid_credits) : noData}
              hint={d.unused_paid_credits > 0 ? t("admin.finance.netValue", { value: usd(d.unused_paid_net) }) : undefined} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("admin.finance.creditsTitle")} sub={t("admin.finance.creditsSub")} />
          <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 lg:grid-cols-3">
            <Stat label={t("admin.finance.grantedSub")} value={credits(c.granted_subscription)} />
            <Stat label={t("admin.finance.grantedTopup")} value={credits(c.granted_topup)} />
            <Stat label={t("admin.finance.grantedBonus")} value={credits(c.granted_bonus)} hint={t("admin.finance.notSales")} />
            <Stat label={t("admin.finance.used")} value={credits(c.used)} />
            <Stat label={t("admin.finance.creditsRefunded")} value={credits(c.refunded)} />
            <Stat label={t("admin.finance.expired")} value={credits(c.expired)}
              hint={c.expired > 0 ? t("admin.finance.netValue", { value: usd(c.expired_paid_net) }) : undefined} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/** One row per run: what it used, what it cost, what it earned. */
export function FinanceEventsTable({ events, rate, t, locale, linkCustomers = true }: {
  events: FinanceEvent[]; rate: number | null; t: T; locale: string; linkCustomers?: boolean;
}) {
  const noData = t("admin.noData");
  const credits = creditsIn(locale);
  return (
    <AdminTable
      headers={[t("common.date"), t("admin.finance.col.customer"), t("admin.finance.col.tool"), t("admin.finance.col.credits"),
        t("admin.finance.col.tokens"), t("admin.finance.col.apiCost"), t("admin.finance.col.revenueNet"), t("admin.finance.col.details")]}
      empty={noData}
      rows={events.map((e) => {
        const cost = e.api_cost_usd_micros;
        const pln = cost != null ? approxPln(microsToCents(cost), rate) : null;
        return [
          <span key="d" className="whitespace-nowrap tabular-nums">{new Date(e.at).toLocaleString(locale)}</span>,
          <span key="c" className="flex flex-wrap items-center gap-1.5">
            {linkCustomers
              ? <Link href={`/admin/finance?ws=${e.workspace_id}`} className="truncate text-accent hover:opacity-75">{e.user_email ?? e.workspace_id.slice(0, 8)}</Link>
              : <span className="truncate">{e.user_email ?? "—"}</span>}
            {e.internal && <Badge tone="neutral">{t("admin.finance.internal")}</Badge>}
          </span>,
          <span key="t" className="flex flex-col">
            <span className="font-medium">{e.tool}</span>
            <span className="text-[11px] text-muted">{[e.model, e.resolution, e.status].filter(Boolean).join(" · ")}</span>
          </span>,
          <span key="k" className="flex flex-col tabular-nums">
            <span>{credits(e.credits)}</span>
            <span className="text-[11px] text-muted">
              {t("admin.finance.paidFree", { paid: credits(e.paid_credits), free: credits(e.free_credits) })}
              {e.refunds > 0 ? ` · ${t("admin.finance.refundedN", { n: credits(e.refunded_credits) })}` : ""}
            </span>
          </span>,
          e.input_tokens == null && e.output_tokens == null
            ? <span key="tk" className="text-muted">{noData}</span>
            : <span key="tk" className="tabular-nums">{(e.input_tokens ?? 0).toLocaleString(locale)} / {(e.output_tokens ?? 0).toLocaleString(locale)}</span>,
          cost == null
            ? <span key="a" className="text-muted">{noData}</span>
            : <span key="a" className="flex flex-col tabular-nums"><span>{usdMicros(cost)}</span>{pln && <span className="text-[11px] text-muted">≈ {pln}</span>}</span>,
          e.paid_credits > 0
            ? <span key="r" className="tabular-nums">{usd(e.revenue_net)}{e.vat_estimated ? " *" : ""}</span>
            : <span key="r" className="text-muted">{t("admin.finance.freeCredits")}</span>,
          e.calls.length === 0
            ? <span key="x" className="text-muted">—</span>
            : (
              <details key="x" className="text-[11px]">
                <summary className="cursor-pointer text-accent">{t("admin.finance.calls", { n: e.calls_count })}</summary>
                <ul className="mt-1.5 space-y-1">
                  {e.calls.map((c, i) => (
                    <li key={i} className="tabular-nums text-muted">
                      {[c.provider, c.model, c.resolution, c.status].filter(Boolean).join(" · ")}
                      {" — "}
                      {t("admin.finance.callTokens", { in: c.input_tokens ?? "—", out: c.output_tokens ?? "—", thought: c.thought_tokens ?? "—" })}
                      {" — "}
                      {c.cost_usd_micros == null ? noData : `${usdMicros(c.cost_usd_micros)}${c.cost_basis ? ` (${c.cost_basis})` : ""}`}
                    </li>
                  ))}
                </ul>
              </details>
            ),
        ];
      })}
    />
  );
}

/** The customer card: pools now, and the all-time result, with a link to the
 *  full finance view filtered to this workspace. */
export function CustomerFinance({ overview: o, pools, rate, t, locale, workspaceId }: {
  overview: FinanceOverview | null;
  pools: { subscription: number; topup: number; topupLocked: number; bonus: number; planLive: boolean; nextExpiry: string | null } | null;
  rate: number | null; t: T; locale: string; workspaceId: string;
}) {
  const noData = t("admin.noData");
  const credits = creditsIn(locale);
  const p = o?.payments, u = o?.usage;
  const paid = !!p && p.count > 0;
  const payingRuns = u ? u.runs - u.runs_internal : 0;
  return (
    <Card>
      <CardHeader title={t("admin.finance.customerTitle")} sub={t("admin.finance.customerSub")} action={
        <Link href={`/admin/finance?p=all&ws=${workspaceId}`} className="text-xs font-medium text-accent hover:opacity-75">{t("admin.finance.openFull")} →</Link>
      } />
      <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("admin.finance.pool.subscription")} value={pools ? credits(pools.subscription) : noData}
          hint={pools?.nextExpiry ? t("admin.finance.poolExpires", { date: new Date(pools.nextExpiry).toLocaleDateString(locale) }) : undefined} />
        <Stat label={t("admin.finance.pool.topup")} value={pools ? credits(pools.topup + pools.topupLocked) : noData}
          hint={pools && pools.topupLocked > 0 ? t("admin.finance.poolLocked") : undefined} />
        <Stat label={t("admin.finance.pool.bonus")} value={pools ? credits(pools.bonus) : noData} hint={t("admin.finance.notSales")} />
        <Stat label={t("admin.finance.creditsUsed")} value={u && u.runs > 0 ? credits(u.credits_used) : noData}
          hint={u && u.runs > 0 ? t("admin.finance.paidFree", { paid: credits(u.paid_credits), free: credits(u.free_credits) }) : undefined} />
        <Stat label={t("admin.finance.gross")} value={paid ? usd(p.gross) : noData} tone="accent2"
          hint={paid ? plnHint(p.gross, rate, t("admin.finance.payments", { n: p.count })) : undefined} />
        <Stat label={t("admin.finance.fees")} value={paid && p.fees_unknown < p.count ? usd(p.fees) : noData}
          hint={paid && p.fees_unknown > 0 ? t("admin.finance.feesUnknown", { n: p.fees_unknown }) : undefined} />
        <Stat label={t("admin.finance.col.apiCost")} value={u && u.runs > 0 ? usdMicros(u.api_cost_paying_usd_micros + u.api_cost_internal_usd_micros) : noData}
          hint={u && u.api_cost_unknown_calls > 0 ? t("admin.finance.apiUnknownHint") : undefined} />
        <Stat label={t("admin.finance.margin")} value={u && payingRuns > 0 ? usd(Math.round(contributionCents(u))) : noData}
          hint={u && payingRuns > 0 ? t("admin.finance.marginHint") : undefined} />
      </div>
    </Card>
  );
}
