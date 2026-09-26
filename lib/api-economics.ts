/**
 * API ECONOMICS — pure rules (no I/O), shared by the admin service and tests.
 *
 * Three questions, answered without inventing anything:
 *
 *   1. WHAT DID THE PROVIDER COST US?  From ai_provider_calls (0127) when the
 *      run was traced; for older rows, the figure usage_events recorded at the
 *      time. Every figure carries its basis — actual (the provider stated it),
 *      estimated (usage × our price list), unknown (no price) — and an unknown
 *      cost is never summed as zero.
 *
 *   2. WHAT DID THE CUSTOMER PAY FOR IT?  Credits are not money. Money is what
 *      reached us through a settled payment. There are no credit lots in the
 *      ledger, so revenue is ATTRIBUTED PROPORTIONALLY per workspace:
 *
 *        revenue per credit = money the workspace paid / every credit it was
 *                             ever granted (purchased, subscription, bonus,
 *                             welcome, admin — refunds of spent credits are not
 *                             grants)
 *
 *      A workspace that never paid has a rate of 0: its runs are BONUS runs and
 *      earn 0 — never "we earned X". A free run (0 credits) earns 0. A system
 *      job (GrovNews) has no customer and no per-run revenue at all.
 *
 *   3. MARGIN = revenue − cost, only where both are known. A run with an
 *      unknown cost has no margin. A bonus run has revenue 0, so its "margin"
 *      is the promotional cost (negative) — shown as such, never as a percent.
 */

export const SETTLED_PAYMENT = ["succeeded", "paid", "completed", "partially_refunded"] as const;

export type CostBasis = "actual" | "estimated" | "unknown";

/** One provider-side call as stored in ai_provider_calls. */
export type CallRow = {
  id: string;
  created_at: string;
  actor_kind: string;
  consumer: string;
  tool_key: string | null;
  usage_event_id: string | null;
  provider_slug: string;
  model: string | null;
  status: string;
  request_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  units: number | null;
  unit_kind: string | null;
  cost_usd_micros: number | null;
  cost_basis: string;
  duration_ms: number | null;
};

/** The usage_events columns this module reads. */
export type EventRow = {
  id: string;
  created_at: string;
  workspace_id: string;
  user_id: string | null;
  service_slug: string;
  provider_slug: string | null;
  model_slug: string | null;
  status: string;
  credits_charged: number;
  result_count: number | null;
  actual_api_cost_usd_micros: number | null;
  api_cost_usd_micros_snapshot: number | null;
  metadata: unknown;
};

export type Money = { usdMicros: number | null; basis: CostBasis };

/** Sum of known costs; unknown if ANY part is unknown and nothing is known. */
export function sumCosts(parts: readonly Money[]): { usdMicros: number; unknown: number; basis: CostBasis } {
  let usd = 0; let unknown = 0; let actual = 0; let estimated = 0;
  for (const p of parts) {
    if (p.basis === "unknown" || p.usdMicros == null) { unknown++; continue; }
    usd += p.usdMicros;
    if (p.basis === "actual") actual++; else estimated++;
  }
  const basis: CostBasis = actual + estimated === 0 ? "unknown" : estimated > 0 ? "estimated" : "actual";
  return { usdMicros: usd, unknown, basis };
}

/**
 * A usage event's provider cost.
 *
 * Traced (0127 onwards): the sum of its calls — failed attempts included,
 * since a provider bills what it produced before failing.
 * Untraced (older rows): the figure recorded at the time. That figure was
 * always derived from a price table (model cost × images, or the catalogue
 * snapshot), so it is ESTIMATED, never "measured". A recorded 0 on a
 * succeeded paid run with a catalogue price falls back to the catalogue price
 * × results; a refunded/failed run with nothing recorded cost nothing we know
 * of and is reported as unknown rather than as a confident zero.
 */
export function eventCost(e: EventRow, calls: readonly CallRow[] | undefined): Money {
  if (calls && calls.length) {
    const s = sumCosts(calls.map((c) => ({ usdMicros: c.cost_usd_micros, basis: asBasis(c.cost_basis) })));
    return s.unknown > 0 && s.basis === "unknown" ? { usdMicros: null, basis: "unknown" }
      : { usdMicros: s.usdMicros, basis: s.unknown > 0 ? "estimated" : s.basis };
  }
  const recorded = e.actual_api_cost_usd_micros ?? 0;
  if (recorded > 0) return { usdMicros: recorded, basis: "estimated" };
  if (e.service_slug !== "image_generation" && e.provider_slug === "local") return { usdMicros: 0, basis: "actual" };
  const snapshot = e.api_cost_usd_micros_snapshot ?? 0;
  if (e.status === "succeeded" && snapshot > 0) {
    return { usdMicros: snapshot * Math.max(1, e.result_count ?? 1), basis: "estimated" };
  }
  if (e.status === "succeeded" && e.credits_charged === 0) return { usdMicros: 0, basis: "estimated" };
  return { usdMicros: null, basis: "unknown" };
}

function asBasis(v: string): CostBasis {
  return v === "actual" || v === "estimated" ? v : "unknown";
}

/** Per-workspace money and grants, for the proportional revenue rate. */
export type WorkspaceMoney = { paidCents: number; grantedCredits: number };

export type RevenueKind = "paid" | "bonus" | "free" | "refunded" | "system";

export type Revenue = { kind: RevenueKind; cents: number };

/** Money actually kept from a payment row (a partial refund reduces it). */
export function keptCents(p: { amount_cents: number; status: string; metadata: unknown }): number {
  if (!(SETTLED_PAYMENT as readonly string[]).includes(p.status)) return 0;
  if (p.status !== "partially_refunded") return Math.max(0, p.amount_cents);
  const refund = (p.metadata && typeof p.metadata === "object"
    ? (p.metadata as { refund?: { amount_cents?: unknown } }).refund?.amount_cents : null);
  const r = typeof refund === "number" && refund > 0 ? refund : 0;
  return Math.max(0, p.amount_cents - r);
}

/** The revenue attributed to one customer run. */
export function eventRevenue(e: EventRow, money: WorkspaceMoney | undefined): Revenue {
  if (e.status === "refunded" || e.status === "failed") return { kind: "refunded", cents: 0 };
  if (e.credits_charged <= 0) return { kind: "free", cents: 0 };
  if (!money || money.paidCents <= 0 || money.grantedCredits <= 0) return { kind: "bonus", cents: 0 };
  return { kind: "paid", cents: Math.round((e.credits_charged * money.paidCents) / money.grantedCredits) };
}

/** Margin in PLN cents (cost converted at the configured USD→PLN rate). */
export function margin(revenue: Revenue, cost: Money, usdToPln: number): { cents: number | null; percent: number | null } {
  if (revenue.kind === "system" || cost.basis === "unknown" || cost.usdMicros == null) return { cents: null, percent: null };
  const costCents = usdMicrosToPlnCents(cost.usdMicros, usdToPln);
  const cents = revenue.cents - costCents;
  return { cents, percent: revenue.cents > 0 ? (cents / revenue.cents) * 100 : null };
}

export function usdMicrosToPlnCents(usdMicros: number, usdToPln: number): number {
  return Math.round((usdMicros / 1_000_000) * usdToPln * 100);
}

/**
 * Which tool a usage event belongs to. New runs carry it on their trace; older
 * ones are recognised from what the ledger stored: the engine operation for
 * Retusz/Moda, a prompt session for GrovShot, the tool slug for image tools,
 * and the service → tool map from ai_tools for the rest.
 */
export function eventTool(
  e: EventRow, calls: readonly CallRow[] | undefined,
  serviceToTool: ReadonlyMap<string, string>, toolKeys: ReadonlySet<string>,
): string {
  const traced = calls?.find((c) => c.tool_key)?.tool_key;
  if (traced) return traced;
  const meta = (e.metadata && typeof e.metadata === "object" ? e.metadata : {}) as Record<string, unknown>;
  if (e.service_slug === "image_generation") {
    const op = typeof meta.operation === "string" ? meta.operation : null;
    if (op === "image_retouch") return "retouch";
    if (op && toolKeys.has(op)) return op;
    if (typeof meta.session_id === "string") return "prompts";
    return "generator";
  }
  if (e.service_slug === "prompt_generation") return "prompts";
  const mapped = serviceToTool.get(e.service_slug);
  if (mapped) return mapped;
  if (typeof meta.tool === "string" && /^[a-z0-9_]{2,64}$/.test(meta.tool)) return meta.tool;
  return e.service_slug;
}

/** Europe/Warsaw midnight of `now`, as a UTC Date. */
export function warsawDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - offsetMs);
}

/** Aggregate for one tool and one window. */
export type Aggregate = {
  runs: number;
  succeeded: number;
  failed: number;
  credits: number;
  cost: { usdMicros: number; unknown: number; basis: CostBasis };
  revenueCents: number;
  paidRuns: number;
  bonusRuns: number;
  freeRuns: number;
  /** Margin over the runs whose cost AND revenue are known; null if none. */
  marginCents: number | null;
  marginPercent: number | null;
  avgCostUsdMicros: number | null;
  avgRevenueCents: number | null;
};

export type RunLine = { event: EventRow; calls: CallRow[]; revenue: Revenue; cost: Money };

export function aggregate(lines: readonly RunLine[], usdToPln: number): Aggregate {
  const costs = lines.map((l) => l.cost);
  const cost = sumCosts(costs);
  let credits = 0; let revenueCents = 0; let paidRuns = 0; let bonusRuns = 0; let freeRuns = 0;
  let succeeded = 0; let failed = 0;
  let mRev = 0; let mCost = 0; let mCount = 0;
  for (const l of lines) {
    if (l.event.status === "succeeded") succeeded++;
    if (l.event.status === "failed" || l.event.status === "refunded") failed++;
    if (l.revenue.kind !== "refunded") credits += Math.max(0, l.event.credits_charged);
    revenueCents += l.revenue.cents;
    if (l.revenue.kind === "paid") paidRuns++;
    else if (l.revenue.kind === "bonus") bonusRuns++;
    else if (l.revenue.kind === "free") freeRuns++;
    if (l.cost.basis !== "unknown" && l.cost.usdMicros != null) {
      mRev += l.revenue.cents; mCost += usdMicrosToPlnCents(l.cost.usdMicros, usdToPln); mCount++;
    }
  }
  const known = lines.length - cost.unknown;
  return {
    runs: lines.length, succeeded, failed, credits, cost, revenueCents,
    paidRuns, bonusRuns, freeRuns,
    marginCents: mCount ? mRev - mCost : null,
    marginPercent: mCount && mRev > 0 ? ((mRev - mCost) / mRev) * 100 : null,
    avgCostUsdMicros: known > 0 ? Math.round(cost.usdMicros / known) : null,
    avgRevenueCents: lines.length ? Math.round(revenueCents / lines.length) : null,
  };
}
