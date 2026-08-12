import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { adminCounts, adminBusinessStats } from "@/lib/services/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

const plnFmt = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 });

function DayBars({ days, label, tone = "accent", empty }: {
  days: { day: string; value: number }[]; label: string; tone?: "accent" | "accent2"; empty?: string;
}) {
  const max = Math.max(...days.map((d) => d.value), 1);
  const total = days.reduce((s, d) => s + d.value, 0);
  const bar = tone === "accent2" ? "bg-accent2/70 group-hover:bg-accent2" : "bg-accent/80 group-hover:bg-accent";
  const step = days.length > 14 ? 5 : 1;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      {total === 0 && empty ? (
        <div className="flex h-16 items-center justify-center rounded-xl bg-raised/50 text-xs text-muted">{empty}</div>
      ) : (
        <div className="flex h-16 items-end gap-[3px]">
          {days.map((d, i) => (
            <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.value}`}>
              <div
                className={`w-full rounded-sm transition-colors ${bar}`}
                style={{ height: `${Math.max((d.value / max) * 100, 3)}%` }}
              />
              <span className="h-3 text-[9px] text-faint">{i % step === 0 ? d.day.slice(8) : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByDay(rows: { created_at: string; weight?: number }[], days: number) {
  const out: { day: string; value: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({
      day: key,
      value: rows.filter((r) => r.created_at.slice(0, 10) === key).reduce((s, r) => s + (r.weight ?? 1), 0),
    });
  }
  return out;
}

export default async function AdminDashboard() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [counts, biz, failed, activeModels, providers, jobs30, latestUsers, latestTx] = await Promise.all([
    adminCounts(supabase),
    adminBusinessStats(supabase),
    supabase.from("generation_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("ai_models").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("ai_providers").select("name, slug, active"),
    supabase.from("generation_jobs").select("created_at").gte("created_at", since30),
    supabase.from("profiles").select("email, full_name, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("credit_transactions").select("id, type, amount, description, created_at").order("created_at", { ascending: false }).limit(5),
  ]);
  const revenueDays = groupByDay(
    (biz.payments30d as { created_at: string; amount_cents: number }[]).map((p) => ({ created_at: p.created_at, weight: p.amount_cents / 100 })),
    30
  );

  return (
    <div>
      <PageHeader title={t("admin.title")} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("admin.statUsers")} value={biz.users} hint={`+${biz.usersToday} ${t("admin.kpiToday").toLowerCase()}`} />
        <Stat label={t("admin.revenueToday")} value={plnFmt.format(biz.revenueTodayCents / 100)} accent2 />
        <Stat label={t("admin.revenue30d")} value={plnFmt.format(biz.revenue30dCents / 100)} accent2 />
        <Stat label={t("admin.statCreditsUsed")} value={counts.creditsUsed} />
        <Stat label={t("admin.generationsToday")} value={biz.generationsToday} />
        <Stat label={t("admin.statFailed")} value={failed.count ?? 0} />
        <Stat label={t("admin.statActiveModels")} value={activeModels.count ?? 0} accent />
        <Card className="px-4 py-3">
          <p className="truncate text-xs font-medium text-muted">{t("admin.nav.providers")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(providers.data ?? []).map((p) => (
              <Badge key={p.slug} tone={p.active ? "green" : "neutral"}>{p.name}</Badge>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <DayBars days={revenueDays} label={t("admin.chartRevenue30")} tone="accent2" empty={t("admin.noRevenueYet")} />
        </Card>
        <Card className="p-5">
          <DayBars days={groupByDay(jobs30.data ?? [], 30)} label={t("admin.chartGenerations30")} empty={t("admin.noDataYet")} />
        </Card>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.latestUsers")} />
          {(latestUsers.data ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(latestUsers.data ?? []).map((u) => (
                <li key={u.email} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.full_name ?? u.email}</p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">{formatDate(u.created_at, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.latestTx")} />
          {(latestTx.data ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(latestTx.data ?? []).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t(`credits.tt.${tx.type}`)}</p>
                    <p className="truncate text-xs text-muted">{tx.description ?? formatDate(tx.created_at, locale)}</p>
                  </div>
                  <Badge tone={tx.amount >= 0 ? "green" : "red"}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
