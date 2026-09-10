import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { readDashboard } from "@/lib/services/admin-dashboard";
import { adminCounts } from "@/lib/services/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard, RevenueChart } from "@/components/admin/dashboard-kpi";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";
import { ArrowRight, Coins, Users, Wand2, Wallet } from "lucide-react";

/**
 * THE COMMAND CENTRE.
 *
 * Six business questions, in the order somebody actually asks them: how many
 * customers, how much money, what does the month look like, who just arrived,
 * who just paid, and what do I open next. The integration diagnostics that
 * used to sit in the middle of this page still exist — they live on
 * /admin/system, where a connection problem is what you came for.
 */

const plnFmt = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 });
const plnExact = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const pln = (cents: number) => plnFmt.format(cents / 100);

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export default async function AdminDashboard({ searchParams }: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range: Range = RANGES.includes(Number(rangeParam) as Range) ? (Number(rangeParam) as Range) : 30;

  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const [data, counts] = await Promise.all([readDashboard(supabase, range), adminCounts(supabase)]);

  const hintFor = (days: number) => t("admin.vsPrevious", { n: days });

  return (
    <div>
      <PageHeader overline={t("admin.navGroups.overview")} title={t("admin.title")} />

      {/* ROW 1 — CUSTOMERS. The count first, because everything else is downstream of it. */}
      <section aria-labelledby="kpi-customers">
        <h2 id="kpi-customers" className="overline mb-2 text-[10px]">{t("admin.kpiClients")}</h2>
        <div className="grid grid-cols-2 gap-2.5 [&>*]:min-w-0 lg:grid-cols-4">
          <KpiCard label={t("admin.kpiToday")} value={String(data.customers.today.current)}
            window={data.customers.today} hint={t("admin.vsYesterday")} />
          <KpiCard label={t("admin.kpi7d")} value={String(data.customers.week.current)}
            window={data.customers.week} hint={hintFor(7)} />
          <KpiCard label={t("admin.kpi30d")} value={String(data.customers.month.current)}
            window={data.customers.month} hint={hintFor(30)} />
          <KpiCard label={t("admin.kpiTotal")} value={String(data.customers.total)} />
        </div>
      </section>

      {/* ROW 2 — REVENUE. Louder than the counts: it is the number the business runs on. */}
      <section aria-labelledby="kpi-revenue" className="mt-4">
        <h2 id="kpi-revenue" className="overline mb-2 text-[10px]">{t("admin.kpiRevenue")}</h2>
        <div className="grid grid-cols-2 gap-2.5 [&>*]:min-w-0 lg:grid-cols-3">
          <KpiCard emphasis label={t("admin.kpiToday")} value={pln(data.revenueCents.today.current)}
            window={data.revenueCents.today} hint={t("admin.vsYesterday")} />
          <KpiCard emphasis label={t("admin.kpi7d")} value={pln(data.revenueCents.week.current)}
            window={data.revenueCents.week} hint={hintFor(7)} />
          <KpiCard emphasis label={t("admin.kpi30d")} value={pln(data.revenueCents.month.current)}
            window={data.revenueCents.month} hint={hintFor(30)} />
        </div>
      </section>

      {/* ROW 3 — ONE chart. The shape of the month, and the exact day on hover. */}
      <Card className="mt-4 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("admin.chartRevenue")}</p>
            <p className="text-xs text-muted">{t("admin.chartRevenueSub", { n: range })}</p>
          </div>
          <nav className="flex shrink-0 gap-1 rounded-xl bg-raised p-1" aria-label={t("admin.chartRange")}>
            {RANGES.map((r) => (
              <Link
                key={r}
                href={r === 30 ? "/admin" : `/admin?range=${r}`}
                scroll={false}
                aria-current={r === range ? "true" : undefined}
                className={cn(
                  "min-h-[32px] rounded-lg px-3 text-[13px] font-semibold leading-8 transition-colors",
                  r === range ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {t("admin.rangeDays", { n: r })}
              </Link>
            ))}
          </nav>
        </div>
        <RevenueChart data={data.chart} format={(cents) => plnExact.format(cents / 100)}
          empty={t("admin.noRevenueInRange")} />
      </Card>

      {/* ROW 4 — who arrived, who paid. */}
      <div className="mt-4 grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.latestUsers")} action={
            <Link href="/admin/users" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
              {t("common.seeMore")} <ArrowRight size={14} aria-hidden />
            </Link>
          } />
          {data.recentUsers.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">{t("admin.noUsersYet")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar name={u.name} email={u.email} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/users/${u.id}`} className="truncate text-sm font-medium hover:text-accent">
                      {u.name ?? u.email}
                    </Link>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!u.verified && <Badge tone="neutral">{t("crm.unverified")}</Badge>}
                    {u.plan && <Badge tone="accent">{u.plan}</Badge>}
                    <RelativeTime at={u.createdAt} locale={locale} t={t} className="text-xs text-faint" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t("admin.latestPayments")} action={
            <Link href="/admin/credits" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
              {t("common.seeMore")} <ArrowRight size={14} aria-hidden />
            </Link>
          } />
          {data.recentPayments.length === 0 ? (
            /*
              An empty payments list on a young product is the truth, not a
              failure — so it says what it means and points at the screen where
              packages are configured. No demo rows: a fabricated payment in an
              admin panel is worse than an empty one.
            */
            <div className="px-5 py-10 text-center">
              <Wallet size={22} className="mx-auto text-faint" aria-hidden />
              <p className="mt-2 text-sm font-medium">{t("admin.noPaymentsTitle")}</p>
              <p className="mx-auto mt-1 max-w-[36ch] text-xs text-muted">{t("admin.noPaymentsBody")}</p>
              <Link href="/admin/credits"
                className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-accent-soft px-3 text-[13px] font-semibold text-accent hover:brightness-110">
                {t("admin.packages")} <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.customer}</p>
                    <p className="truncate text-xs text-muted">{p.email ?? p.what ?? t("admin.noData")}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {/* The amount is what this row is for — it reads first. */}
                    <p className="metric text-[15px] text-accent2">{pln(p.amountCents)}</p>
                    <RelativeTime at={p.createdAt} locale={locale} t={t} className="text-xs text-faint" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ROW 5 — the three screens an operator opens from here, plus a quiet fact strip. */}
      <div className="mt-4 grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1fr_auto]">
        <Card className="p-4">
          <p className="overline mb-2.5 text-[9.5px]">{t("admin.quickActions")}</p>
          <div className="flex flex-wrap gap-2">
            <QuickAction href="/admin/users" icon={Users} label={t("admin.nav.users")} />
            <QuickAction href="/admin/credits" icon={Coins} label={t("admin.nav.credits")} />
            <QuickAction href="/admin/generations" icon={Wand2} label={t("admin.nav.generations")} />
          </div>
        </Card>
        {/* Two facts, not three: "Produkty" left with the module. The grid
            follows, so the row stays even instead of leaving a gap where a
            retired metric used to be. */}
        <div className="panel grid grid-cols-2 gap-x-5 gap-y-3 rounded-2xl px-4 py-3.5 sm:px-5">
          <MiniFact label={t("admin.statCreditsUsed")} value={counts.creditsUsed} />
          <MiniFact label={t("admin.statJobs")} value={counts.jobs} />
        </div>
      </div>
    </div>
  );
}

/** Initial over the brand tint — a face for the row when there is no avatar,
 *  falling back to the e-mail when the customer never gave a name. */
function Avatar({ name, email }: { name: string | null; email: string }) {
  const source = (name ?? email).trim();
  const initial = source.charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-bold text-accent">
      {initial}
    </span>
  );
}

function QuickAction({ href, icon: Icon, label }: {
  href: string; icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; label: string;
}) {
  return (
    <Link href={href}
      className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-line bg-raised/60 px-3.5 text-[13px] font-semibold transition-colors hover:border-accent hover:text-accent">
      <Icon size={15} aria-hidden />
      {label}
    </Link>
  );
}

/** A quiet secondary figure: present when needed, never competing with the
 *  KPIs above it. */
function MiniFact({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0">
      <p className="overline text-[9px]">{label}</p>
      <p className="metric mt-1 truncate text-lg text-ink">{value}</p>
    </div>
  );
}
