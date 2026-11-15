/**
 * API RESERVE CENTER — THE MODEL (pure: no database, no network, no clock of
 * its own). Input: one `api_reserve_snapshot()` (0180). Output: what every
 * provider holds, what customers can still spend, and how much money must be
 * kept ready for it — the panel, the reports and the alerts all read THIS.
 *
 * Rules that make the numbers honest:
 *   · Spend is ai_provider_calls only (one row per request actually sent,
 *     failed paid attempts and fallbacks included). A call whose cost is
 *     unknown is COUNTED as unknown, never priced at 0.
 *   · A value the system cannot know is `null` with basis "unavailable" —
 *     never 0. Every money value carries its basis: confirmed (the provider's
 *     API said so), manual (an admin entered it), estimated (derived).
 *   · One credit is NOT one generation nor a fixed dollar amount: the cost of a
 *     credit comes from history (customer provider spend ÷ customer credits
 *     used) when there is enough of it, else from the configured models' real
 *     unit prices ÷ their credit prices — with the assumption stated.
 *   · The provider split comes from the same model (each provider's cost per
 *     credit), never from fixed percentages, and the total is computed once.
 *   · Admin / internal / system spend is reported apart from customers' and
 *     reserved for at its own running rate.
 */

export type SpendClass = "customer" | "internal" | "system";

export type SpendRow = {
  provider_slug: string;
  cls: SpendClass;
  h1: number; today: number; d1: number; d7: number; d30: number; month: number; hist: number;
  calls_h1: number; calls_today: number; calls_d1: number; calls_month: number; calls_d30: number;
  unknown_h1: number; unknown_today: number; unknown_month: number; unknown_d30: number;
  failed_paid_month: number;
};

export type Pools = {
  subscription: number; topup: number; bonus: number; legacy: number;
  expiring_24h: number; expiring_7d: number; expiring_horizon: number;
};
export type TrancheTotals = { total: number; within_24h: number; within_7d: number; within_horizon: number };
export type CreditsMonth = {
  granted_subscription: number; granted_topup: number; granted_bonus: number; used: number; expired: number;
  used_d1: number; used_today: number; used_d7: number; used_d30: number; used_hist: number; granted_today: number;
};
export type FundMode = "auto" | "manual" | "postpaid" | "off";

export type ProviderFacts = {
  id: string; slug: string; name: string; active: boolean; has_key: boolean;
  mode: FundMode; balance: number | null; basis: "confirmed" | "manual" | null; balance_at: string | null;
  credit_limit: number | null; warn: number; critical: number; billing_url: string | null;
  last_sync_at: string | null; last_sync_status: string | null; last_sync_error: string | null;
  spend_since_balance: number | null; unknown_since_balance: number | null; adjust_since_balance: number | null;
  events: { kind: string; amount: number | null; balance: number | null; note: string | null; at: string }[];
};

export type ModelFacts = { provider: string; model: string; name: string; pricing: unknown; credit_cost: number | null; customer: boolean };
export type UnitPriceFacts = { provider: string; model: string; unit_kind: string; resolution: string | null; quality: string | null; usd_micros: number };

export type ReserveSettings = {
  enabled: boolean; buffer_percent: number; horizon_days: number; scenario: "standard" | "cautious";
  cautious_factor: number; history_days: number; min_history_credits: number;
  daily_report_hour: number; report_timezone: string; hourly_skip_empty: boolean; alert_repeat_hours: number;
};

export type SalesWindow = { count: number; new?: number; renewals?: number; changes?: number; topups?: number; revenue: Record<string, number> };

export type ReserveSnapshot = {
  now: string; today_start: string; month_start: string; history_start: string;
  settings: ReserveSettings;
  spend: SpendRow[];
  pools: Partial<Record<"customer" | "internal", Pools>> | null;
  tranches: Partial<Record<"customer" | "internal", TrancheTotals>> | null;
  credits_month: Partial<Record<"customer" | "internal", CreditsMonth>> | null;
  expired_history: { lots: number; granted: number; unused: number };
  sales: { h1: SalesWindow; today: SalesWindow; month: SalesWindow };
  providers: ProviderFacts[];
  models: ModelFacts[];
  unit_prices: UnitPriceFacts[];
};

export type Basis = "confirmed" | "estimated" | "manual" | "unavailable";
export type Money = { micros: number | null; basis: Basis };
export type ProviderStatus = "ok" | "warning" | "critical" | "no_data" | "off";
export type Scenario = { standard: number; cautious: number };

export type ProviderReserve = {
  id: string; slug: string; name: string; active: boolean; mode: FundMode; billingUrl: string | null;
  /** The admin's thresholds and (postpaid) credit limit, as stored. */
  warnMicros: number; criticalMicros: number; creditLimitMicros: number | null;
  available: Money;
  /** Postpaid with a credit limit: what is left of it this month (estimated). */
  limitLeft: Money | null;
  spend: { h1: number; today: number; d1: number; d7: number; month: number; callsH1: number; callsToday: number; callsMonth: number; unknownMonth: number; share: number | null };
  costPerCredit: Scenario | null;
  need: { h24: Scenario; d7: Scenario; horizon: Scenario };
  reserve: number;
  /** Prepaid: what to add so the balance covers the reserve (null when the balance is unknown). */
  topup: number | null;
  /** Postpaid: what to set aside — this month's unbilled spend plus the reserve. */
  secure: number | null;
  runwayHours: number | null;
  status: ProviderStatus;
  lastSyncAt: string | null; syncStatus: string | null; syncError: string | null;
  unknownSinceBalance: number;
  events: ProviderFacts["events"];
};

export type ReserveReport = {
  settings: ReserveSettings;
  generatedAt: string;
  spend: Record<SpendClass | "total", { h1: number; today: number; d1: number; d7: number; d30: number; month: number }>;
  unknownCalls: { h1: number; today: number; month: number };
  credits: {
    customer: Pools & { total: number; tranches: TrancheTotals };
    internal: Pools & { total: number; tranches: TrancheTotals };
    month: CreditsMonth;
  };
  costPerCredit: { standard: number | null; cautious: number | null; source: "history" | "config" | "none"; utilization: number };
  exposure: Scenario | null;
  need: { h24: Scenario; d7: Scenario; horizon: Scenario };
  reserve: number;
  available: Money;
  topupTotal: number;
  secureTotal: number;
  missing: number;
  unknownFunds: string[];
  providers: ProviderReserve[];
  assumptions: string[];
  status: ProviderStatus;
};

const EMPTY_POOLS: Pools = { subscription: 0, topup: 0, bonus: 0, legacy: 0, expiring_24h: 0, expiring_7d: 0, expiring_horizon: 0 };
const EMPTY_TRANCHES: TrancheTotals = { total: 0, within_24h: 0, within_7d: 0, within_horizon: 0 };
const EMPTY_MONTH: CreditsMonth = {
  granted_subscription: 0, granted_topup: 0, granted_bonus: 0, used: 0, expired: 0,
  used_d1: 0, used_today: 0, used_d7: 0, used_d30: 0, used_hist: 0, granted_today: 0,
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round = (n: number) => Math.round(n);

function pools(p: Partial<Pools> | undefined): Pools {
  const out = { ...EMPTY_POOLS };
  for (const k of Object.keys(out) as (keyof Pools)[]) out[k] = num(p?.[k]);
  return out;
}
function tranches(t: Partial<TrancheTotals> | undefined): TrancheTotals {
  const out = { ...EMPTY_TRANCHES };
  for (const k of Object.keys(out) as (keyof TrancheTotals)[]) out[k] = num(t?.[k]);
  return out;
}
function month(m: Partial<CreditsMonth> | undefined): CreditsMonth {
  const out = { ...EMPTY_MONTH };
  for (const k of Object.keys(out) as (keyof CreditsMonth)[]) out[k] = num(m?.[k]);
  return out;
}

/** "2K" / "2k" / "2048" → a comparable key. */
const sizeKey = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

/**
 * What one credit costs on each provider according to the CONFIGURATION:
 * for every active customer-facing model with a per-size credit price and a
 * per-size unit price, unit price ÷ credits. Standard = the average across
 * sizes, cautious = the most expensive size.
 */
export function configCostPerCredit(models: ModelFacts[], prices: UnitPriceFacts[]): Map<string, { avg: number; max: number }> {
  const out = new Map<string, number[]>();
  for (const m of models) {
    if (!m.customer || !m.pricing || typeof m.pricing !== "object") continue;
    for (const [size, creditsRaw] of Object.entries(m.pricing as Record<string, unknown>)) {
      const credits = num(creditsRaw);
      if (credits <= 0) continue;
      const price = prices.find((u) => u.provider === m.provider && u.model === m.model && sizeKey(u.resolution) === sizeKey(size))
        ?? prices.find((u) => u.provider === m.provider && u.model === m.model && !u.resolution);
      if (!price || price.usd_micros <= 0) continue;
      const list = out.get(m.provider) ?? [];
      list.push(price.usd_micros / credits);
      out.set(m.provider, list);
    }
  }
  const result = new Map<string, { avg: number; max: number }>();
  for (const [slug, list] of out) result.set(slug, { avg: list.reduce((a, b) => a + b, 0) / list.length, max: Math.max(...list) });
  return result;
}

const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

export function computeReserves(snap: ReserveSnapshot): ReserveReport {
  const s = snap.settings;
  const buffer = Math.max(0, num(s.buffer_percent)) / 100;
  const H = Math.max(1, num(s.horizon_days));
  const factor = Math.max(1, num(s.cautious_factor) || 1);
  const assumptions: string[] = [];

  const spend = snap.spend ?? [];
  const classes: SpendClass[] = ["customer", "internal", "system"];
  const spendBy = (cls: SpendClass | "total") => {
    const rows = cls === "total" ? spend : spend.filter((r) => r.cls === cls);
    return {
      h1: sumBy(rows, (r) => num(r.h1)), today: sumBy(rows, (r) => num(r.today)), d1: sumBy(rows, (r) => num(r.d1)),
      d7: sumBy(rows, (r) => num(r.d7)), d30: sumBy(rows, (r) => num(r.d30)), month: sumBy(rows, (r) => num(r.month)),
    };
  };
  const spendTotals = Object.fromEntries([...classes, "total"].map((c) => [c, spendBy(c as SpendClass | "total")])) as ReserveReport["spend"];
  const unknownCalls = {
    h1: sumBy(spend, (r) => num(r.unknown_h1)), today: sumBy(spend, (r) => num(r.unknown_today)), month: sumBy(spend, (r) => num(r.unknown_month)),
  };
  if (unknownCalls.month > 0) assumptions.push("unknown_costs");

  const cPools = pools(snap.pools?.customer);
  const iPools = pools(snap.pools?.internal);
  const cTr = tranches(snap.tranches?.customer);
  const iTr = tranches(snap.tranches?.internal);
  const cMonth = month(snap.credits_month?.customer);
  const cTotal = cPools.subscription + cPools.topup + cPools.bonus + cPools.legacy;

  // ── what one credit costs ────────────────────────────────────────────────
  const slugs = new Set<string>([...snap.providers.map((p) => p.slug), ...spend.map((r) => r.provider_slug)]);
  const histCredits = num(cMonth.used_hist);
  const histCost = new Map<string, number>();
  for (const r of spend.filter((x) => x.cls === "customer")) histCost.set(r.provider_slug, (histCost.get(r.provider_slug) ?? 0) + num(r.hist));
  const histTotal = [...histCost.values()].reduce((a, b) => a + b, 0);
  const config = configCostPerCredit(snap.models ?? [], snap.unit_prices ?? []);

  let source: "history" | "config" | "none" = "none";
  const cpc = new Map<string, Scenario>();
  if (histCredits >= Math.max(0, num(s.min_history_credits)) && histCredits > 0 && histTotal > 0) {
    source = "history";
    for (const slug of slugs) {
      const std = (histCost.get(slug) ?? 0) / histCredits;
      const cfgMax = config.get(slug)?.max ?? 0;
      if (std <= 0 && cfgMax <= 0) continue;
      cpc.set(slug, { standard: std, cautious: Math.max(std * factor, cfgMax) });
    }
  } else if (config.size > 0) {
    source = "config";
    assumptions.push("history_insufficient");
    for (const [slug, c] of config) cpc.set(slug, { standard: c.avg, cautious: Math.max(c.max, c.avg * factor) });
  } else {
    assumptions.push("no_cost_basis");
  }
  const cpcTotal: Scenario | null = cpc.size
    ? { standard: sumBy([...cpc.values()], (v) => v.standard), cautious: sumBy([...cpc.values()], (v) => v.cautious) }
    : null;

  // ── how much of what customers hold they will really use ────────────────
  const eh = snap.expired_history ?? { lots: 0, granted: 0, unused: 0 };
  let utilization = 1;
  if (num(eh.lots) >= 3 && num(eh.granted) > 0) {
    utilization = Math.min(1, Math.max(0, 1 - num(eh.unused) / num(eh.granted)));
  } else {
    assumptions.push("utilization_full");
  }

  // Credits per day customers are spending right now (net of refunds).
  const rate = Math.max(num(cMonth.used_d1), num(cMonth.used_d7) / 7, 0);
  const availableIn = (days: number) => cTotal + (days <= 1 ? cTr.within_24h : days <= 7 ? cTr.within_7d : cTr.within_horizon);
  const expiringIn = (days: number) => (days <= 1 ? cPools.expiring_24h : days <= 7 ? cPools.expiring_7d : cPools.expiring_horizon);
  const volume = (days: number): Scenario => {
    const avail = availableIn(days);
    return {
      standard: Math.min(avail, Math.max(rate * days, expiringIn(days) * utilization)),
      cautious: Math.min(avail, Math.max(rate * days * factor, expiringIn(days))),
    };
  };

  // Running spend that is not a customer's credit: admin tests, internal
  // accounts, system jobs (GrovNews…), per provider and per day.
  const opsRate = (slug: string) => {
    const rows = spend.filter((r) => r.provider_slug === slug && r.cls !== "customer");
    return Math.max(sumBy(rows, (r) => num(r.d1)), sumBy(rows, (r) => num(r.d7)) / 7, 0);
  };

  const needFor = (slug: string, days: number): Scenario => {
    const v = volume(days);
    const c = cpc.get(slug);
    const ops = opsRate(slug) * days;
    return {
      standard: round((c ? v.standard * c.standard : 0) + ops),
      cautious: round((c ? v.cautious * c.cautious : 0) + ops * factor),
    };
  };

  const exposure: Scenario | null = cpcTotal
    ? {
        standard: round(((cPools.subscription + cTr.total) * utilization + cPools.topup + cPools.bonus + cPools.legacy) * cpcTotal.standard),
        cautious: round((cTotal + cTr.total) * cpcTotal.cautious),
      }
    : null;

  const scenario = s.scenario === "cautious" ? "cautious" : "standard";
  const totalSpendMonth = spendTotals.total.month;

  const providers: ProviderReserve[] = snap.providers.map((p) => {
    const rows = spend.filter((r) => r.provider_slug === p.slug);
    const sp = {
      h1: sumBy(rows, (r) => num(r.h1)), today: sumBy(rows, (r) => num(r.today)), d1: sumBy(rows, (r) => num(r.d1)),
      d7: sumBy(rows, (r) => num(r.d7)), month: sumBy(rows, (r) => num(r.month)),
      callsH1: sumBy(rows, (r) => num(r.calls_h1)), callsToday: sumBy(rows, (r) => num(r.calls_today)),
      callsMonth: sumBy(rows, (r) => num(r.calls_month)), unknownMonth: sumBy(rows, (r) => num(r.unknown_month)),
      share: totalSpendMonth > 0 ? sumBy(rows, (r) => num(r.month)) / totalSpendMonth : null,
    };
    const need = { h24: needFor(p.slug, 1), d7: needFor(p.slug, 7), horizon: needFor(p.slug, H) };
    const reserve = round(need.horizon[scenario] * (1 + buffer));

    let available: Money = { micros: null, basis: "unavailable" };
    let limitLeft: Money | null = null;
    const balance = numOrNull(p.balance);
    if ((p.mode === "auto" || p.mode === "manual") && balance !== null) {
      const spent = num(p.spend_since_balance);
      const adjust = num(p.adjust_since_balance);
      const est = balance + adjust - spent;
      const unchanged = spent === 0 && adjust === 0 && num(p.unknown_since_balance) === 0;
      available = { micros: round(est), basis: unchanged ? (p.basis === "confirmed" ? "confirmed" : "manual") : "estimated" };
    }
    if (p.mode === "postpaid" && p.credit_limit !== null) {
      limitLeft = { micros: round(num(p.credit_limit) - sp.month), basis: "estimated" };
    }

    const burnPerHour = Math.max(sp.d1 / 24, sp.d7 / (7 * 24));
    const runwayHours = available.micros !== null && burnPerHour > 0 ? Math.max(0, available.micros) / burnPerHour : null;
    const prepaid = p.mode === "auto" || p.mode === "manual";
    const topup = prepaid && available.micros !== null ? Math.max(0, reserve - available.micros) : null;
    const secure = p.mode === "postpaid" ? round(sp.month + reserve) : null;

    let status: ProviderStatus = "ok";
    if (p.mode === "off") status = "off";
    else if (prepaid && available.micros === null) status = (p.active || reserve > 0) ? "no_data" : "ok";
    else if (prepaid && available.micros !== null) {
      const a = available.micros;
      if (a <= p.critical || a < need.h24[scenario] || (runwayHours !== null && runwayHours < 24)) status = "critical";
      else if (a <= p.warn || a < reserve || (runwayHours !== null && runwayHours < 24 * 7)) status = "warning";
    } else if (p.mode === "postpaid" && limitLeft?.micros !== null && limitLeft) {
      const left = limitLeft.micros ?? 0;
      if (left < need.h24[scenario]) status = "critical";
      else if (left < reserve) status = "warning";
    }
    // A provider nobody uses and that holds nothing is not an alarm.
    if (!p.active && sp.month === 0 && reserve === 0 && status !== "off") status = available.micros === null ? "no_data" : "ok";

    return {
      id: p.id, slug: p.slug, name: p.name, active: p.active, mode: p.mode, billingUrl: p.billing_url,
      warnMicros: num(p.warn), criticalMicros: num(p.critical), creditLimitMicros: numOrNull(p.credit_limit),
      available, limitLeft, spend: sp, costPerCredit: cpc.get(p.slug) ?? null, need, reserve, topup, secure,
      runwayHours, status, lastSyncAt: p.last_sync_at, syncStatus: p.last_sync_status, syncError: p.last_sync_error,
      unknownSinceBalance: num(p.unknown_since_balance), events: p.events ?? [],
    };
  });

  const tracked = providers.filter((p) => p.mode !== "off");
  const sumScenario = (pick: (p: ProviderReserve) => Scenario): Scenario => ({
    standard: sumBy(tracked, (p) => pick(p).standard), cautious: sumBy(tracked, (p) => pick(p).cautious),
  });
  const prepaidKnown = tracked.filter((p) => (p.mode === "auto" || p.mode === "manual") && p.available.micros !== null);
  const availableTotal = sumBy(prepaidKnown, (p) => p.available.micros ?? 0);
  const unknownFunds = tracked
    .filter((p) => (p.mode === "auto" || p.mode === "manual") && p.available.micros === null && (p.active || p.reserve > 0))
    .map((p) => p.slug);
  const allConfirmed = prepaidKnown.length > 0 && prepaidKnown.every((p) => p.available.basis === "confirmed");
  const topupTotal = sumBy(tracked, (p) => p.topup ?? 0);
  const secureTotal = sumBy(tracked, (p) => p.secure ?? 0);

  const worst = (["critical", "warning", "no_data", "ok"] as ProviderStatus[])
    .find((st) => tracked.some((p) => p.status === st && (p.active || p.reserve > 0))) ?? "ok";

  return {
    settings: s,
    generatedAt: snap.now,
    spend: spendTotals,
    unknownCalls,
    credits: {
      customer: { ...cPools, total: cTotal, tranches: cTr },
      internal: { ...iPools, total: iPools.subscription + iPools.topup + iPools.bonus + iPools.legacy, tranches: iTr },
      month: cMonth,
    },
    costPerCredit: { standard: cpcTotal?.standard ?? null, cautious: cpcTotal?.cautious ?? null, source, utilization },
    exposure,
    need: { h24: sumScenario((p) => p.need.h24), d7: sumScenario((p) => p.need.d7), horizon: sumScenario((p) => p.need.horizon) },
    reserve: sumBy(tracked, (p) => p.reserve),
    available: prepaidKnown.length === 0
      ? { micros: null, basis: "unavailable" }
      : { micros: availableTotal, basis: allConfirmed ? "confirmed" : "estimated" },
    topupTotal,
    secureTotal,
    missing: topupTotal + secureTotal,
    unknownFunds,
    providers,
    assumptions,
    status: worst,
  };
}

/**
 * The liability one confirmed sale adds: its credits (granted now + scheduled
 * tranches) at the standard cost per credit, split by provider the same way,
 * and with the safety buffer.
 */
export function saleLiability(report: ReserveReport, credits: number): {
  standard: number | null; withBuffer: number | null; byProvider: { slug: string; name: string; micros: number }[];
} {
  const cpcTotal = report.costPerCredit.standard;
  if (cpcTotal === null || credits <= 0) return { standard: cpcTotal === null ? null : 0, withBuffer: cpcTotal === null ? null : 0, byProvider: [] };
  const buffer = 1 + Math.max(0, report.settings.buffer_percent) / 100;
  const byProvider = report.providers
    .filter((p) => p.costPerCredit && p.costPerCredit.standard > 0 && p.mode !== "off")
    .map((p) => ({ slug: p.slug, name: p.name, micros: Math.round(credits * (p.costPerCredit?.standard ?? 0) * buffer) }));
  return {
    standard: Math.round(credits * cpcTotal),
    withBuffer: Math.round(credits * cpcTotal * buffer),
    byProvider,
  };
}

/* ── formatting for the REPORTS (Telegram / e-mail are written in Polish, like
 * every other GrovBase admin notification — lib/server/telegram-notification.ts).
 * The admin PANEL never uses these labels: it reads lib/i18n/dictionaries. ─*/

export function usd(micros: number | null | undefined): string {
  if (micros === null || micros === undefined || !Number.isFinite(micros)) return "Brak danych";
  const v = micros / 1_000_000;
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function cents(amount: number, currency: string): string {
  const v = amount / 100;
  return currency.toUpperCase() === "USD" ? `$${v.toFixed(2)}` : `${v.toFixed(2)} ${currency.toUpperCase()}`;
}

export function credits(n: number): string {
  const whole = Math.round(n * 100) / 100;
  const [i, f] = whole.toFixed(2).split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return f === "00" ? grouped : `${grouped},${f}`;
}

export function revenueText(rev: Record<string, number> | undefined): string {
  const entries = Object.entries(rev ?? {}).filter(([, v]) => num(v) !== 0);
  if (entries.length === 0) return "$0.00";
  return entries.map(([cur, v]) => cents(num(v), cur)).join(" + ");
}

export function runwayText(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${Math.floor(hours)} h`;
  return `${Math.floor(hours / 24)} dni`;
}

export const STATUS_ICON: Record<ProviderStatus, string> = { ok: "🟢", warning: "🟡", critical: "🔴", no_data: "⚪", off: "⚫" };
export const STATUS_LABEL: Record<ProviderStatus, string> = {
  ok: "OK", warning: "Ostrzeżenie", critical: "Krytyczny", no_data: "Brak danych", off: "Nie monitorowany",
};
export const BASIS_LABEL: Record<Basis, string> = {
  confirmed: "Potwierdzona", estimated: "Szacowana", manual: "Wprowadzona ręcznie", unavailable: "Niedostępna",
};
