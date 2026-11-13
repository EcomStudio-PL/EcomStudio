import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { usdPlnRate } from "@/lib/server/fx";
import { financeEvents, financeOverview, financePeriod } from "@/lib/services/finance";
import { FinanceFigures, FinanceEventsTable } from "@/components/admin/finance-figures";
import { cn } from "@/lib/utils";

/**
 * FINANSE — what the business really took in and what it really cost, per
 * period (CENNIK V2, migration 0176). Cash (payments) and recognised revenue
 * (credits used, at the price each credit was bought for) are different
 * numbers and are shown apart; an annual payment's untouched months stay in
 * "deferred". Internal accounts are reported apart. A figure the database
 * cannot know reads "Brak danych", never 0.
 */
const PERIODS = ["today", "7d", "30d", "month", "all"] as const;

export default async function AdminFinance({ searchParams }: {
  searchParams: Promise<{ p?: string; from?: string; to?: string; ws?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const period = financePeriod(sp);
  const workspaceId = sp.ws && /^[0-9a-f-]{36}$/i.test(sp.ws) ? sp.ws : null;

  const [overview, events, fx] = await Promise.all([
    financeOverview(supabase, period, workspaceId),
    financeEvents(supabase, period, workspaceId, 100),
    usdPlnRate(supabase),
  ]);
  const rate = fx?.rate ?? null;
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) next.set(k, v);
    return `/admin/finance${next.size ? `?${next}` : ""}`;
  };

  return (
    <div>
      <PageHeader title={t("admin.nav.financeView")} sub={t("admin.finance.sub")} />

      <div className="mb-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map((key) => (
            <Link key={key} href={qs({ p: key, from: undefined, to: undefined })}
              className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                period.key === key ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
              {t(`admin.finance.period.${key}`)}
            </Link>
          ))}
          <form action="/admin/finance" className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="p" value="custom" />
            {workspaceId && <input type="hidden" name="ws" value={workspaceId} />}
            <label className="sr-only" htmlFor="fin-from">{t("analytics.from")}</label>
            <input id="fin-from" type="date" name="from" defaultValue={sp.from ?? ""} required
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink" />
            <label className="sr-only" htmlFor="fin-to">{t("analytics.to")}</label>
            <input id="fin-to" type="date" name="to" defaultValue={sp.to ?? ""} required
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink" />
            <button type="submit"
              className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                period.key === "custom" ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
              {t("admin.finance.period.custom")}
            </button>
          </form>
        </div>
        <p className="text-[11px] text-faint">
          {t("admin.finance.showing", {
            from: new Date(period.from).toLocaleDateString(locale),
            to: new Date(new Date(period.to).getTime() - 1).toLocaleDateString(locale),
          })}
          {" · "}
          {rate
            ? t("admin.finance.fx", { rate: rate.toFixed(4), date: fx?.date ?? "—" }) + (fx?.stale ? ` · ${t("admin.finance.fxStale")}` : "")
            : t("admin.finance.fxMissing")}
          {workspaceId && <> · <Link href={qs({ ws: undefined })} className="text-accent">{t("admin.finance.allCustomers")}</Link></>}
        </p>
      </div>

      {!overview ? (
        <Card className="p-6 text-sm text-muted">{t("admin.finance.unavailable")}</Card>
      ) : (
        <>
          <FinanceFigures overview={overview} rate={rate} t={t} locale={locale} />

          <Card className="mt-6">
            <CardHeader title={t("admin.finance.toolsTitle")} sub={t("admin.finance.toolsSub")} />
            <div className="p-4">
              <AdminTable
                headers={[t("admin.finance.col.tool"), t("admin.finance.col.runs"), t("admin.finance.col.succeeded"),
                  t("admin.finance.col.failed"), t("admin.finance.col.outputs"), t("admin.finance.col.credits"), t("admin.finance.col.internalRuns")]}
                empty={t("admin.noData")}
                rows={overview.tools.map((r) => [
                  <span key="n" className="font-medium">{r.tool}</span>, r.runs, r.succeeded, r.failed, r.outputs,
                  Number(r.credits).toLocaleString(locale), r.internal_runs > 0 ? <Badge key="i" tone="neutral">{r.internal_runs}</Badge> : "0",
                ])}
              />
            </div>
          </Card>
        </>
      )}

      <div className="mt-6">
        <h2 className="mb-1 font-display text-base font-semibold">{t("admin.finance.eventsTitle")}</h2>
        <p className="mb-3 text-xs text-muted">{t("admin.finance.eventsSub")}</p>
        <FinanceEventsTable events={events} rate={rate} t={t} locale={locale} />
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-faint">
        {t("admin.finance.note", { vat: overview ? Math.round(overview.vat_rate_estimate * 100) : 23 })}
      </p>
    </div>
  );
}
