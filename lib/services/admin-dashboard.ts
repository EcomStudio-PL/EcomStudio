import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/**
 * THE COMMAND CENTRE'S NUMBERS.
 *
 * The dashboard answers six questions and nothing else: how many customers are
 * there, how many arrived, how much money came in, what changed against the
 * period before, who signed up, and who paid. Everything technical — which
 * integrations are connected, whether a provider answered — moved to System,
 * because an operator opening this screen at nine in the morning is asking
 * about the business, not about Supabase.
 */

const SETTLED = new Set(["succeeded", "paid", "completed"]);

export type Delta = {
  /** Percent change against the previous window of the same length. */
  percent: number;
  direction: "up" | "down";
} | null;

/**
 * A comparison, or nothing.
 *
 * Growth from zero is not a percentage. "+∞%" and "+100%" are both lies about
 * one customer arriving in a week that had none, so when the previous window is
 * empty this returns null and the card simply shows no comparison. Same when
 * both are zero: there is no story to tell about 0 → 0.
 */
export function deltaAgainst(current: number, previous: number): Delta {
  if (previous <= 0) return null;
  if (current === previous) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return null;
  return { percent: Math.abs(percent), direction: percent > 0 ? "up" : "down" };
}

export type KpiWindow = { current: number; previous: number; delta: Delta };

const window = (current: number, previous: number): KpiWindow => ({
  current, previous, delta: deltaAgainst(current, previous),
});

export type RecentUser = {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  plan: string | null;
  verified: boolean;
};

export type RecentPayment = {
  id: string;
  amountCents: number;
  status: string;
  createdAt: string;
  customer: string;
  email: string | null;
  what: string | null;
};

export type DashboardData = {
  customers: { today: KpiWindow; week: KpiWindow; month: KpiWindow; total: number };
  revenueCents: { today: KpiWindow; week: KpiWindow; month: KpiWindow };
  /** Daily buckets for the chart, oldest first. */
  chart: { day: string; revenueCents: number; customers: number }[];
  recentUsers: RecentUser[];
  recentPayments: RecentPayment[];
};

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/**
 * One read per table, then everything counted in memory.
 *
 * The alternative — a count query per window per metric — is fourteen round
 * trips for six numbers. Both tables are read once, bounded to the longest
 * window any card needs (twice the chart's span, because every card compares
 * against the period before it).
 */
export async function readDashboard(supabase: Client, chartDays: number): Promise<DashboardData> {
  const span = Math.max(chartDays, 30);
  // Twice the span: the 30-day card needs the 30 days before it to compare.
  const since = iso(daysAgo(span * 2));
  const CAP = 20000;

  const [profilesRes, paymentsRes, totalRes, recentRes] = await Promise.all([
    supabase.from("profiles").select("created_at").gte("created_at", since).limit(CAP),
    supabase.from("payments")
      .select("id, amount_cents, status, created_at, workspace_id, provider")
      .gte("created_at", since).limit(CAP),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles")
      .select("id, full_name, email, created_at")
      .order("created_at", { ascending: false }).limit(10),
  ]);

  const profiles = profilesRes.data ?? [];
  const payments = (paymentsRes.data ?? []).filter((p) => SETTLED.has(p.status));

  const dayStart = startOfToday().getTime();
  const countBetween = (rows: { created_at: string }[], fromMs: number, toMs: number) =>
    rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromMs && t < toMs;
    }).length;
  const sumBetween = (rows: { created_at: string; amount_cents: number }[], fromMs: number, toMs: number) =>
    rows.reduce((s, r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromMs && t < toMs ? s + r.amount_cents : s;
    }, 0);

  const now = Date.now();
  const day = 86_400_000;
  const windows = {
    today: [dayStart, now] as const,
    todayPrev: [dayStart - day, dayStart] as const,
    week: [now - 7 * day, now] as const,
    weekPrev: [now - 14 * day, now - 7 * day] as const,
    month: [now - 30 * day, now] as const,
    monthPrev: [now - 60 * day, now - 30 * day] as const,
  };

  // The chart's buckets, oldest first, keyed by calendar day.
  const chart: DashboardData["chart"] = [];
  for (let i = chartDays - 1; i >= 0; i -= 1) {
    const d = new Date(now - i * day);
    const key = d.toISOString().slice(0, 10);
    chart.push({
      day: key,
      revenueCents: payments
        .filter((p) => p.created_at.slice(0, 10) === key)
        .reduce((s, p) => s + p.amount_cents, 0),
      customers: profiles.filter((p) => p.created_at.slice(0, 10) === key).length,
    });
  }

  // Names for the payment rows — one lookup, not one per row.
  const wsIds = [...new Set(payments.map((p) => p.workspace_id).filter(Boolean))].slice(0, 200);
  const { data: wsRows } = wsIds.length
    ? await supabase.from("workspaces").select("id, name, owner_id").in("id", wsIds)
    : { data: [] as { id: string; name: string; owner_id: string | null }[] };
  const wsById = new Map((wsRows ?? []).map((w) => [w.id, w]));
  const ownerIds = [...new Set((wsRows ?? []).map((w) => w.owner_id).filter(Boolean))] as string[];
  const { data: ownerRows } = ownerIds.length
    ? await supabase.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [] as { id: string; email: string }[] };
  const emailByOwner = new Map((ownerRows ?? []).map((o) => [o.id, o.email]));

  const recentPayments: RecentPayment[] = [...payments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10)
    .map((p) => {
      const ws = wsById.get(p.workspace_id);
      return {
        id: p.id,
        amountCents: p.amount_cents,
        status: p.status,
        createdAt: p.created_at,
        customer: ws?.name ?? p.workspace_id.slice(0, 8),
        email: ws?.owner_id ? emailByOwner.get(ws.owner_id) ?? null : null,
        what: p.provider ?? null,
      };
    });

  // Plans and verification for the newest ten, looked up only for those ten.
  const recent = recentRes.data ?? [];
  const recentIds = recent.map((r) => r.id);
  const [{ data: memberRows }, { data: authRows }] = await Promise.all([
    recentIds.length
      ? supabase.from("workspace_members")
          .select("user_id, workspaces(id, subscriptions(status, subscription_plans(name)))")
          .in("user_id", recentIds)
      : Promise.resolve({ data: [] as never[] }),
    // Verification lives in auth.users, which no client role may read; 0068
    // exposes it to admins only. A missing row reads as "not verified" rather
    // than breaking the dashboard.
    recentIds.length
      ? supabase.rpc("admin_user_facts", { p_ids: recentIds })
      : Promise.resolve({ data: [] as { id: string; email_confirmed_at: string | null }[] }),
  ]);
  const planByUser = new Map<string, string | null>();
  for (const row of (memberRows ?? []) as unknown as {
    user_id: string;
    workspaces: { subscriptions: { status: string; subscription_plans: { name: string } | null }[] } | null;
  }[]) {
    const active = row.workspaces?.subscriptions?.find((s) => s.status === "active");
    if (active?.subscription_plans?.name) planByUser.set(row.user_id, active.subscription_plans.name);
  }
  const verifiedById = new Map(
    ((authRows ?? []) as { id: string; email_confirmed_at: string | null }[])
      .map((r) => [r.id, r.email_confirmed_at !== null]),
  );

  return {
    customers: {
      today: window(countBetween(profiles, ...windows.today), countBetween(profiles, ...windows.todayPrev)),
      week: window(countBetween(profiles, ...windows.week), countBetween(profiles, ...windows.weekPrev)),
      month: window(countBetween(profiles, ...windows.month), countBetween(profiles, ...windows.monthPrev)),
      total: totalRes.count ?? 0,
    },
    revenueCents: {
      today: window(sumBetween(payments, ...windows.today), sumBetween(payments, ...windows.todayPrev)),
      week: window(sumBetween(payments, ...windows.week), sumBetween(payments, ...windows.weekPrev)),
      month: window(sumBetween(payments, ...windows.month), sumBetween(payments, ...windows.monthPrev)),
    },
    chart,
    recentUsers: recent.map((r) => ({
      id: r.id,
      name: r.full_name,
      email: r.email,
      createdAt: r.created_at,
      plan: planByUser.get(r.id) ?? null,
      verified: verifiedById.get(r.id) ?? false,
    })),
    recentPayments,
  };
}
