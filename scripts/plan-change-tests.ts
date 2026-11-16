/**
 * SMART SUBSCRIPTION MANAGEMENT (0181) — the arithmetic, the Stripe sequence
 * and the webhook hook, without money moving anywhere.
 *
 *   A. lib/billing/plan-change.ts — every scenario of the brief, to the cent,
 *      plus a randomised property check (the deduction is never above the
 *      exact min, the invoice always equals list − deduction).
 *   B. lib/server/plan-change.ts — driven against a FAKE Stripe and a fake
 *      database: what is called, in what order, with which idempotency key;
 *      that a quote writes nothing to Stripe; that a mismatch, a failure or an
 *      ambiguous timeout is undone; that the pinned API never receives
 *      `discounts` together with `payment_behavior`.
 *   C. the webhook: stripe_settle_v2 first, then plan_change_settle, and a
 *      failed settle throws (Stripe retries).
 *   D. i18n: every key the dialog and the admin page use, in PL / EN / DE.
 *
 * The ledger side (reservation, release, settlement, tranches, permissions)
 * is proven on a real Postgres by scripts/plan-change-sql-tests.sh.
 *
 *   npm run test:planchange
 */
import { readFileSync } from "node:fs";
import {
  classifyChange, periodBasis, quoteChange, quoteFingerprint, MIN_CHARGE_CENTS,
  type CurrentSubscription, type PlanFacts,
} from "@/lib/billing/plan-change";
import {
  cancelPlanChange, confirmPlanChange, quotePlanChange, setPlanChangesEnabled, settlePlanChange, sweepPlanChanges,
  type StripeIO,
} from "@/lib/server/plan-change";
import { handleStripeEvent, HANDLED_EVENT_TYPES } from "@/lib/server/stripe-webhook";
import type { Client } from "@/lib/services/workspace";
import type { FormValue } from "@/lib/stripe/client";
import { saleMessage, type SaleFacts } from "@/lib/server/api-reserves/reports";
import { renderNotification } from "@/lib/server/telegram-notification";
import { renderAdminNotification } from "@/lib/server/admin-email";
import { computeReserves, type ReserveSnapshot } from "@/lib/finance/api-reserves";

async function main() {
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (s: string) => console.log(`\n${s}`);
const DAY = 24 * 3600 * 1000;

/* ── the real catalogue (0175) ─────────────────────────────────────────────*/
const plan = (id: string, slug: string, name: string, price: number, annual: number, credits: number): PlanFacts =>
  ({ id, slug, name, priceCents: price, annualPriceCents: annual, currency: "USD", credits });
const MINI = plan("p-mini", "mini", "Mini", 990, 9900, 20);
const STARTER = plan("p-starter", "starter", "Starter", 2490, 24900, 55);
const PRO = plan("p-pro", "pro", "Pro", 4990, 49900, 125);
const BUSINESS = plan("p-agency", "agency", "Business", 10990, 109900, 290);

function monthly(p: PlanFacts, at: Date, elapsedShare: number, used: number, basis = p.priceCents): CurrentSubscription {
  const len = 30 * DAY;
  const start = at.getTime() - elapsedShare * len;
  return {
    plan: p, period: "monthly", periodStart: new Date(start).toISOString(), periodEnd: new Date(start + len).toISOString(),
    basisCents: basis, periodCredits: p.credits,
    lots: p.credits - used > 0 ? [{ id: "lot-m", amount: p.credits, remaining: p.credits - used, expiresAt: new Date(start + len).toISOString() }] : [],
    pendingTranches: [],
  };
}
function annual(p: PlanFacts, at: Date, monthIndex: number, usedThisMonth: number): CurrentSubscription {
  const len = 365 * DAY;
  const start = at.getTime() - (monthIndex + 0.5) * (len / 12);
  const pending = Array.from({ length: 11 - monthIndex }, (_, i) => ({ id: `t${monthIndex + 2 + i}`, credits: p.credits, startsAt: new Date(start + (monthIndex + 1 + i) * len / 12).toISOString() }));
  return {
    plan: p, period: "annual", periodStart: new Date(start).toISOString(), periodEnd: new Date(start + len).toISOString(),
    basisCents: p.annualPriceCents, periodCredits: p.credits * 12,
    lots: [{ id: "lot-a", amount: p.credits, remaining: p.credits - usedThisMonth, expiresAt: new Date(start + (monthIndex + 1) * len / 12).toISOString() }],
    pendingTranches: pending,
  };
}

/* ═══ A. the arithmetic ═══════════════════════════════════════════════════*/
section("A. quote arithmetic");
const at = new Date("2026-11-16T12:00:00Z");
{
  // The brief's example, exactly.
  const q = quoteChange(monthly(STARTER, at, 0.5, 20), { plan: PRO, period: "monthly" }, at);
  check("A1 Starter → PRO, half the month, 20/55 used: time 12.45, credits 15.84, deduction 12.45, pay 37.45",
    q.ok && q.quote.timeValueCents === 1245 && q.quote.creditValueCents === 1584 && q.quote.deductionCents === 1245
      && q.quote.amountDueCents === 3745 && q.quote.deductionBasis === "time" && q.quote.kind === "upgrade" && q.quote.timing === "immediate",
    JSON.stringify(q));
  check("A2 the old pool closes (35 credits), the new full pool (125) is granted",
    q.ok && q.quote.oldPool === "closed" && q.quote.closedCredits === 35 && q.quote.newCreditsNow === 125);
}
{
  const q = quoteChange(monthly(STARTER, at, 0.1, 50), { plan: PRO, period: "monthly" }, at);
  check("A3 credits decide when most were used: 5/55 left → floor(2490×5/55) = 226",
    q.ok && q.quote.deductionCents === 226 && q.quote.deductionBasis === "credits" && q.quote.amountDueCents === 4990 - 226);
}
{
  const q = quoteChange(monthly(STARTER, at, 0.2, 55), { plan: PRO, period: "monthly" }, at);
  check("A4 nothing left to settle: deduction 0, full price", q.ok && q.quote.deductionCents === 0 && q.quote.amountDueCents === 4990);
}
{
  const q = quoteChange(monthly(PRO, at, 0.3, 10), { plan: STARTER, period: "monthly" }, at);
  check("A5 monthly downgrade: now, full new price, no deduction, no refund, old credits kept until expiry",
    q.ok && q.quote.kind === "downgrade" && q.quote.timing === "immediate" && q.quote.deductionCents === 0
      && q.quote.amountDueCents === 2490 && q.quote.oldPool === "kept_until_expiry" && q.quote.closedCredits === 0 && q.quote.newCreditsNow === 55);
}
{
  const q = quoteChange(monthly(STARTER, at, 0.5, 20), { plan: STARTER, period: "annual" }, at);
  check("A6 monthly → annual (same plan): immediate, with the deduction",
    q.ok && q.quote.kind === "to_annual" && q.quote.timing === "immediate" && q.quote.deductionCents === 1245 && q.quote.amountDueCents === 24900 - 1245);
  const q2 = quoteChange(monthly(PRO, at, 0.5, 0), { plan: MINI, period: "annual" }, at);
  check("A7 monthly → annual of a lower tier: also immediate with the deduction", q2.ok && q2.quote.timing === "immediate" && q2.quote.deductionCents === 2495);
}
{
  // Annual Starter, in month 3 (index 2), 15 of 55 used this month.
  const cur = annual(STARTER, at, 2, 15);
  const q = quoteChange(cur, { plan: PRO, period: "annual" }, at);
  const unused = 40 + 9 * 55;
  const timeExact = 24900 * (Date.parse(cur.periodEnd) - at.getTime()) / (Date.parse(cur.periodEnd) - Date.parse(cur.periodStart));
  const creditExact = 24900 * unused / 660;
  check("A8 annual upgrade settles the current tranche AND the future tranches once (unused 535 credits)",
    q.ok && q.quote.unusedCredits === unused && q.quote.closedCredits === unused && q.quote.creditValueCents === Math.floor(creditExact)
      && q.quote.timeValueCents === Math.floor(timeExact) && q.quote.deductionCents === Math.min(Math.floor(timeExact), Math.floor(creditExact)),
    JSON.stringify(q.ok ? q.quote : q));
  check("A9 annual upgrade: the new year starts with ONE tranche (125), never twelve",
    q.ok && q.quote.newCreditsNow === 125 && q.quote.newCreditsPerMonth === 125 && q.quote.pool.tranches.length === 9);
  const d = quoteChange(cur, { plan: MINI, period: "annual" }, at);
  check("A10 annual downgrade: at the end of the paid year, nothing deducted, credits continue",
    d.ok && d.quote.timing === "period_end" && d.quote.deductionCents === 0 && d.quote.amountDueCents === 9900
      && d.quote.oldPool === "continues_until_period_end" && d.quote.effectiveAt === new Date(Date.parse(cur.periodEnd)).toISOString());
  const m = quoteChange(cur, { plan: BUSINESS, period: "monthly" }, at);
  check("A11 annual → monthly (even a higher tier): at the end of the paid year", m.ok && m.quote.kind === "to_monthly" && m.quote.timing === "period_end");
}
{
  const same = quoteChange(monthly(PRO, at, 0.5, 0), { plan: PRO, period: "monthly" }, at);
  check("A12 the same plan and period is refused", !same.ok && same.reason === "same_plan");
  const close = quoteChange(monthly(STARTER, at, 0.99, 0), { plan: PRO, period: "monthly" }, at);
  check("A13 an immediate change within 24 h of the renewal waits for it", !close.ok && close.reason === "too_close_to_renewal");
  const closeSched = quoteChange({ ...annual(PRO, at, 11, 0), periodEnd: new Date(at.getTime() + 3600_000).toISOString() }, { plan: MINI, period: "annual" }, at);
  check("A14 …but a change scheduled for the period end is still allowed", closeSched.ok && closeSched.quote.timing === "period_end");
  const over = quoteChange(monthly(BUSINESS, at, 0.01, 0), { plan: MINI, period: "annual" }, at);
  check("A15 a deduction that would leave < $0.50 to pay is not automated", !over.ok && over.reason === "deduction_exceeds_price");
  const cur = quoteChange(monthly(STARTER, at, 0.5, 0), { plan: { ...PRO, currency: "PLN" }, period: "monthly" }, at);
  check("A16 a different currency is refused", !cur.ok && cur.reason === "currency_mismatch");
  const ended = quoteChange(monthly(STARTER, at, 1.2, 0), { plan: PRO, period: "monthly" }, at);
  check("A17 a period already over is refused", !ended.ok && ended.reason === "period_ended");
}
{
  // Every from/to pair of the real catalogue: who decides the timing.
  const plans = [MINI, STARTER, PRO, BUSINESS];
  let ok = true; const bad: string[] = [];
  for (const f of plans) for (const fp of ["monthly", "annual"] as const) for (const t of plans) for (const tp of ["monthly", "annual"] as const) {
    const c = classifyChange({ plan: f, period: fp }, { plan: t, period: tp });
    if (f.id === t.id && fp === tp) { if (c !== null) { ok = false; bad.push(`${f.slug}/${fp}=`); } continue; }
    const expect = fp === "monthly" ? "immediate" : tp === "monthly" ? "period_end" : t.priceCents > f.priceCents ? "immediate" : "period_end";
    const deduct = fp === "monthly" ? (tp === "annual" || t.priceCents > f.priceCents) : (tp === "annual" && t.priceCents > f.priceCents);
    if (!c || c.timing !== expect || c.deduction !== deduct) { ok = false; bad.push(`${f.slug}/${fp}→${t.slug}/${tp}`); }
  }
  check("A18 all 56 changes of the catalogue follow the rules (tier = monthly list price)", ok, bad.join(", "));
}
{
  check("A19 basis = what was paid (tax excluded) + a carried deduction, capped at list",
    periodBasis(2490, null, 0, 2490) === 2490 && periodBasis(1245, null, 0, 2490) === 1245
      && periodBasis(3745, null, 1245, 4990) === 4990 && periodBasis(3000, 510, 0, 4990) === 2490 && periodBasis(0, null, 0, 990) === 0);
  // A launch-code half-price period settles on what was actually paid.
  const half = quoteChange(monthly(STARTER, at, 0.5, 20, 1245), { plan: PRO, period: "monthly" }, at);
  check("A20 a discounted period is worth what was paid (time 6.22, never the list price)", half.ok && half.quote.timeValueCents === 622);
}
{
  // Property: random states never deduct more than the exact minimum, never
  // a cent less than its floor, and the invoice is always list − deduction.
  let ok = true; let worst = "";
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const plans = [MINI, STARTER, PRO, BUSINESS];
  for (let i = 0; i < 4000; i++) {
    const from = plans[Math.floor(rnd() * 3)];
    const to = plans.filter((p) => p.priceCents > from.priceCents)[0];
    const used = Math.round(rnd() * from.credits * 100) / 100;
    const share = 0.02 + rnd() * 0.9;
    const cur = monthly(from, at, share, used);
    const q = quoteChange(cur, { plan: to, period: "monthly" }, at);
    if (!q.ok) continue;
    const timeExact = from.priceCents * (Date.parse(cur.periodEnd) - at.getTime()) / (30 * DAY);
    const creditExact = from.priceCents * Math.max(0, from.credits - used) / from.credits;
    const exact = Math.min(timeExact, creditExact);
    const d = q.quote.deductionCents;
    if (d > exact + 1e-6 || d < Math.floor(exact) - 1 || q.quote.amountDueCents !== q.quote.listPriceCents - d || q.quote.amountDueCents < MIN_CHARGE_CENTS) {
      ok = false; worst = JSON.stringify({ from: from.slug, used, share, d, exact }); break;
    }
  }
  check("A21 4000 random upgrades: deduction ≤ exact min, ≥ its floor − 1¢, due = list − deduction ≥ $0.50", ok, worst);
}
{
  const cur = monthly(STARTER, at, 0.5, 20);
  const a = quoteChange(cur, { plan: PRO, period: "monthly" }, at);
  const b = quoteChange(cur, { plan: PRO, period: "monthly" }, at);
  const c = quoteChange({ ...cur, lots: [{ ...cur.lots[0], remaining: 34 }] }, { plan: PRO, period: "monthly" }, at);
  check("A22 the same inputs at the same moment give the same fingerprint; one credit spent changes it",
    a.ok && b.ok && c.ok && quoteFingerprint(a.quote) === quoteFingerprint(b.quote) && quoteFingerprint(a.quote) !== quoteFingerprint(c.quote));
}

/* ═══ B. the server against a fake Stripe ═════════════════════════════════*/
section("B. server sequence (fake Stripe, fake database)");
process.env.STRIPE_SECRET_KEY = "sk_test_planchangefake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_planchangefake";
process.env.GROVBASE_SERVER_KEY = "p".repeat(48);

type Call = { fn: string; args: Record<string, unknown> };
type Rows = Record<string, Record<string, unknown>[]>;
function fakeDb(handlers: Record<string, (a: Record<string, unknown>) => unknown>, tables: Rows = {}) {
  const calls: Call[] = [];
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    const h = handlers[fn];
    if (!h) return { data: null, error: null };
    try { return { data: await h(args), error: null }; }
    catch (e) { return { data: null, error: { code: "P0001", message: e instanceof Error ? e.message : "x" } }; }
  };
  const from = (table: string) => {
    const filters: [string, string, unknown][] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([op, col, v]) =>
      op === "eq" ? r[col] === v : op === "in" ? (v as unknown[]).includes(r[col]) : true));
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
      in: (c: string, v: unknown) => { filters.push(["in", c, v]); return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return q;
  };
  return { db: { rpc, from } as unknown as Client, calls };
}

type SCall = { method: "GET" | "POST"; path: string; params: Record<string, FormValue> | undefined; key?: string };
function fakeStripe(routes: { method: "GET" | "POST"; path: RegExp; reply: (p: Record<string, FormValue> | undefined, path: string) => unknown }[]) {
  const calls: SCall[] = [];
  const io: StripeIO = {
    async get<T>(path: string, params?: Record<string, FormValue>): Promise<T> {
      calls.push({ method: "GET", path, params });
      const r = routes.find((x) => x.method === "GET" && x.path.test(path));
      if (!r) throw new Error(`unrouted GET ${path}`);
      return r.reply(params, path) as T;
    },
    async post<T>(path: string, params: Record<string, FormValue>, key: string): Promise<T> {
      calls.push({ method: "POST", path, params, key });
      const r = routes.find((x) => x.method === "POST" && x.path.test(path));
      if (!r) throw new Error(`unrouted POST ${path}`);
      return r.reply(params, path) as T;
    },
  };
  return { io, calls };
}

const now = Date.now();
const pStart = Math.floor((now - 15 * DAY) / 1000);
const pEnd = Math.floor((now + 15 * DAY) / 1000);
const isoS = (s: number) => new Date(s * 1000).toISOString();
const PRICES = { sm: "price_starter_m", sa: "price_starter_a", pm: "price_pro_m", pa: "price_pro_a", mm: "price_mini_m", ma: "price_mini_a" };
const planRow = (p: PlanFacts, pm: string, pa: string) => ({
  id: p.id, slug: p.slug, name: p.name, price_cents: p.priceCents, annual_price_cents: p.annualPriceCents, currency: "USD",
  monthly_credits: p.credits, bonus_credits: 0, active: true, stripe_price_id_monthly: pm, stripe_price_id_annual: pa,
  stripe_price_monthly_cents: p.priceCents, stripe_price_annual_cents: p.annualPriceCents, stripe_sync_status: "synced",
});
const TABLES: Rows = { subscription_plans: [planRow(STARTER, PRICES.sm, PRICES.sa), planRow(PRO, PRICES.pm, PRICES.pa), planRow(MINI, PRICES.mm, PRICES.ma)] };
const ctxMonthly = (over: Record<string, unknown> = {}) => ({
  enabled: true, wallet_id: "w1",
  subscription: { id: "s1", provider_subscription_id: "sub_1", plan_id: STARTER.id, status: "active", current_period_start: isoS(pStart),
    current_period_end: isoS(pEnd), cancel_at_period_end: false, stripe_price_id: PRICES.sm, stripe_customer_id: "cus_1", period: "monthly" },
  payment: { id: "pay1", provider_payment_id: "in_1", amount_cents: 2490, tax_cents: null, currency: "USD", status: "succeeded", plan_id: STARTER.id,
    billing_period: "monthly", billing_reason: "subscription_create", needs_review: false, carried_deduction_cents: 0, from_change: false, proration_lots: false },
  lots: [{ id: "lot1", amount: 55, remaining: 35, expires_at: isoS(pEnd), plan_id: STARTER.id, tranche_id: null }],
  period_lot_credits: 55, tranches: { total: 0, count: 0, pending: [], last_end: null }, inflight_usage: 0, active_change: null,
  ...over,
});
const stripeSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", currency: "usd", cancel_at_period_end: false, cancel_at: null,
  collection_method: "charge_automatically", current_period_start: pStart, current_period_end: pEnd, schedule: null,
  pending_update: null, discount: null, discounts: [],
  items: { data: [{ id: "si_1", quantity: 1, price: { id: PRICES.sm, product: "prod_starter", currency: "usd", unit_amount: 2490 } }] },
  ...over,
});
const preview = (list: number, extra: Record<string, unknown> = {}) => ({
  id: "upcoming", status: "draft", subtotal: list, total: list, amount_due: list, currency: "usd", starting_balance: 0, tax: null,
  lines: { data: [{ amount: list, proration: false, price: { id: PRICES.pm } }] }, ...extra,
});

let opened: Record<string, unknown> | null = null;
async function quoteOnce(ctx = ctxMonthly(), sub = stripeSub(), prev = preview(4990)) {
  opened = null;
  const { db, calls } = fakeDb({
    plan_change_context: () => ctx,
    plan_change_open: (a) => { opened = a.p as Record<string, unknown>; return "11111111-1111-4111-8111-111111111111"; },
  }, TABLES);
  const s = fakeStripe([
    { method: "GET", path: /^\/subscriptions\/sub_1$/, reply: () => sub },
    { method: "GET", path: /^\/invoices\/upcoming$/, reply: () => prev },
  ]);
  const res = await quotePlanChange(db, { id: "ws1", name: "Test" }, { planId: PRO.id, period: "monthly" }, s.io);
  return { res, calls, stripe: s.calls };
}
{
  const { res, stripe, calls } = await quoteOnce();
  const p = opened as Record<string, unknown> | null;
  check("B1 a quote: priced on the server, stored, 15 minutes", res.ok && res.offer.quote.amountDueCents === 4990 - res.offer.quote.deductionCents
    && res.offer.quote.deductionCents > 1200 && res.offer.quote.deductionCents <= 1245 && Boolean(p) && p?.status === "quoted", JSON.stringify(res));
  check("B2 a quote writes NOTHING to Stripe (reads the subscription and an invoice preview only)",
    stripe.every((c) => c.method === "GET") && stripe.some((c) => c.path === "/invoices/upcoming"));
  check("B3 the preview asks for proration none + a new period, i.e. the invoice the change will really make",
    stripe.some((c) => c.path === "/invoices/upcoming" && c.params?.subscription_proration_behavior === "none" && c.params?.subscription_billing_cycle_anchor === "now"));
  check("B4 the stored row carries the figures, the fingerprint, the payment and the pool",
    Boolean(p) && typeof p?.fingerprint === "string" && (p?.quote as Record<string, unknown>)?.payment_id === "pay1"
      && JSON.stringify((p?.quote as { pool?: unknown })?.pool).includes("lot1") && calls.some((c) => c.fn === "plan_change_open"));
}
{
  const { res, stripe, calls } = await quoteOnce(ctxMonthly(), stripeSub({ discounts: ["di_launch"] }));
  check("B5 a subscription with a discount (launch code) is never automated: manual review + admins told",
    !res.ok && res.reason === "manual_review" && (opened as Record<string, unknown> | null)?.status === "manual_review"
      && calls.some((c) => c.fn === "enqueue_notification") && stripe.every((c) => c.method === "GET"));
}
{
  const ctx = ctxMonthly();
  (ctx.payment as Record<string, unknown>).billing_reason = "subscription_update";
  const { res } = await quoteOnce(ctx);
  check("B6 a period bought through the old portal proration is a historical variant: manual review", !res.ok && res.reason === "manual_review");
  const { res: r2 } = await quoteOnce(ctxMonthly({ enabled: false }));
  check("B7 module OFF: refused before anything else", !r2.ok && r2.reason === "disabled");
  const { res: r3 } = await quoteOnce(ctxMonthly(), stripeSub(), preview(4990, { tax: 300, total: 5290, amount_due: 5290 }));
  check("B8 a preview that differs from the quote (tax) is not automated", !r3.ok && r3.reason === "manual_review");
  const { res: r4 } = await quoteOnce(ctxMonthly(), stripeSub({ schedule: "sub_sched_x" }));
  check("B9 a subscription already under a schedule: manual review", !r4.ok && r4.reason === "manual_review");
  const { res: r5 } = await quoteOnce(ctxMonthly(), stripeSub({ cancel_at_period_end: true }));
  check("B10 a cancellation pending: the customer is told to resume first", !r5.ok && r5.reason === "cancel_scheduled");
  const { res: r6 } = await quoteOnce(ctxMonthly({ active_change: { id: "x", status: "held" } }));
  check("B11 a change already in progress: refused", !r6.ok && r6.reason === "change_in_progress");
}

// CONFIRM — the quote from B1 is the row the confirmation reads back.
async function confirmWith(opts: {
  ctx?: ReturnType<typeof ctxMonthly>; hold?: string; invoice?: Record<string, unknown>; updateThrows?: boolean; recovered?: boolean;
}) {
  const q = await quoteOnce();
  const p = opened as Record<string, unknown>;
  const quote = p.quote as Record<string, unknown>;
  const row = { id: "11111111-1111-4111-8111-111111111111", workspace_id: "ws1", status: "quoted", kind: p.kind, timing: p.timing,
    provider_subscription_id: "sub_1", to_plan_id: PRO.id, to_period: "monthly", to_price_id: PRICES.pm, from_price_id: PRICES.sm,
    currency: "USD", list_price_cents: p.list_price_cents, deduction_cents: p.deduction_cents, amount_due_cents: p.amount_due_cents,
    fingerprint: p.fingerprint, quoted_at: quote.quoted_at, expires_at: new Date(Date.now() + 600_000).toISOString(), effective_at: null,
    stripe_coupon_id: null, stripe_invoice_id: null, stripe_schedule_id: null };
  const deduction = Number(p.deduction_cents);
  const { db, calls } = fakeDb({
    plan_change_context: () => opts.ctx ?? ctxMonthly(),
    plan_change_hold: () => ({ status: opts.hold ?? "held" }),
    plan_change_attach: () => "ok",
    plan_change_release: (a) => ({ status: a.p_status }),
  }, { ...TABLES, plan_changes: [row] });
  const goodInvoice = {
    id: "in_up", status: "open", subtotal: 4990, total: 4990 - deduction, amount_due: 4990 - deduction, currency: "usd",
    starting_balance: 0, tax: null, total_discount_amounts: [{ amount: deduction }], billing_reason: "subscription_update",
    lines: { data: [{ amount: 4990, proration: false, price: { id: PRICES.pm } }] },
    payment_intent: { id: "pi_up", status: "requires_action", client_secret: "pi_up_secret_x", amount: 4990 - deduction },
  };
  let updated = false;
  let discounted = false;
  const s = fakeStripe([
    { method: "GET", path: /^\/subscriptions\/sub_1$/, reply: () => (opts.recovered && updated
      ? stripeSub({ pending_update: { expires_at: 1 }, latest_invoice: opts.invoice ?? goodInvoice, discounts: discounted ? ["di_x"] : [] })
      : stripeSub({ discounts: discounted ? ["di_x"] : [] })) },
    { method: "GET", path: /^\/invoices\/upcoming$/, reply: () => preview(4990) },
    { method: "GET", path: /^\/prices\/price_pro_m$/, reply: () => ({ id: PRICES.pm, product: "prod_pro", currency: "usd", unit_amount: 4990 }) },
    { method: "GET", path: /^\/invoices\/in_up$/, reply: () => ({ ...(opts.invoice ?? goodInvoice), status: "open" }) },
    { method: "POST", path: /^\/coupons$/, reply: () => ({ id: "co_1" }) },
    { method: "POST", path: /^\/invoices\/in_up\/void$/, reply: () => ({ id: "in_up", status: "void" }) },
    { method: "POST", path: /^\/subscriptions\/sub_1$/, reply: (params) => {
      if (params && "items" in params) {
        updated = true;
        if (opts.updateThrows) throw new Error("socket hang up");
        return stripeSub({ pending_update: { expires_at: 1 }, latest_invoice: opts.invoice ?? goodInvoice });
      }
      discounted = params?.discounts !== "";
      return stripeSub({ discounts: discounted ? ["di_x"] : [] });
    } },
  ]);
  const res = await confirmPlanChange(db, { id: "ws1", name: "Test" }, row.id, s.io);
  return { res, calls, stripe: s.calls, deduction, quoteStripe: q.stripe };
}
{
  const { res, calls, stripe, deduction } = await confirmWith({});
  const writes = stripe.filter((c) => c.method === "POST");
  const coupon = writes.find((c) => c.path === "/coupons");
  const discount = writes.find((c) => c.path === "/subscriptions/sub_1" && c.params && "discounts" in c.params);
  const update = writes.find((c) => c.path === "/subscriptions/sub_1" && c.params && "items" in c.params);
  check("B12 confirm: the pool is reserved BEFORE any Stripe write",
    calls.findIndex((c) => c.fn === "plan_change_hold") >= 0 && writes.length > 0
      && calls.findIndex((c) => c.fn === "plan_change_hold") < calls.findIndex((c) => c.fn === "plan_change_attach"));
  check("B13 the deduction is a one-off coupon: amount_off = deduction, once, max 1 redemption, only the new plan's product",
    Boolean(coupon) && coupon?.params?.amount_off === deduction && coupon?.params?.duration === "once" && coupon?.params?.max_redemptions === 1
      && JSON.stringify(coupon?.params?.applies_to) === JSON.stringify({ products: ["prod_pro"] }) && coupon?.key?.startsWith("plan-change-coupon:") === true);
  check("B14 the coupon is attached by a non-billing update (proration none), before the price change",
    Boolean(discount) && discount?.params?.proration_behavior === "none" && writes.indexOf(discount!) < writes.indexOf(update!));
  check("B15 the change: same subscription item → new price, proration NONE, new period, pending_if_incomplete",
    Boolean(update) && JSON.stringify(update?.params?.items) === JSON.stringify([{ id: "si_1", price: PRICES.pm }])
      && update?.params?.proration_behavior === "none" && update?.params?.billing_cycle_anchor === "now"
      && update?.params?.payment_behavior === "pending_if_incomplete" && update?.key === "plan-change:11111111-1111-4111-8111-111111111111");
  check("B16 API 2024-06-20: `discounts` is NEVER sent together with payment_behavior",
    writes.every((c) => !(c.params && "discounts" in c.params && "payment_behavior" in c.params)));
  check("B17 ONE subscription: nothing ever POSTs /subscriptions (create)", writes.every((c) => c.path !== "/subscriptions"));
  check("B18 never Stripe's own proration on top of ours", writes.every((c) => !["create_prorations", "always_invoice"].includes(String(c.params?.proration_behavior ?? ""))));
  check("B19 every Stripe write carries an idempotency key from the change id", writes.every((c) => typeof c.key === "string" && c.key.includes("11111111-1111")));
  check("B20 3-D Secure: the client secret goes back, nothing is granted here",
    res.ok && res.state === "requires_action" && "clientSecret" in res && res.clientSecret === "pi_up_secret_x"
      && !calls.some((c) => c.fn === "stripe_settle_v2" || c.fn === "plan_change_settle"));
  check("B21 the invoice and its PaymentIntent are recorded on the change", calls.some((c) => c.fn === "plan_change_attach"
    && (c.args.p as Record<string, unknown>)?.status === "awaiting_payment" && (c.args.p as Record<string, unknown>)?.invoice === "in_up"));
}
{
  const { res, calls, stripe } = await confirmWith({ invoice: {
    id: "in_up", status: "open", subtotal: 4990, total: 4990, amount_due: 4990, currency: "usd", starting_balance: 0, tax: null,
    total_discount_amounts: [], lines: { data: [{ amount: 4990, proration: false, price: { id: PRICES.pm } }] },
    payment_intent: { id: "pi_up", status: "requires_action", client_secret: "s", amount: 4990 } } });
  check("B22 an invoice that is not the quote is voided, the coupon removed, the pool released, admins told",
    !res.ok && res.reason === "manual_review" && stripe.some((c) => c.path === "/invoices/in_up/void")
      && stripe.some((c) => c.method === "POST" && c.params?.discounts === "")
      && calls.some((c) => c.fn === "plan_change_release" && c.args.p_status === "manual_review")
      && calls.some((c) => c.fn === "enqueue_notification"));
}
{
  const { res, calls } = await confirmWith({ updateThrows: true, recovered: true });
  check("B23 a timeout AFTER Stripe accepted the change is recovered (the pending invoice is found and checked)",
    res.ok && res.state === "requires_action" && !calls.some((c) => c.fn === "plan_change_release"));
  const { res: r2, calls: c2, stripe: s2 } = await confirmWith({ updateThrows: true, recovered: false });
  check("B24 a change Stripe never made: coupon removed, pool released, nothing charged",
    !r2.ok && r2.reason === "stripe_error" && c2.some((c) => c.fn === "plan_change_release" && c.args.p_status === "failed")
      && s2.some((c) => c.method === "POST" && c.params?.discounts === ""));
}
{
  const ctx = ctxMonthly();
  (ctx.lots as { remaining: number }[])[0].remaining = 34;
  const { res, calls, stripe } = await confirmWith({ ctx });
  check("B25 a credit spent since the quote: stale, closed, NO Stripe write",
    !res.ok && res.reason === "quote_changed" && calls.some((c) => c.fn === "plan_change_release" && c.args.p_status === "expired")
      && !stripe.some((c) => c.method === "POST"));
  const { res: r2, stripe: s2 } = await confirmWith({ hold: "inflight_usage" });
  check("B26 a generation running: refused at the reservation, no Stripe write", !r2.ok && r2.reason === "inflight_usage" && !s2.some((c) => c.method === "POST"));
}
{
  // A scheduled change: annual PRO → annual Starter.
  const ctx = ctxMonthly({
    subscription: { ...ctxMonthly().subscription, plan_id: PRO.id, stripe_price_id: PRICES.pa, period: "annual",
      current_period_start: isoS(Math.floor((now - 60 * DAY) / 1000)), current_period_end: isoS(Math.floor((now + 305 * DAY) / 1000)) },
    payment: { ...ctxMonthly().payment, amount_cents: 49900, plan_id: PRO.id, billing_period: "annual" },
    lots: [{ id: "lotA", amount: 125, remaining: 100, expires_at: isoS(Math.floor((now + 10 * DAY) / 1000)), plan_id: PRO.id, tranche_id: "tr2" }],
    period_lot_credits: 0, tranches: { total: 1500, count: 12, pending: [{ id: "tr3", credits: 125, starts_at: isoS(Math.floor((now + 10 * DAY) / 1000)), tranche_no: 3 }],
      last_end: isoS(Math.floor((now + 305 * DAY) / 1000)) },
  });
  const sub = stripeSub({ current_period_start: Math.floor((now - 60 * DAY) / 1000), current_period_end: Math.floor((now + 305 * DAY) / 1000),
    items: { data: [{ id: "si_1", quantity: 1, price: { id: PRICES.pa, product: "prod_pro", currency: "usd", unit_amount: 49900 } }] } });
  const { db, calls } = fakeDb({
    plan_change_context: () => ctx,
    plan_change_open: (a) => { opened = a.p as Record<string, unknown>; return "22222222-2222-4222-8222-222222222222"; },
    plan_change_hold: () => ({ status: "held" }), plan_change_attach: () => "ok",
  }, TABLES);
  const s = fakeStripe([
    { method: "GET", path: /^\/subscriptions\/sub_1$/, reply: () => sub },
    { method: "POST", path: /^\/subscription_schedules$/, reply: () => ({ id: "sub_sched_1", status: "active", phases: [{ start_date: 1, end_date: 2, items: [{ price: PRICES.pa }] }] }) },
    { method: "POST", path: /^\/subscription_schedules\/sub_sched_1$/, reply: () => ({ id: "sub_sched_1" }) },
  ]);
  const q = await quotePlanChange(db, { id: "ws1" }, { planId: STARTER.id, period: "annual" }, s.io);
  check("B27 annual → lower annual is quoted for the period end, nothing to pay today",
    q.ok && q.offer.quote.timing === "period_end" && q.offer.quote.deductionCents === 0 && !s.calls.some((c) => c.path === "/invoices/upcoming"));
  const p = opened as unknown as Record<string, unknown>;
  const row = { id: "22222222-2222-4222-8222-222222222222", workspace_id: "ws1", status: "quoted", to_plan_id: STARTER.id, to_period: "annual",
    to_price_id: PRICES.sa, fingerprint: p.fingerprint, quoted_at: (p.quote as Record<string, unknown>).quoted_at,
    expires_at: new Date(Date.now() + 600_000).toISOString(), provider_subscription_id: "sub_1" };
  const { db: db2, calls: c2 } = fakeDb({
    plan_change_context: () => ctx, plan_change_hold: () => ({ status: "held" }), plan_change_attach: () => "ok",
  }, { ...TABLES, plan_changes: [row] });
  const res = await confirmPlanChange(db2, { id: "ws1" }, row.id, s.io);
  const phases = s.calls.find((c) => c.path === "/subscription_schedules/sub_sched_1");
  check("B28 confirmed as a Subscription Schedule: current phase to its end, then ONE phase of the new price, then release",
    res.ok && res.state === "scheduled" && phases?.params?.end_behavior === "release"
      && JSON.stringify((phases?.params?.phases as Record<string, unknown>[])?.[1]?.items) === JSON.stringify([{ price: PRICES.sa, quantity: 1 }])
      && (phases?.params?.phases as Record<string, unknown>[])?.[1]?.iterations === 1
      && c2.some((c) => c.fn === "plan_change_attach" && (c.args.p as Record<string, unknown>)?.status === "scheduled"));
  check("B29 a scheduled change creates no coupon and no price update now",
    !s.calls.some((c) => c.path === "/coupons") && !s.calls.some((c) => c.path === "/subscriptions/sub_1" && c.method === "POST"));
  void calls;
}
{
  // Cancel / sweep.
  const base = { workspace_id: "ws1", provider_subscription_id: "sub_1", stripe_coupon_id: "co_1" };
  const { db, calls } = fakeDb({ plan_change_release: (a) => ({ status: a.p_status }) }, {
    plan_changes: [
      { ...base, id: "33333333-3333-4333-8333-333333333333", status: "scheduled", stripe_schedule_id: "sub_sched_1" },
      { ...base, id: "44444444-4444-4444-8444-444444444444", status: "awaiting_payment", stripe_invoice_id: "in_paid" },
    ],
  });
  const s = fakeStripe([
    { method: "POST", path: /^\/subscription_schedules\/sub_sched_1\/release$/, reply: () => ({ id: "sub_sched_1" }) },
    { method: "GET", path: /^\/invoices\/in_paid$/, reply: () => ({ id: "in_paid", status: "paid" }) },
  ]);
  const a = await cancelPlanChange(db, { id: "ws1" }, "33333333-3333-4333-8333-333333333333", s.io);
  check("B30 cancelling a scheduled change releases the Stripe schedule (the subscription is untouched)",
    a.ok && s.calls.some((c) => c.path === "/subscription_schedules/sub_sched_1/release") && calls.some((c) => c.fn === "plan_change_release" && c.args.p_status === "canceled"));
  const b = await cancelPlanChange(db, { id: "ws1" }, "44444444-4444-4444-8444-444444444444", s.io);
  check("B31 a change already paid cannot be cancelled into a free upgrade", !b.ok && b.reason === "already_paid"
    && calls.filter((c) => c.fn === "plan_change_release").length === 1);

  const { db: db2, calls: c2 } = fakeDb({
    plan_change_due: () => [
      { id: "55555555-5555-4555-8555-555555555555", status: "awaiting_payment", subscription: "sub_1", invoice: "in_open", coupon: "co_1", schedule: null },
      { id: "66666666-6666-4666-8666-666666666666", status: "awaiting_payment", subscription: "sub_2", invoice: "in_paid", coupon: null, schedule: null },
    ],
    plan_change_release: (x) => ({ status: x.p_status }),
  });
  const s2 = fakeStripe([
    { method: "GET", path: /^\/invoices\/in_open$/, reply: () => ({ id: "in_open", status: "open" }) },
    { method: "GET", path: /^\/invoices\/in_paid$/, reply: () => ({ id: "in_paid", status: "paid" }) },
    { method: "POST", path: /^\/invoices\/in_open\/void$/, reply: () => ({ id: "in_open", status: "void" }) },
    { method: "GET", path: /^\/subscriptions\/sub_1$/, reply: () => stripeSub({ discounts: ["di_co_1"] }) },
    { method: "POST", path: /^\/subscriptions\/sub_1$/, reply: () => stripeSub() },
  ]);
  const sw = await sweepPlanChanges(db2, s2.io);
  check("B32 the sweep voids the open invoice FIRST, removes the coupon, then releases",
    sw.released === 1 && s2.calls.findIndex((c) => c.path === "/invoices/in_open/void") < s2.calls.findIndex((c) => c.method === "POST" && c.params?.discounts === "")
      && c2.some((c) => c.fn === "plan_change_release" && c.args.p_change_id === "55555555-5555-4555-8555-555555555555"));
  check("B33 …and leaves a PAID one for the webhook (no release)", sw.skipped === 1
    && !c2.some((c) => c.fn === "plan_change_release" && c.args.p_change_id === "66666666-6666-4666-8666-666666666666"));
}
{
  // The admin switch and the Customer Portal.
  const before = { enabled: true, default_allowed_updates: ["price"], proration_behavior: "always_invoice", products: [{ product: "grovbase_plan_pro", prices: ["price_pro_m"] }] };
  const { db, calls } = fakeDb({ plan_changes_set: (a) => ({ enabled: a.p_enabled }) }, {
    app_settings: [{ key: "plan_changes", value: { enabled: true, portal: { before: [{ id: "bpc_1", subscription_update: before }] } } }],
  });
  const s = fakeStripe([
    { method: "GET", path: /^\/billing_portal\/configurations$/, reply: () => ({ data: [
      { id: "bpc_1", active: true, is_default: true, features: { subscription_update: before } },
      { id: "bpc_2", active: true, is_default: false, features: { subscription_update: { enabled: false } } } ] }) },
    { method: "POST", path: /^\/billing_portal\/configurations\/bpc_\d$/, reply: () => ({}) },
  ]);
  const on = await setPlanChangesEnabled(db, true, s.io);
  const offPosts = s.calls.filter((c) => c.method === "POST");
  check("B34 ON closes ONLY the portal's plan change (card, invoices, cancel untouched) and records what it was",
    on.ok && offPosts.length === 1 && offPosts[0].path === "/billing_portal/configurations/bpc_1"
      && JSON.stringify(offPosts[0].params) === JSON.stringify({ features: { subscription_update: { enabled: false } } })
      && calls.some((c) => c.fn === "plan_changes_set" && JSON.stringify(c.args.p_portal).includes("always_invoice")));
  const off = await setPlanChangesEnabled(db, false, s.io);
  const restore = s.calls.filter((c) => c.method === "POST").slice(1);
  check("B35 OFF restores the portal's plan change exactly as it was",
    off.ok && restore.length === 1 && JSON.stringify(restore[0].params).includes("always_invoice") && JSON.stringify(restore[0].params).includes("grovbase_plan_pro"));
}

/* ═══ C. the webhook ══════════════════════════════════════════════════════*/
section("C. webhook");
{
  const { db, calls } = fakeDb({
    grovnews_is_billing_object: () => false,
    stripe_workspace_for: () => "ws1",
    stripe_plan_for_price: () => ({ id: PRO.id, name: "Pro", credits: 125, period: "monthly", price_cents: 4990 }),
    stripe_settle_v2: () => ({ status: "applied", payment_id: "pay2" }),
    plan_change_settle: () => ({ status: "completed", change_id: "c1", late: false }),
  });
  const ev = { id: "evt_x", type: "invoice.paid", data: { object: {
    id: "in_up", customer: "cus_1", amount_paid: 3745, currency: "usd", billing_reason: "subscription_update", subscription: "sub_1",
    subscription_details: { metadata: { type: "subscription", grovbase_workspace_id: "ws1" } }, metadata: { grovbase_workspace_id: "ws1" },
    lines: { data: [{ amount: 4990, proration: false, price: { id: PRICES.pm }, period: { start: Math.floor(now / 1000), end: Math.floor((now + 30 * DAY) / 1000) } }] },
  } } };
  const r = await handleStripeEvent(db, "tok", ev);
  const iSettle = calls.findIndex((c) => c.fn === "stripe_settle_v2");
  const iChange = calls.findIndex((c) => c.fn === "plan_change_settle");
  check("C1 invoice.paid: the ledger settles first (stripe_settle_v2), then the change closes", r.outcome === "applied" && iSettle >= 0 && iChange > iSettle);
  check("C2 the change is matched by the invoice, the subscription and the billed price",
    calls[iChange]?.args.p_invoice === "in_up" && calls[iChange]?.args.p_subscription === "sub_1" && calls[iChange]?.args.p_price_id === PRICES.pm
      && calls[iChange]?.args.p_payment_id === "pay2");
  const grants = (calls[iSettle]?.args.p_grants ?? []) as { type: string; credits?: number }[];
  check("C3 the new plan's credits come from the invoice line (full 125, the coupon does not shrink them)",
    grants.length === 1 && grants[0].type === "lot" && grants[0].credits === 125);
  const { db: bad } = fakeDb({
    grovnews_is_billing_object: () => false, stripe_workspace_for: () => "ws1",
    stripe_plan_for_price: () => ({ id: PRO.id, name: "Pro", credits: 125, period: "monthly", price_cents: 4990 }),
    stripe_settle_v2: () => ({ status: "applied", payment_id: "pay2" }),
    plan_change_settle: () => { throw new Error("db down"); },
  });
  let threw = false;
  try { await handleStripeEvent(bad, "tok", ev); } catch { threw = true; }
  check("C4 a failed change settlement throws → 500 → Stripe retries (the ledger part is idempotent)", threw);
  let none = "";
  try { none = await settlePlanChange(fakeDb({}).db, "tok", { subscriptionId: null, invoiceId: "in", paymentId: null, priceId: null }); } catch { none = "threw"; }
  check("C5 an invoice without a subscription is not a change", none === "none");
  check("C6 the endpoint's event list is unchanged (9 events)", HANDLED_EVENT_TYPES.length === 9);
  const src = readFileSync("lib/server/stripe-webhook.ts", "utf8");
  check("C7 the after-sale report is scheduled AFTER the change settles (it reads the change's figures)",
    src.indexOf("await settlePlanChange(") > 0 && src.indexOf("await settlePlanChange(") < src.indexOf("scheduleSaleReport(supabase, (settled"));
  {
    // The after-sale report of a change, through the real renderers.
    const snap = { now: new Date().toISOString(), today_start: new Date().toISOString(), month_start: new Date().toISOString(),
      history_start: new Date().toISOString(), settings: { id: "main", enabled: true, buffer_percent: 20, horizon_days: 30, scenario: "standard",
        cautious_factor: 1.5, history_days: 90, min_history_credits: 50, daily_report_hour: 23, report_timezone: "Europe/Warsaw",
        hourly_skip_empty: true, alert_repeat_hours: 6 }, spend: [], pools: null, tranches: null, credits_month: null,
      expired_history: { lots: 0, granted: 0, unused: 0 }, sales: { h1: { count: 0, revenue: {} }, today: { count: 0, revenue: {} }, month: { count: 0, revenue: {} } },
      providers: [], models: [], unit_prices: [] } as unknown as ReserveSnapshot;
    const facts: SaleFacts = { id: "p1", kind: "subscription", amount_cents: 3745, currency: "USD", billing_period: "monthly",
      billing_reason: "subscription_update", plan_slug: "pro", plan_name: "Pro", internal: false, credits_now: 125, credits_scheduled: 0,
      plan_change: { kind: "upgrade", from_plan: "Starter", from_period: "monthly", to_plan: "Pro", to_period: "monthly",
        list_price_cents: 4990, deduction_cents: 1245, amount_due_cents: 3745, closed_credits: 35, late: false } };
    const msg = saleMessage(facts, computeReserves(snap));
    const tg = renderNotification({ event: msg.type, icon: msg.icon, title: msg.title, rows: msg.rows, details: msg.details, footer: msg.footer, data: msg.data }).text;
    check("C9 Telegram: a finance report keeps its labels (no event-card re-labelling)",
      tg.includes("Zmiana:</b>") && tg.includes("Starter (miesięcznie) → Pro") && tg.includes("Odliczenie:</b> $12.45")
        && tg.includes("Łącznie do zabezpieczenia") && !tg.includes("Następna płatność") && !tg.includes("Saldo po zakupie") && !tg.includes("więcej w panelu"), tg);
    const twin = renderNotification({ event: "finance.reserve_daily", title: "t", rows: [["🧾 Przychód", "$0.00"], ["🔌 Koszty API (dziś)", "$0.00"], ["🪙 Kredyty", "0"]] }).text;
    const card = renderNotification({ event: "payment.received", title: "t", rows: [["💰 Kwota", "$0.00"], ["🧾 Id", "$0.00"]] }).text;
    check("C10 Telegram: equal values are NOT merged in a finance table (event cards keep their dedupe)",
      (twin.match(/\$0\.00/g) ?? []).length === 2 && twin.includes("Przychód:</b>") && twin.includes("Koszty API (dziś):</b>")
        && (card.match(/\$0\.00/g) ?? []).length === 1, twin);
    const mail = renderAdminNotification({ eventType: msg.type, occurredAt: "16.11.2026, 10:00", title: msg.title, icon: msg.icon, rows: msg.rows ?? [] });
    check("C11 e-mail: one brand suffix in the subject, every row printed", mail.subject === "💰 Nowa sprzedaż — GrovBase"
      && mail.html.includes("Odliczenie") && mail.html.includes("Zamknięte kredyty starej puli"), mail.subject);
  }
  check("C8 Stripe stays pinned to 2024-06-20", /API_VERSION\s*=\s*"2024-06-20"/.test(readFileSync("lib/stripe/client.ts", "utf8")));
}

/* ═══ D. i18n ═════════════════════════════════════════════════════════════*/
section("D. i18n");
{
  const dicts = ["pl", "en", "de"].map((l) => [l, JSON.parse(readFileSync(`lib/i18n/dictionaries/${l}.json`, "utf8"))] as const);
  const has = (d: Record<string, unknown>, key: string): boolean => {
    let node: unknown = d;
    const parts = key.split(".");
    for (let i = 0; i < parts.length; i++) {
      if (!node || typeof node !== "object") return false;
      const rest = parts.slice(i).join(".");
      if (typeof (node as Record<string, unknown>)[rest] === "string") return true;
      node = (node as Record<string, unknown>)[parts[i]];
    }
    return typeof node === "string";
  };
  const files = ["components/plan/plan-change.tsx", "components/plan/plan-cards.tsx", "components/plan/plan-comparison.tsx",
    "components/admin/plan-changes.tsx", "app/admin/finance/zmiany-planow/page.tsx", "components/admin/finance-tabs.tsx"];
  const keys = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/t\(\s*"((?:pricing\.change|admin\.planChanges|admin\.reserves\.tab)\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]);
  for (const s of ["quoted", "held", "awaiting_payment", "scheduled", "completed", "released", "canceled", "expired", "failed", "manual_review"]) keys.add(`admin.planChanges.status.${s}`);
  for (const k of ["upgrade", "downgrade", "to_annual", "to_monthly"]) keys.add(`admin.planChanges.kind.${k}`);
  for (const k of ["immediate", "period_end"]) keys.add(`admin.planChanges.timing.${k}`);
  for (const p of ["monthly", "annual"]) { keys.add(`admin.planChanges.period.${p}`); keys.add(`pricing.change.period.${p}`); }
  for (const r of ["disabled", "payments_disabled", "no_subscription", "subscription_not_active", "cancel_scheduled", "change_in_progress", "inflight_usage",
    "unknown_plan", "not_on_sale", "same_plan", "too_close_to_renewal", "period_ended", "manual_review", "quote_expired", "quote_changed", "stripe_error",
    "payment_failed", "already_paid", "not_authorized", "not_found", "generic"]) keys.add(`pricing.change.refuse.${r}`);
  keys.add("comm.ev.planChangeReview");
  for (const k of ["creditsAnnualLater", "creditsMonthlyLater", "creditsAnnual", "creditsMonthly", "ctaUpgrade", "ctaDowngrade", "ctaToAnnual", "ctaToMonthly"]) keys.add(`pricing.change.${k}`);
  const missing: string[] = [];
  for (const [l, d] of dicts) for (const k of keys) if (!has(d, k)) missing.push(`${l}:${k}`);
  check(`D1 all ${keys.size} keys exist in PL, EN and DE`, missing.length === 0, missing.slice(0, 8).join(", "));
}

console.log(`\n${failed === 0 ? `All plan change tests passed (${passed} checks).` : `${failed} of ${passed + failed} PLAN CHANGE TEST(S) FAILED`}`);
if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
