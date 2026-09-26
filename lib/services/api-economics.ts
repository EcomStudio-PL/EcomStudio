import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { billingFrom } from "@/lib/images/pricing";
import {
  aggregate, eventCost, eventRevenue, eventTool, keptCents, margin, sumCosts, warsawDayStart,
  SETTLED_PAYMENT, type Aggregate, type CallRow, type CostBasis, type EventRow, type Revenue,
  type RunLine, type WorkspaceMoney,
} from "@/lib/api-economics";

type Client = SupabaseClient<Database>;

/**
 * ADMIN ECONOMICS READS — usage_events (the customer ledger) joined with
 * ai_provider_calls (the provider side, 0127), payments and grants for the
 * proportional revenue rate. Admin RLS on every table read here; the numbers
 * never leave the admin panel. Rules live in lib/api-economics.ts.
 */

const PAGE = 1000;
const MAX_ROWS = 20_000;

const EVENT_COLUMNS = "id, created_at, workspace_id, user_id, service_slug, provider_slug, model_slug, status, credits_charged, result_count, actual_api_cost_usd_micros, api_cost_usd_micros_snapshot, metadata";
const CALL_COLUMNS = "id, created_at, actor_kind, consumer, tool_key, usage_event_id, provider_slug, model, status, request_count, input_tokens, output_tokens, units, unit_kind, cost_usd_micros, cost_basis, duration_ms";

/** Page through a query so PostgREST's row cap never truncates silently. */
async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: rows.length >= MAX_ROWS };
}

async function readEvents(db: Client, since: Date): Promise<{ rows: EventRow[]; truncated: boolean }> {
  return pages<EventRow>((from, to) => db.from("usage_events").select(EVENT_COLUMNS)
    .gte("created_at", since.toISOString()).order("created_at", { ascending: false }).range(from, to)
    .then((r) => ({ data: r.data as EventRow[] | null, error: r.error })));
}

async function readCalls(db: Client, since: Date): Promise<{ rows: CallRow[]; truncated: boolean }> {
  return pages<CallRow>((from, to) => db.from("ai_provider_calls").select(CALL_COLUMNS)
    .gte("created_at", since.toISOString()).order("created_at", { ascending: false }).range(from, to)
    .then((r) => ({ data: r.data as CallRow[] | null, error: r.error })));
}

/** Money paid and credits granted, per workspace, lifetime. */
export async function readWorkspaceMoney(db: Client, workspaceIds: readonly string[]): Promise<Map<string, WorkspaceMoney>> {
  const out = new Map<string, WorkspaceMoney>();
  const ids = [...new Set(workspaceIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [{ data: payments }, { data: wallets }] = await Promise.all([
      db.from("payments").select("workspace_id, amount_cents, status, currency, metadata")
        .in("workspace_id", chunk).in("status", [...SETTLED_PAYMENT]).limit(PAGE),
      db.from("credit_wallets").select("id, workspace_id").in("workspace_id", chunk),
    ]);
    for (const w of chunk) out.set(w, { paidCents: 0, grantedCredits: 0 });
    for (const p of payments ?? []) {
      // PLN only: the proportional rate is a PLN rate. Another currency is not
      // converted with a guessed rate — it is simply not attributed.
      if ((p.currency ?? "PLN").toUpperCase() !== "PLN") continue;
      out.get(p.workspace_id)!.paidCents += keptCents(p);
    }
    const walletToWs = new Map((wallets ?? []).map((w) => [w.id, w.workspace_id]));
    const walletIds = [...walletToWs.keys()];
    for (let j = 0; j < walletIds.length; j += 100) {
      const { rows } = await pages<{ wallet_id: string; amount: number; type: string }>((from, to) =>
        db.from("credit_transactions").select("wallet_id, amount, type")
          .in("wallet_id", walletIds.slice(j, j + 100)).gt("amount", 0).neq("type", "refund").range(from, to)
          .then((r) => ({ data: r.data, error: r.error })));
      for (const t of rows) {
        const ws = walletToWs.get(t.wallet_id);
        if (ws) out.get(ws)!.grantedCredits += t.amount;
      }
    }
  }
  return out;
}

async function toolMaps(db: Client): Promise<{ serviceToTool: Map<string, string>; toolKeys: Set<string> }> {
  const { data } = await db.from("ai_tools").select("tool_key, service_slug");
  const serviceToTool = new Map<string, string>();
  const toolKeys = new Set<string>();
  for (const r of data ?? []) {
    toolKeys.add(r.tool_key);
    // image_generation / image_edit are shared by several tools — resolved
    // from the event itself, never from this map.
    if (r.service_slug && r.service_slug !== "image_generation" && r.service_slug !== "image_edit") {
      serviceToTool.set(r.service_slug, r.tool_key);
    }
  }
  return { serviceToTool, toolKeys };
}

async function usdToPln(db: Client): Promise<number> {
  const { data } = await db.from("app_settings").select("value").eq("key", "billing").maybeSingle();
  return billingFrom(data?.value).usdToPln;
}

type Lines = {
  lines: (RunLine & { toolKey: string })[];
  /** Provider calls with no customer run behind them (GrovNews, admin tests,
   *  analysis not tied to a charge). */
  system: CallRow[];
  truncated: boolean;
  usdToPln: number;
};

async function buildLines(db: Client, since: Date): Promise<Lines> {
  const [events, calls, maps, rate] = await Promise.all([
    readEvents(db, since), readCalls(db, since), toolMaps(db), usdToPln(db),
  ]);
  const callsByEvent = new Map<string, CallRow[]>();
  const system: CallRow[] = [];
  for (const c of calls.rows) {
    if (c.usage_event_id) {
      const list = callsByEvent.get(c.usage_event_id) ?? [];
      list.push(c); callsByEvent.set(c.usage_event_id, list);
    } else system.push(c);
  }
  const money = await readWorkspaceMoney(db, events.rows.map((e) => e.workspace_id));
  const lines = events.rows.map((e) => {
    const own = callsByEvent.get(e.id) ?? [];
    return {
      event: e, calls: own,
      revenue: eventRevenue(e, money.get(e.workspace_id)),
      cost: eventCost(e, own),
      toolKey: eventTool(e, own, maps.serviceToTool, maps.toolKeys),
    };
  });
  return { lines, system, truncated: events.truncated || calls.truncated, usdToPln: rate };
}

/* ── Usage history ────────────────────────────────────────────────────────*/

export type HistoryRow = {
  id: string;
  at: string;
  kind: "run" | "system";
  toolKey: string | null;
  consumer: string | null;
  provider: string | null;
  model: string | null;
  requests: number;
  status: string;
  credits: number;
  costUsdMicros: number | null;
  costBasis: CostBasis;
  revenue: Revenue;
  marginCents: number | null;
  marginPercent: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  units: number | null;
  unitKind: string | null;
};

export type HistoryFilter = { toolKey?: string | null; provider?: string | null; days?: number; limit?: number };

export async function readUsageHistory(db: Client, filter: HistoryFilter = {}): Promise<{ rows: HistoryRow[]; truncated: boolean; usdToPln: number }> {
  const days = Math.min(90, Math.max(1, filter.days ?? 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const { lines, system, truncated, usdToPln: rate } = await buildLines(db, since);

  const runRows: HistoryRow[] = lines.map((l) => {
    const served = l.calls.find((c) => c.status === "succeeded") ?? l.calls[0];
    const m = margin(l.revenue, l.cost, rate);
    const tokensIn = l.calls.reduce((s, c) => s + (c.input_tokens ?? 0), 0);
    const tokensOut = l.calls.reduce((s, c) => s + (c.output_tokens ?? 0), 0);
    const hasTokens = l.calls.some((c) => c.input_tokens != null || c.output_tokens != null);
    const units = l.calls.reduce((s, c) => s + Number(c.units ?? 0), 0);
    return {
      id: l.event.id, at: l.event.created_at, kind: "run",
      toolKey: l.toolKey, consumer: served?.consumer ?? null,
      provider: served?.provider_slug ?? l.event.provider_slug,
      model: served?.model ?? l.event.model_slug,
      requests: l.calls.length ? l.calls.reduce((s, c) => s + c.request_count, 0) : 1,
      status: l.event.status, credits: l.revenue.kind === "refunded" ? 0 : l.event.credits_charged,
      costUsdMicros: l.cost.usdMicros, costBasis: l.cost.basis, revenue: l.revenue,
      marginCents: m.cents, marginPercent: m.percent,
      inputTokens: hasTokens ? tokensIn : null, outputTokens: hasTokens ? tokensOut : null,
      units: l.calls.some((c) => c.units != null) ? units : null,
      unitKind: l.calls.find((c) => c.unit_kind)?.unit_kind ?? null,
    };
  });
  const sysRows: HistoryRow[] = system.map((c) => ({
    id: c.id, at: c.created_at, kind: "system",
    toolKey: c.tool_key, consumer: c.consumer, provider: c.provider_slug, model: c.model,
    requests: c.request_count, status: c.status, credits: 0,
    costUsdMicros: c.cost_usd_micros, costBasis: c.cost_basis === "actual" || c.cost_basis === "estimated" ? c.cost_basis : "unknown",
    revenue: { kind: "system", cents: 0 }, marginCents: null, marginPercent: null,
    inputTokens: c.input_tokens, outputTokens: c.output_tokens, units: c.units, unitKind: c.unit_kind,
  }));

  let rows = [...runRows, ...sysRows].sort((a, b) => b.at.localeCompare(a.at));
  if (filter.toolKey) rows = rows.filter((r) => r.toolKey === filter.toolKey || (filter.toolKey === "grovnews" && r.consumer === "grovnews"));
  if (filter.provider) rows = rows.filter((r) => r.provider === filter.provider);
  return { rows: rows.slice(0, Math.min(500, filter.limit ?? 200)), truncated, usdToPln: rate };
}

/* ── Per-tool economics: today and 30 days ────────────────────────────────*/

export type ToolEconomics = { toolKey: string; today: Aggregate; days30: Aggregate };

export async function readToolEconomics(db: Client, now: Date = new Date()): Promise<{ tools: ToolEconomics[]; truncated: boolean; usdToPln: number; todayStart: string }> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const todayStart = warsawDayStart(now);
  const { lines, truncated, usdToPln: rate } = await buildLines(db, since);
  const byTool = new Map<string, RunLine[]>();
  const todayByTool = new Map<string, RunLine[]>();
  for (const l of lines) {
    const all = byTool.get(l.toolKey) ?? []; all.push(l); byTool.set(l.toolKey, all);
    if (new Date(l.event.created_at) >= todayStart) {
      const t = todayByTool.get(l.toolKey) ?? []; t.push(l); todayByTool.set(l.toolKey, t);
    }
  }
  const tools = [...byTool.keys()].sort().map((toolKey) => ({
    toolKey,
    today: aggregate(todayByTool.get(toolKey) ?? [], rate),
    days30: aggregate(byTool.get(toolKey) ?? [], rate),
  }));
  return { tools, truncated, usdToPln: rate, todayStart: todayStart.toISOString() };
}

/** One tool, for the tool's own Ekonomia tab. */
export async function readOneToolEconomics(db: Client, toolKey: string, now: Date = new Date()): Promise<{ today: Aggregate; days30: Aggregate; usdToPln: number; truncated: boolean }> {
  const all = await readToolEconomics(db, now);
  const found = all.tools.find((t) => t.toolKey === toolKey);
  const empty = aggregate([], all.usdToPln);
  return { today: found?.today ?? empty, days30: found?.days30 ?? empty, usdToPln: all.usdToPln, truncated: all.truncated };
}

/* ── GrovNews ─────────────────────────────────────────────────────────────*/

export type GrovNewsWindow = { aiCostUsdMicros: number; aiCalls: number; unknownCostCalls: number };

export type GrovNewsEconomics = {
  today: GrovNewsWindow;
  days30: GrovNewsWindow;
  editions30: number;
  activePaid: number;
  /** Monthly recurring revenue from live paid subscriptions, at each
   *  subscriber's own price. */
  mrrCents: number;
  /** Money actually received from GrovNews invoices in the last 30 days. */
  revenue30Cents: number;
  currency: string;
  promoActive: number;
  launchActive: number;
  adminGrants: number;
  /** revenue30 − AI cost 30d (PLN cents). Null when the AI cost is unknown. */
  margin30Cents: number | null;
  /** The AI cost is usage × price list, so the margin is always estimated. */
  marginNote: "estimated";
};

function windowOf(calls: readonly CallRow[]): GrovNewsWindow {
  const s = sumCosts(calls.map((c) => ({ usdMicros: c.cost_usd_micros, basis: c.cost_basis === "actual" || c.cost_basis === "estimated" ? c.cost_basis : "unknown" })));
  return { aiCostUsdMicros: s.usdMicros, aiCalls: calls.reduce((n, c) => n + c.request_count, 0), unknownCostCalls: s.unknown };
}

export async function grovnewsEconomics(db: Client, now: Date = new Date()): Promise<GrovNewsEconomics> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const todayStart = warsawDayStart(now);
  const nowIso = now.toISOString();
  const [calls, editions, subs, invoices, grants, rate] = await Promise.all([
    pages<CallRow>((from, to) => db.from("ai_provider_calls").select(CALL_COLUMNS)
      .eq("consumer", "grovnews").gte("created_at", since.toISOString()).range(from, to)
      .then((r) => ({ data: r.data as CallRow[] | null, error: r.error }))),
    db.from("grovnews_editions").select("id", { count: "exact", head: true })
      .in("status", ["PUBLISHED", "QUEUED", "SENT"]).gte("edition_date", since.toISOString().slice(0, 10)),
    db.from("grovnews_subscriptions").select("status, unit_amount_cents, currency, paid_through")
      .gt("paid_through", nowIso).limit(PAGE),
    db.from("grovnews_invoices").select("amount_paid_cents, currency, paid_at")
      .gte("paid_at", since.toISOString()).limit(PAGE),
    db.from("grovnews_entitlements").select("source, status, starts_at, expires_at")
      .eq("status", "ACTIVE").lte("starts_at", nowIso).limit(PAGE),
    usdToPln(db),
  ]);
  const all = calls.rows;
  const todayCalls = all.filter((c) => new Date(c.created_at) >= todayStart);
  const live = (subs.data ?? []).filter((s) => ["active", "trialing", "past_due"].includes(s.status));
  const mrrCents = live.reduce((n, s) => n + (s.unit_amount_cents ?? 0), 0);
  const revenue30Cents = (invoices.data ?? []).reduce((n, i) => n + (i.amount_paid_cents ?? 0), 0);
  const activeGrants = (grants.data ?? []).filter((g) => !g.expires_at || g.expires_at > nowIso);
  const days30 = windowOf(all);
  const aiCostCents = Math.round((days30.aiCostUsdMicros / 1_000_000) * rate * 100);
  return {
    today: windowOf(todayCalls),
    days30,
    editions30: editions.count ?? 0,
    activePaid: live.length,
    mrrCents,
    revenue30Cents,
    currency: (live[0]?.currency ?? "PLN").toUpperCase(),
    promoActive: activeGrants.filter((g) => g.source === "PROMO").length,
    launchActive: activeGrants.filter((g) => g.source === "LAUNCH_BONUS").length,
    adminGrants: activeGrants.filter((g) => g.source === "ADMIN_GRANT").length,
    margin30Cents: days30.unknownCostCalls > 0 && days30.aiCostUsdMicros === 0 && days30.aiCalls > 0 ? null : revenue30Cents - aiCostCents,
    marginNote: "estimated",
  };
}
