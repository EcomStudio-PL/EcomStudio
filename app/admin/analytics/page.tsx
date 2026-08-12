import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { formatCredits, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(cents / 100);
const usd = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;
const SETTLED = new Set(["succeeded", "paid", "completed"]);

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365 } as const;
type RangeKey = keyof typeof RANGES;

function bucketize(rows: { created_at: string; v: number }[], range: RangeKey) {
  const now = new Date();
  const buckets: { label: string; value: number }[] = [];
  if (range === "24h") {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600000);
      const key = d.toISOString().slice(0, 13);
      buckets.push({
        label: `${d.getUTCHours()}:00`,
        value: rows.filter((r) => r.created_at.slice(0, 13) === key).reduce((s, r) => s + r.v, 0),
      });
    }
  } else if (range === "12m") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        label: key.slice(2),
        value: rows.filter((r) => r.created_at.slice(0, 7) === key).reduce((s, r) => s + r.v, 0),
      });
    }
  } else {
    const days = RANGES[range];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({
        label: key.slice(8),
        value: rows.filter((r) => r.created_at.slice(0, 10) === key).reduce((s, r) => s + r.v, 0),
      });
    }
  }
  return buckets;
}

function Bars({ data, tone, format }: {
  data: { label: string; value: number }[]; tone: "accent" | "accent2"; format: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  const step = data.length > 14 ? Math.ceil(data.length / 8) : 1;
  const bar = tone === "accent2" ? "bg-accent2/70" : "bg-accent/80";
  if (total === 0) {
    return <div className="flex h-20 items-center justify-center rounded-xl bg-raised/50 text-xs text-muted">0</div>;
  }
  return (
    <div className="flex h-20 items-end gap-[2px]">
      {data.map((d, i) => (
        <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${format(d.value)}`}>
          <div className={`w-full rounded-sm ${bar}`} style={{ height: `${Math.max((d.value / max) * 100, 2)}%` }} />
          <span className="h-3 truncate text-[9px] text-faint">{i % step === 0 ? d.label : ""}</span>
        </div>
      ))}
    </div>
  );
}

export default async function AdminAnalytics({ searchParams }: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeRaw } = await searchParams;
  const range = (Object.keys(RANGES).includes(rangeRaw ?? "") ? rangeRaw : "30d") as RangeKey;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dayIso = todayStart.toISOString();
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const chartSince = new Date(Date.now() - RANGES[range] * 86400000).toISOString();

  const [payAll, usageAll, profilesToday, profiles7, profiles30, jobsRange, wallets, lowWallets, recentSignups] =
    await Promise.all([
      supabase.from("payments").select("amount_cents, status, created_at, workspace_id").limit(20000),
      supabase.from("usage_events")
        .select("service_slug, model_slug, user_id, status, credits_charged, api_cost_usd_micros_snapshot, sale_value_cents_snapshot, created_at")
        .limit(20000),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", dayIso),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d7),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d30),
      supabase.from("generation_jobs").select("created_at, status").gte("created_at", chartSince).limit(20000),
      supabase.from("credit_wallets").select("balance, workspace_id"),
      supabase.from("credit_wallets").select("balance, workspaces(name)").lt("balance", 10).limit(10),
      supabase.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }).limit(8),
    ]);
  const { data: billing } = await supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle();
  const usdToPln = ((billing?.value ?? {}) as { usd_to_pln?: number }).usd_to_pln ?? 4.0;

  const pay = (payAll.data ?? []).filter((p) => SETTLED.has(p.status));
  const usage = usageAll.data ?? [];
  const charged = usage.filter((u) => u.status !== "refunded");

  const kpi = (since: string | null) => {
    const p = since ? pay.filter((r) => r.created_at >= since) : pay;
    const u = since ? charged.filter((x) => x.created_at >= since) : charged;
    const revenue = p.reduce((s, x) => s + x.amount_cents, 0);
    const apiCost = u.reduce((s, x) => s + x.api_cost_usd_micros_snapshot, 0);
    return {
      revenue, apiCost,
      creditsUsed: u.reduce((s, x) => s + x.credits_charged, 0),
      generations: u.length,
      failed: (since ? usage.filter((x) => x.created_at >= since) : usage).filter((x) => x.status === "failed" || x.status === "refunded").length,
    };
  };
  const today = kpi(dayIso), week = kpi(d7), month = kpi(d30), all = kpi(null);

  const revenueBuckets = bucketize(pay.filter((p) => p.created_at >= chartSince).map((p) => ({ created_at: p.created_at, v: p.amount_cents })), range);
  const genBuckets = bucketize((jobsRange.data ?? []).map((j) => ({ created_at: j.created_at, v: 1 })), range);

  // Per-model economics (from snapshots — history stays true even after price changes).
  const models = new Map<string, { gens: number; users: Set<string>; cost: number; revenue: number; failed: number }>();
  for (const u of usage) {
    const key = u.model_slug ?? u.service_slug;
    const m = models.get(key) ?? { gens: 0, users: new Set<string>(), cost: 0, revenue: 0, failed: 0 };
    m.gens += 1;
    if (u.user_id) m.users.add(u.user_id);
    if (u.status !== "refunded") { m.cost += u.api_cost_usd_micros_snapshot; m.revenue += u.sale_value_cents_snapshot; }
    if (u.status === "failed" || u.status === "refunded") m.failed += 1;
    models.set(key, m);
  }

  // Customer analytics
  const revByWorkspace = new Map<string, number>();
  for (const p of pay) revByWorkspace.set(p.workspace_id, (revByWorkspace.get(p.workspace_id) ?? 0) + p.amount_cents);
  const topWorkspaces = [...revByWorkspace.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const { data: topWsNames } = topWorkspaces.length
    ? await supabase.from("workspaces").select("id, name").in("id", topWorkspaces.map(([id]) => id))
    : { data: [] };
  const wsName = new Map((topWsNames ?? []).map((w) => [w.id, w.name]));

  const ranges: { key: RangeKey; label: string }[] =
    (Object.keys(RANGES) as RangeKey[]).map((k) => ({ key: k, label: k }));

  return (
    <div>
      <PageHeader title={t("analytics.title")} sub={t("analytics.sub")} />

      {[{ label: t("admin.kpiToday"), d: today }, { label: "7d", d: week }, { label: "30d", d: month }, { label: t("analytics.allTime"), d: all }].map((row) => (
        <div key={row.label} className="mb-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{row.label}</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <Stat label={t("analytics.revenue")} value={pln(row.d.revenue)} accent2 />
            <Stat label={t("analytics.apiCost")} value={usd(row.d.apiCost)} />
            <Stat label={t("analytics.grossProfit")} value={pln(Math.max(row.d.revenue, 0))} hint={`- ${usd(row.d.apiCost)} API`} />
            <Stat label={t("admin.statCreditsUsed")} value={formatCredits(row.d.creditsUsed)} />
            <Stat label={t("analytics.generations")} value={row.d.generations} hint={row.d.failed > 0 ? `${row.d.failed} ${t("analytics.failed")}` : undefined} />
          </div>
        </div>
      ))}
      {profilesToday.count != null && (
        <p className="mb-5 text-xs text-muted">
          {t("analytics.newAccounts")}: {t("admin.kpiToday").toLowerCase()} {profilesToday.count} · 7d {profiles7.count ?? 0} · 30d {profiles30.count ?? 0}
        </p>
      )}

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">{t("analytics.charts")}</p>
          <div className="flex gap-1">
            {ranges.map((r) => (
              <Link key={r.key} href={`/admin/analytics?range=${r.key}`}
                className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  r.key === range ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
                {r.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs text-muted">{t("analytics.revenue")}</p>
            <Bars data={revenueBuckets} tone="accent2" format={(v) => pln(v)} />
          </div>
          <div>
            <p className="mb-2 text-xs text-muted">{t("analytics.generations")}</p>
            <Bars data={genBuckets} tone="accent" format={(v) => String(v)} />
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 font-display text-base font-semibold">{t("analytics.modelTable")}</h2>
        <AdminTable
          headers={["Model", t("analytics.generations"), t("admin.statUsers"), "API", t("analytics.revenue"), t("analytics.profit"), t("admin.margin"), "Fail"]}
          empty={t("admin.noData")}
          rows={[...models.entries()].sort((a, b) => b[1].gens - a[1].gens).map(([slug, m]) => {
            const profitCents = m.revenue - Math.round((m.cost / 1e6) * usdToPln * 100);
            const marginPct = m.revenue > 0 ? (profitCents / m.revenue) * 100 : 0;
            return [
              <code key="m" className="text-xs">{slug}</code>,
              m.gens,
              m.users.size,
              usd(m.cost),
              pln(m.revenue),
              pln(profitCents),
              `${marginPct.toFixed(1)}%`,
              <Badge key="f" tone={m.failed > 0 ? "amber" : "green"}>{m.gens > 0 ? ((m.failed / m.gens) * 100).toFixed(1) : "0.0"}%</Badge>,
            ];
          })}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("analytics.topCustomers")} />
          {topWorkspaces.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {topWorkspaces.map(([id, cents]) => (
                <li key={id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="truncate">{wsName.get(id) ?? id.slice(0, 8)}</span>
                  <span className="font-medium text-accent2">{pln(cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("analytics.lowCredits")} />
          {(lowWallets.data ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(lowWallets.data ?? []).map((w, i) => (
                <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="truncate">{w.workspaces?.name ?? "—"}</span>
                  <Badge tone="amber">{w.balance}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("analytics.recentSignups")} />
          <ul className="divide-y divide-line">
            {(recentSignups.data ?? []).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <Link href={`/admin/users/${u.id}`} className="truncate text-accent hover:underline">
                  {u.full_name ?? u.email}
                </Link>
                <span className="shrink-0 text-xs text-muted">{formatDate(u.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="mt-4 text-xs text-faint">
        {t("analytics.honest")} · {t("analytics.wallets")}: {(wallets.data ?? []).reduce((s, w) => s + w.balance, 0)} {t("nav.credits").toLowerCase()}
      </p>
    </div>
  );
}
