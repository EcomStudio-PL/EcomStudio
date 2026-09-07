import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { readSystemHealth } from "@/lib/services/admin-health";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { HealthGrid } from "@/components/admin/health-grid";
import { formatCredits, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * ANALITYKA — four questions, not one wall.
 *
 * This screen used to be a single scroll: five KPI rows, two charts, a model
 * table, three economics cards and three customer cards, all rendered at once
 * from two unfiltered 20 000-row reads. Nobody arrives wanting all of that.
 * They arrive with one of four questions, so the page asks which:
 *
 *   BIZNES        — are we making money
 *   UŻYCIE        — what is the product actually doing
 *   KLIENCI       — who is here and who is running dry
 *   DOSTAWCY AI   — what are the models costing and failing at
 *
 * Everything is filtered by ONE range, chosen once and carried across tabs, and
 * the heavy ledger reads are scoped to that range instead of to all of history.
 * The all-time headline numbers are still here — they just no longer require
 * dragging every usage event ever written into this function to produce them.
 */

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(cents / 100);
const usd = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;
const SETTLED = new Set(["succeeded", "paid", "completed"]);

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365 } as const;
type RangeKey = keyof typeof RANGES;
const TABS = ["business", "usage", "clients", "providers"] as const;
type TabKey = (typeof TABS)[number];

/** A row cap that exists so one pathological range cannot pull the whole
 *  ledger into memory. Reached only by a very busy 12-month window, and the
 *  page says so rather than quietly reporting a smaller number as the truth. */
const ROW_CAP = 20000;

type Window = { from: string; to: string; custom: boolean; label: string; days: number };

/**
 * What the URL asked for, clamped into something safe to query.
 *
 * A custom window needs both ends, needs them to parse, and needs them the
 * right way round; anything else falls back to the default range rather than
 * throwing a date error at an operator who mistyped one character.
 */
function resolveWindow(range: RangeKey, from?: string, to?: string): Window {
  const parsedFrom = from ? Date.parse(`${from}T00:00:00.000Z`) : NaN;
  const parsedTo = to ? Date.parse(`${to}T23:59:59.999Z`) : NaN;
  if (Number.isFinite(parsedFrom) && Number.isFinite(parsedTo) && parsedFrom < parsedTo) {
    return {
      from: new Date(parsedFrom).toISOString(),
      to: new Date(parsedTo).toISOString(),
      custom: true,
      label: `${from} — ${to}`,
      days: Math.max(1, Math.round((parsedTo - parsedFrom) / 86400000)),
    };
  }
  const days = RANGES[range];
  return {
    from: new Date(Date.now() - days * 86400000).toISOString(),
    to: new Date().toISOString(),
    custom: false,
    label: range,
    days,
  };
}

function bucketize(rows: { created_at: string; v: number }[], w: Window) {
  const buckets: { label: string; value: number }[] = [];
  const end = new Date(w.to);
  const add = (label: string, match: (iso: string) => boolean) =>
    buckets.push({ label, value: rows.filter((r) => match(r.created_at)).reduce((s, r) => s + r.v, 0) });

  if (!w.custom && w.days === 1) {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 3600000);
      const key = d.toISOString().slice(0, 13);
      add(`${d.getUTCHours()}:00`, (iso) => iso.slice(0, 13) === key);
    }
    return buckets;
  }
  // Anything longer than about four months is unreadable as daily bars, so it
  // is grouped by month — including a custom window, which is why this decides
  // on the window's own length rather than on which preset was clicked.
  if (w.days > 120) {
    const months = Math.min(24, Math.ceil(w.days / 30));
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      add(key.slice(2), (iso) => iso.slice(0, 7) === key);
    }
    return buckets;
  }
  for (let i = w.days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    add(key.slice(8), (iso) => iso.slice(0, 10) === key);
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

/** A list card that says "brak danych" rather than rendering an empty box —
 *  used by six of the panels below, which is why it is a component. */
function ListCard({ title, sub, empty, children, count }: {
  title: string; sub?: string; empty: string; count: number; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} sub={sub} />
      {count === 0
        ? <p className="px-5 py-8 text-center text-sm text-muted">{empty}</p>
        : <ul className="divide-y divide-line">{children}</ul>}
    </Card>
  );
}

export default async function AdminAnalytics({ searchParams }: {
  searchParams: Promise<{ range?: string; tab?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = (Object.keys(RANGES).includes(sp.range ?? "") ? sp.range : "30d") as RangeKey;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as TabKey) : "business";
  const w = resolveWindow(range, sp.from, sp.to);

  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  // RANGE-SCOPED, not all-of-history. The two ledger reads below used to run
  // unfiltered on every visit to every tab.
  const [payRange, usageRange, jobsRange, newAccounts, allTimePay, allTimeGens, creditsAllTime, billingRow] =
    await Promise.all([
      supabase.from("payments").select("amount_cents, status, created_at, workspace_id")
        .gte("created_at", w.from).lte("created_at", w.to).limit(ROW_CAP),
      supabase.from("usage_events")
        .select("service_slug, model_slug, user_id, workspace_id, status, credits_charged, result_count, actual_api_cost_usd_micros, api_cost_usd_micros_snapshot, sale_value_cents_snapshot, created_at")
        .gte("created_at", w.from).lte("created_at", w.to).limit(ROW_CAP),
      supabase.from("generation_jobs").select("created_at, status")
        .gte("created_at", w.from).lte("created_at", w.to).limit(ROW_CAP),
      supabase.from("profiles").select("id", { count: "exact", head: true })
        .gte("created_at", w.from).lte("created_at", w.to),
      // All-time headline figures, at their cheapest: two columns, and a count.
      supabase.from("payments").select("amount_cents, status").limit(ROW_CAP),
      supabase.from("usage_events").select("id", { count: "exact", head: true }),
      supabase.rpc("generation_credits_total"),
      supabase.from("app_settings").select("value").eq("key", "billing").maybeSingle(),
    ]);

  const usdToPln = ((billingRow.data?.value ?? {}) as { usd_to_pln?: number }).usd_to_pln ?? 4.0;
  const toCents = (micros: number) => Math.round((micros / 1e6) * usdToPln * 100);

  const pay = (payRange.data ?? []).filter((p) => SETTLED.has(p.status));
  const usage = usageRange.data ?? [];
  const charged = usage.filter((u) => u.status !== "refunded");
  const capped = usage.length >= ROW_CAP || (payRange.data ?? []).length >= ROW_CAP;

  const revenue = pay.reduce((s, x) => s + x.amount_cents, 0);
  // Real recorded provider cost wins; the catalog snapshot only fills in for
  // events written before per-call costs were captured.
  const apiCost = charged.reduce((s, x) => s + (x.actual_api_cost_usd_micros || x.api_cost_usd_micros_snapshot), 0);
  const succeeded = charged.filter((x) => x.status === "succeeded");
  const payers = new Set(pay.map((x) => x.workspace_id)).size;
  const failed = usage.filter((x) => x.status === "failed" || x.status === "refunded").length;
  const k = {
    revenue,
    apiCost,
    contribution: revenue - toCents(apiCost),
    margin: revenue > 0 ? Math.round(((revenue - toCents(apiCost)) / revenue) * 1000) / 10 : 0,
    creditsUsed: charged.reduce((s, x) => s + x.credits_charged, 0),
    generations: charged.length,
    succeeded: succeeded.length,
    outputs: succeeded.reduce((s, x) => s + (x.result_count ?? 0), 0),
    avgCostPerGen: charged.length > 0 ? Math.round(apiCost / charged.length) : 0,
    avgRevenuePerPayer: payers > 0 ? Math.round(revenue / payers) : 0,
    failed,
  };
  const allTimeRevenue = (allTimePay.data ?? [])
    .filter((p) => SETTLED.has(p.status)).reduce((s, p) => s + p.amount_cents, 0);

  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { tab, range, from: sp.from, to: sp.to, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    return `/admin/analytics?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader overline={t("admin.navGroups.overview")} title={t("analytics.title")} sub={t("analytics.sub")} />

      {/* ONE RANGE, CARRIED ACROSS TABS. Switching question does not reset the
          window an operator just chose. */}
      <div className="mb-5 flex flex-col gap-3">
        <nav aria-label={t("analytics.title")} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((key) => (
            <Link key={key} href={qs({ tab: key })} aria-current={key === tab ? "page" : undefined}
              className={cn("inline-flex h-10 shrink-0 items-center rounded-xl px-3.5 text-[13px] font-semibold transition-colors",
                key === tab
                  ? "bg-accent2-soft text-accent2 ring-1 ring-[rgb(var(--accent2)/0.30)]"
                  : "text-muted hover:bg-raised hover:text-ink")}>
              {t(`analytics.tab.${key}`)}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <Link key={key} href={qs({ range: key, from: undefined, to: undefined })}
              className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                !w.custom && key === range ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
              {key}
            </Link>
          ))}
          {/* Custom is a GET form, so the window survives a reload and can be
              pasted to somebody else — no client state, no hydration. */}
          <form action="/admin/analytics" className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="tab" value={tab} />
            <label className="sr-only" htmlFor="range-from">{t("analytics.from")}</label>
            <input id="range-from" type="date" name="from" defaultValue={sp.from ?? ""}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink" />
            <label className="sr-only" htmlFor="range-to">{t("analytics.to")}</label>
            <input id="range-to" type="date" name="to" defaultValue={sp.to ?? ""}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink" />
            <button type="submit"
              className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                w.custom ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised")}>
              {t("analytics.custom")}
            </button>
          </form>
        </div>
        <p className="text-[11px] text-faint">
          {t("analytics.showing", { range: w.label })}
          {capped ? ` · ${t("analytics.capped", { n: ROW_CAP })}` : ""}
        </p>
      </div>

      {tab === "business" && (
        <BusinessTab {...{ k, w, pay, t, pln, usd, allTimeRevenue, usage: charged, toCents, locale, supabase }} />
      )}
      {tab === "usage" && (
        <UsageTab {...{ k, w, jobs: jobsRange.data ?? [], allTimeGens: allTimeGens.count ?? 0,
          creditsAllTime: Number(creditsAllTime.data ?? 0), t }} />
      )}
      {tab === "clients" && <ClientsTab {...{ w, newAccounts: newAccounts.count ?? 0, pay, t, locale, supabase }} />}
      {tab === "providers" && <ProvidersTab {...{ usage, toCents, t, supabase }} />}

      <p className="mt-4 text-xs text-faint">{t("analytics.honest")}</p>
    </div>
  );
}

/* ── BIZNES ─────────────────────────────────────────────────────────────── */

type T = (key: string, vars?: Record<string, string | number>) => string;
type Client = Awaited<ReturnType<typeof createClient>>;
type Usage = {
  workspace_id: string | null; model_slug: string | null; service_slug: string;
  user_id: string | null; status: string; result_count: number | null;
  actual_api_cost_usd_micros: number; api_cost_usd_micros_snapshot: number;
  sale_value_cents_snapshot: number; created_at: string; credits_charged: number;
};
type Pay = { amount_cents: number; status: string; created_at: string; workspace_id: string };

async function BusinessTab({ k, w, pay, t, allTimeRevenue, usage, toCents, supabase }: {
  k: Record<string, number>; w: Window; pay: Pay[]; t: T; allTimeRevenue: number;
  usage: Usage[]; toCents: (m: number) => number; locale: string; supabase: Client;
}) {
  // Per-customer economics, over the chosen window: what they paid against what
  // their generations actually cost us.
  const revByWs = new Map<string, number>();
  for (const p of pay) revByWs.set(p.workspace_id, (revByWs.get(p.workspace_id) ?? 0) + p.amount_cents);
  const costByWs = new Map<string, number>();
  for (const u of usage) {
    if (!u.workspace_id) continue;
    costByWs.set(u.workspace_id, (costByWs.get(u.workspace_id) ?? 0)
      + (u.actual_api_cost_usd_micros || u.api_cost_usd_micros_snapshot));
  }
  const ids = [...new Set([...revByWs.keys(), ...costByWs.keys()])];
  const { data: wsRows } = ids.length
    ? await supabase.from("workspaces").select("id, name").in("id", ids.slice(0, 200))
    : { data: [] };
  const names = new Map((wsRows ?? []).map((row) => [row.id, row.name]));
  const rows = ids.map((id) => {
    const revenue = revByWs.get(id) ?? 0;
    const costMicros = costByWs.get(id) ?? 0;
    const contribution = revenue - toCents(costMicros);
    return {
      id, name: names.get(id) ?? id.slice(0, 8), revenue, costMicros, contribution,
      margin: revenue > 0 ? Math.round((contribution / revenue) * 1000) / 10 : null,
    };
  });
  const profitable = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 5);
  const thinnest = rows.filter((r) => r.margin !== null && r.costMicros > 0)
    .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0)).slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat label={t("analytics.revenue")} value={pln(k.revenue)} tone="accent2"
          hint={t("analytics.allTime") + ": " + pln(allTimeRevenue)} />
        <Stat label={t("analytics.apiCost")} value={usd(k.apiCost)} hint={t("econ.perGen", { v: usd(k.avgCostPerGen) })} />
        <Stat label={t("econ.contribution")} value={pln(k.contribution)} hint={k.revenue > 0 ? `${k.margin}%` : undefined} />
        <Stat label={t("econ.arpu")} value={pln(k.avgRevenuePerPayer)} />
        <Stat label={t("analytics.generations")} value={k.generations}
          hint={`${k.outputs} ${t("econ.outputs").toLowerCase()}`} />
      </div>

      <Card className="p-5">
        <p className="mb-2 text-xs text-muted">{t("analytics.revenue")}</p>
        <Bars data={bucketize(pay.map((p) => ({ created_at: p.created_at, v: p.amount_cents })), w)}
          tone="accent2" format={(v) => pln(v)} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard title={t("econ.mostProfitable")} sub={t("econ.mostProfitableSub")}
          empty={t("admin.noData")} count={profitable.length}>
          {profitable.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span className="truncate">{r.name}</span>
              <span className="shrink-0 tabular-nums font-medium text-accent">{pln(r.contribution)}</span>
            </li>
          ))}
        </ListCard>
        <ListCard title={t("econ.lowestMargin")} sub={t("econ.lowestMarginSub")}
          empty={t("admin.noData")} count={thinnest.length}>
          {thinnest.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span className="truncate">{r.name}</span>
              <Badge tone={(r.margin ?? 0) < 30 ? "danger" : "accent"}>{r.margin}%</Badge>
            </li>
          ))}
        </ListCard>
      </div>
    </div>
  );
}

/* ── UŻYCIE ─────────────────────────────────────────────────────────────── */

function UsageTab({ k, w, jobs, allTimeGens, creditsAllTime, t }: {
  k: Record<string, number>; w: Window; jobs: { created_at: string; status: string }[];
  allTimeGens: number; creditsAllTime: number; t: T;
}) {
  const failRate = k.generations > 0 ? ((k.failed / k.generations) * 100).toFixed(1) : "0.0";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat label={t("analytics.generations")} value={k.generations}
          hint={t("analytics.allTime") + ": " + allTimeGens} />
        <Stat label={t("econ.outputs")} value={k.outputs} />
        <Stat label={t("admin.statCreditsUsed")} value={formatCredits(k.creditsUsed)}
          hint={t("analytics.allTime") + ": " + formatCredits(creditsAllTime)} />
        <Stat label={t("analytics.failed")} value={k.failed}
          tone={k.failed > 0 ? "accent" : "default"} hint={`${failRate}%`} />
        <Stat label={t("analytics.succeeded")} value={k.succeeded} tone="success" />
      </div>

      <Card className="p-5">
        <p className="mb-2 text-xs text-muted">{t("analytics.generations")}</p>
        <Bars data={bucketize(jobs.map((j) => ({ created_at: j.created_at, v: 1 })), w)}
          tone="accent" format={(v) => String(v)} />
      </Card>
    </div>
  );
}

/* ── KLIENCI ────────────────────────────────────────────────────────────── */

async function ClientsTab({ w, newAccounts, pay, t, locale, supabase }: {
  w: Window; newAccounts: number; pay: Pay[]; t: T; locale: string; supabase: Client;
}) {
  const revByWs = new Map<string, number>();
  for (const p of pay) revByWs.set(p.workspace_id, (revByWs.get(p.workspace_id) ?? 0) + p.amount_cents);
  const top = [...revByWs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const [topNames, lowWallets, signups, wallets] = await Promise.all([
    top.length
      ? supabase.from("workspaces").select("id, name").in("id", top.map(([id]) => id))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("credit_wallets").select("balance, workspaces(name)").lt("balance", 10).limit(10),
    supabase.from("profiles").select("id, email, full_name, created_at")
      .gte("created_at", w.from).lte("created_at", w.to)
      .order("created_at", { ascending: false }).limit(8),
    supabase.from("credit_wallets").select("balance"),
  ]);
  const names = new Map((topNames.data ?? []).map((row) => [row.id, row.name]));
  const outstanding = (wallets.data ?? []).reduce((s, row) => s + row.balance, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("analytics.newAccounts")} value={newAccounts} />
        <Stat label={t("analytics.payingCustomers")} value={revByWs.size} tone="accent2" />
        <Stat label={t("analytics.lowCredits")} value={(lowWallets.data ?? []).length} />
        <Stat label={t("analytics.wallets")} value={formatCredits(outstanding)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard title={t("analytics.topCustomers")} empty={t("admin.noData")} count={top.length}>
          {top.map(([id, cents]) => (
            <li key={id} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="truncate">{names.get(id) ?? id.slice(0, 8)}</span>
              <span className="font-medium text-accent2">{pln(cents)}</span>
            </li>
          ))}
        </ListCard>
        <ListCard title={t("analytics.lowCredits")} empty={t("admin.noData")} count={(lowWallets.data ?? []).length}>
          {(lowWallets.data ?? []).map((row, i) => (
            <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="truncate">{row.workspaces?.name ?? "—"}</span>
              <Badge tone="accent">{row.balance}</Badge>
            </li>
          ))}
        </ListCard>
        <ListCard title={t("analytics.recentSignups")} empty={t("admin.noData")} count={(signups.data ?? []).length}>
          {(signups.data ?? []).map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <Link href={`/admin/users/${u.id}`} className="truncate text-accent hover:opacity-75">
                {u.full_name ?? u.email}
              </Link>
              <span className="shrink-0 text-xs text-muted">{formatDate(u.created_at, locale)}</span>
            </li>
          ))}
        </ListCard>
      </div>
    </div>
  );
}

/* ── DOSTAWCY AI ────────────────────────────────────────────────────────── */

async function ProvidersTab({ usage, toCents, t, supabase }: {
  usage: Usage[]; toCents: (m: number) => number; t: T; supabase: Client;
}) {
  const models = new Map<string, { gens: number; users: Set<string>; cost: number; revenue: number; failed: number }>();
  for (const u of usage) {
    const key = u.model_slug ?? u.service_slug;
    const m = models.get(key) ?? { gens: 0, users: new Set<string>(), cost: 0, revenue: 0, failed: 0 };
    m.gens += 1;
    if (u.user_id) m.users.add(u.user_id);
    if (u.status !== "refunded") {
      m.cost += u.actual_api_cost_usd_micros || u.api_cost_usd_micros_snapshot;
      m.revenue += u.sale_value_cents_snapshot;
    }
    if (u.status === "failed" || u.status === "refunded") m.failed += 1;
    models.set(key, m);
  }
  const health = (await readSystemHealth(supabase)).filter((c) => c.key.startsWith("provider:"));

  return (
    <div className="space-y-5">
      {/* Connection state, from the last real test — never from the `active`
          checkbox, which says what an admin intended, not what works. */}
      <Card>
        <CardHeader title={t("admin.nav.providers")} sub={t("health.verifiedOnly")} />
        <div className="p-5 pt-0">
          {health.length === 0
            ? <p className="text-sm text-muted">{t("admin.noData")}</p>
            : <HealthGrid checks={health} labels={{
                ok: t("health.connected"), fail: t("health.error"),
                unknown: t("health.unverified"), never: t("health.neverChecked"),
              }} />}
        </div>
      </Card>

      <div>
        <h2 className="mb-3 font-display text-base font-semibold">{t("analytics.modelTable")}</h2>
        <AdminTable
          headers={["Model", t("analytics.generations"), t("admin.statUsers"), "API",
            t("analytics.revenue"), t("analytics.profit"), t("admin.margin"), "Fail"]}
          empty={t("admin.noData")}
          rows={[...models.entries()].sort((a, b) => b[1].gens - a[1].gens).map(([slug, m]) => {
            const profitCents = m.revenue - toCents(m.cost);
            const marginPct = m.revenue > 0 ? (profitCents / m.revenue) * 100 : 0;
            return [
              <code key="m" className="text-xs">{slug}</code>,
              m.gens,
              m.users.size,
              usd(m.cost),
              pln(m.revenue),
              pln(profitCents),
              `${marginPct.toFixed(1)}%`,
              <Badge key="f" tone={m.failed > 0 ? "danger" : "success"}>
                {m.gens > 0 ? ((m.failed / m.gens) * 100).toFixed(1) : "0.0"}%
              </Badge>,
            ];
          })}
        />
      </div>
    </div>
  );
}
