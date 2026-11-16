import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { Json } from "@/lib/database.types";
import { stripeGet, stripePost, StripeApiError, type FormValue } from "@/lib/stripe/client";
import { paymentsEnabled } from "@/lib/stripe/config";
import { sellable } from "@/lib/server/stripe-pricing";
import { annualOnSale } from "@/lib/server/pricing-offer";
import { dispatchToken } from "@/lib/server/server-token";
import { notify } from "@/lib/server/notify";
import {
  periodBasis, priceFor, quoteChange, quoteFingerprint,
  type BillingPeriod, type ChangeQuote, type CurrentSubscription, type PlanFacts,
} from "@/lib/billing/plan-change";

/**
 * SMART SUBSCRIPTION MANAGEMENT — the server side of a plan change (0181).
 *
 * The arithmetic is lib/billing/plan-change.ts; the ledger is the database's
 * (plan_change_hold / _release / _settle); this module is the sequence around
 * them and the only code that talks to Stripe about a change.
 *
 * ONE SUBSCRIPTION, ALWAYS. A change UPDATES the customer's existing Stripe
 * subscription — never a second one — and every amount is computed here:
 *
 *   immediate (upgrade, monthly downgrade, monthly → annual)
 *     1. the pool is reserved (plan_change_hold) BEFORE any money moves;
 *     2. the deduction becomes a ONE-OFF COUPON (amount_off, duration once,
 *        max_redemptions 1, only for the new plan's product) attached to the
 *        subscription by a non-billing update — Stripe API 2024-06-20, which
 *        this app is pinned to, does not accept `discounts` together with
 *        `payment_behavior: pending_if_incomplete` (added in 2026-05-27);
 *     3. the price changes with proration_behavior none (Stripe's own credit
 *        for unused time is OFF — our deduction is the only one, never both),
 *        billing_cycle_anchor now (a new period starts) and
 *        payment_behavior pending_if_incomplete: the subscription changes ONLY
 *        if the invoice is paid; a failed or abandoned payment leaves it as it
 *        was (Stripe voids the invoice when the pending update expires);
 *     4. the invoice is checked against the quote line by line; any difference
 *        voids it, removes the coupon, releases the pool and asks an admin;
 *     5. SCA: a payment that needs the customer gets its client secret back to
 *        the browser; nothing is granted until the SIGNED WEBHOOK settles the
 *        invoice (stripe_settle_v2 grants the new plan from its line), and
 *        plan_change_settle then closes the change. success_url, the browser
 *        and this module never grant anything.
 *
 *   at period end (annual → lower annual, annual → monthly)
 *     a Subscription Schedule: the current phase runs to its end, then one
 *     phase of the new price, then the schedule releases the subscription.
 *     Nothing is charged or reserved today.
 *
 * Every Stripe write carries an idempotency key derived from the change id, so
 * a retried request repeats nothing. A failure at any step undoes the steps
 * before it (coupon removed, invoice voided, pool released) — and a payment
 * that went through anyway is settled by the webhook, which also handles a
 * payment arriving after a release (plan_change_settle closes it again).
 */

export type StripeIO = {
  get<T>(path: string, params?: Record<string, FormValue>): Promise<T>;
  post<T>(path: string, params: Record<string, FormValue>, idempotencyKey: string): Promise<T>;
};
const LIVE: StripeIO = { get: stripeGet, post: stripePost };

type WorkspaceRef = { id: string; name?: string | null };

/* ── Stripe shapes this module reads (API 2024-06-20) ──────────────────────*/

type SPrice = { id: string; product: string | { id: string }; currency: string; unit_amount: number | null; recurring?: { interval?: string } | null };
type SItem = { id: string; price: SPrice; quantity?: number; current_period_start?: number; current_period_end?: number };
type SPaymentIntent = { id: string; status: string; client_secret: string | null; amount: number };
type SInvoiceLine = { amount: number; proration?: boolean; price?: { id: string } | null; period?: { start?: number; end?: number } };
type SInvoice = {
  id: string; status: string | null; total: number; subtotal: number; amount_due: number; currency: string;
  starting_balance?: number | null; tax?: number | null; billing_reason?: string | null;
  total_discount_amounts?: { amount: number }[] | null;
  lines: { data: SInvoiceLine[] };
  payment_intent?: string | SPaymentIntent | null;
};
type SSubscription = {
  id: string; status: string; customer: string | { id: string }; currency: string;
  cancel_at_period_end: boolean; cancel_at: number | null; collection_method: string;
  current_period_start?: number; current_period_end?: number;
  schedule: string | { id: string } | null;
  pending_update: unknown | null;
  discount?: unknown | null;
  discounts?: unknown[] | null;
  items: { data: SItem[] };
  latest_invoice?: string | SInvoice | null;
};
type SSchedule = { id: string; status: string; phases: { start_date: number; end_date: number; items: { price: string | { id: string } }[] }[] };
type SPortalConfig = {
  id: string; active: boolean; is_default: boolean;
  features: { subscription_update?: { enabled: boolean; default_allowed_updates?: string[]; proration_behavior?: string;
    products?: { product: string; prices: string[] }[] } };
};

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

/* ── what the customer is offered ──────────────────────────────────────────*/

export type PlanChangeRefusal =
  | "disabled" | "payments_disabled" | "no_server_key" | "no_subscription" | "subscription_not_active"
  | "cancel_scheduled" | "change_in_progress" | "inflight_usage" | "unknown_plan" | "not_on_sale"
  | "same_plan" | "too_close_to_renewal" | "period_ended" | "manual_review" | "quote_expired"
  | "quote_changed" | "not_found" | "stripe_error" | "payment_failed" | "already_paid" | "not_authorized";

/** What the modal shows — every figure computed here, none in the browser. */
export type PlanChangeOffer = {
  changeId: string;
  expiresAt: string;
  quote: ChangeQuote;
};

export type QuoteOutcome = { ok: true; offer: PlanChangeOffer } | { ok: false; reason: PlanChangeRefusal };

export type ConfirmOutcome =
  | { ok: true; state: "paid" | "processing" | "scheduled"; changeId: string; effectiveAt?: string }
  | { ok: true; state: "requires_action" | "requires_payment_method"; changeId: string; clientSecret: string }
  | { ok: false; reason: PlanChangeRefusal };

type PlanRow = {
  id: string; slug: string; name: string; price_cents: number; annual_price_cents: number | null; currency: string;
  monthly_credits: number; bonus_credits: number; active: boolean;
  stripe_price_id_monthly: string | null; stripe_price_id_annual: string | null;
  stripe_price_monthly_cents: number | null; stripe_price_annual_cents: number | null; stripe_sync_status: string | null;
};

type Context = {
  enabled: boolean;
  wallet_id: string | null;
  subscription: null | {
    id: string; provider_subscription_id: string; plan_id: string; status: string;
    current_period_start: string | null; current_period_end: string | null; cancel_at_period_end: boolean;
    stripe_price_id: string | null; stripe_customer_id: string | null; period: BillingPeriod | null;
  };
  payment: null | {
    id: string; provider_payment_id: string; amount_cents: number; tax_cents: number | null; currency: string; status: string;
    plan_id: string | null; billing_period: string | null; billing_reason: string | null; needs_review: boolean;
    carried_deduction_cents: number; from_change: boolean; proration_lots: boolean;
  };
  lots: { id: string; amount: number; remaining: number; expires_at: string; plan_id: string | null; tranche_id: string | null }[];
  period_lot_credits: number;
  tranches: { total: number; count: number; pending: { id: string; credits: number; starts_at: string; tranche_no: number }[]; last_end: string | null };
  inflight_usage: number;
  active_change: null | { id: string; status: string; kind: string; timing: string; to_plan_id: string; to_period: string;
    effective_at: string | null; amount_due_cents: number; currency: string };
};

const PLAN_COLUMNS = "id, slug, name, price_cents, annual_price_cents, currency, monthly_credits, bonus_credits, active, stripe_price_id_monthly, stripe_price_id_annual, stripe_price_monthly_cents, stripe_price_annual_cents, stripe_sync_status";

const facts = (p: PlanRow): PlanFacts => ({
  id: p.id, slug: p.slug, name: p.name, priceCents: p.price_cents, annualPriceCents: p.annual_price_cents ?? 0,
  currency: p.currency, credits: Number(p.monthly_credits) + Number(p.bonus_credits),
});
const priceIdFor = (p: PlanRow, period: BillingPeriod) => (period === "annual" ? p.stripe_price_id_annual : p.stripe_price_id_monthly);
const DAY = 24 * 3600 * 1000;

/** Is the module on? (app_settings.plan_changes.enabled, default false) */
export async function planChangesEnabled(supabase: Client): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("plan_changes_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}

async function readContext(supabase: Client, token: string, workspaceId: string): Promise<Context> {
  const { data, error } = await supabase.rpc("plan_change_context", { p_token: token, p_workspace_id: workspaceId });
  if (error || !data) throw new Error(`context_failed:${error?.code ?? "empty"}`);
  return data as unknown as Context;
}

/**
 * A change this module does not automate — an unusual subscription (a portal
 * proration from before, a discount, a schedule, a refunded period…). It is
 * recorded and the administrators are told; the customer is told a person
 * will handle it. Never throws.
 */
async function manualReview(
  supabase: Client, token: string, workspace: WorkspaceRef, reason: string,
  row: { subscription: string; toPlan: PlanRow; toPeriod: BillingPeriod; fromPlanId?: string | null; fromPeriod?: BillingPeriod | null; fromPriceId?: string | null },
): Promise<void> {
  try {
    const price = priceFor(facts(row.toPlan), row.toPeriod);
    await supabase.rpc("plan_change_open", {
      p_token: token, p_workspace_id: workspace.id,
      p: {
        status: "manual_review", review_reason: reason.slice(0, 80), provider_subscription_id: row.subscription,
        kind: "upgrade", timing: "immediate", from_plan_id: row.fromPlanId ?? "", from_period: row.fromPeriod ?? "",
        from_price_id: row.fromPriceId ?? "", to_plan_id: row.toPlan.id, to_period: row.toPeriod,
        to_price_id: priceIdFor(row.toPlan, row.toPeriod) ?? "-", currency: row.toPlan.currency,
        list_price_cents: Math.max(1, price), amount_due_cents: Math.max(1, price),
      },
    });
  } catch (e) {
    console.error("plan_change.review_record_failed", e instanceof Error ? e.message : "unknown");
  }
  await notify(supabase, {
    type: "finance.plan_change_review",
    icon: "🧾",
    title: "Zmiana planu do ręcznej obsługi",
    rows: [
      ["🏢 Workspace", workspace.name ?? workspace.id],
      ["🎯 Docelowy plan", `${row.toPlan.name} (${row.toPeriod === "annual" ? "rocznie" : "miesięcznie"})`],
      ["⚠️ Powód", reason],
      ["🔗 Subskrypcja", row.subscription],
    ],
    dedupeKey: `plan-change-review:${workspace.id}:${row.toPlan.id}:${row.toPeriod}:${new Date().toISOString().slice(0, 10)}`,
  });
}

type Derived =
  | { ok: true; quote: ChangeQuote; ctx: Context; sub: SSubscription; item: SItem; fromPlan: PlanRow; toPlan: PlanRow;
      toPriceId: string; fromPriceId: string; paymentId: string }
  | { ok: false; reason: PlanChangeRefusal; review?: string; toPlan?: PlanRow; ctx?: Context };

/**
 * The quote, from the database and Stripe as they stand. Called to OFFER the
 * change and again to CONFIRM it (with `at` = the offer's own time): the same
 * inputs give the same figures; anything that moved makes it stale.
 */
async function derive(
  supabase: Client, token: string, workspace: WorkspaceRef, target: { planId: string; period: BillingPeriod }, at: Date, io: StripeIO,
): Promise<Derived> {
  const ctx = await readContext(supabase, token, workspace.id);
  if (!ctx.enabled) return { ok: false, reason: "disabled" };
  const s = ctx.subscription;
  if (!s) return { ok: false, reason: "no_subscription" };
  if (ctx.active_change) return { ok: false, reason: "change_in_progress", ctx };
  if (s.status !== "active") return { ok: false, reason: "subscription_not_active" };
  if (s.cancel_at_period_end) return { ok: false, reason: "cancel_scheduled" };

  const { data: rows, error } = await supabase.from("subscription_plans").select(PLAN_COLUMNS).in("id", [s.plan_id, target.planId]);
  if (error) throw new Error("plans_failed");
  const plans = (rows ?? []) as unknown as PlanRow[];
  const fromPlan = plans.find((p) => p.id === s.plan_id);
  const toPlan = plans.find((p) => p.id === target.planId);
  if (!toPlan || !toPlan.active || toPlan.price_cents <= 0) return { ok: false, reason: "unknown_plan" };
  const toPriceId = priceIdFor(toPlan, target.period);
  if (!toPriceId || !sellable(toPlan, target.period) || (target.period === "annual" && !annualOnSale())) {
    return { ok: false, reason: "not_on_sale" };
  }
  const review = (why: string): Derived => ({ ok: false, reason: "manual_review", review: why, toPlan, ctx });
  if (!fromPlan || !s.period || !s.stripe_price_id) return review("unmapped_current_price");
  if (fromPlan.id === toPlan.id && s.period === target.period) return { ok: false, reason: "same_plan" };

  // STRIPE IS ASKED, NOT REMEMBERED: the subscription must be exactly the
  // simple shape this module knows how to change.
  const sub = await io.get<SSubscription>(`/subscriptions/${encodeURIComponent(s.provider_subscription_id)}`, {});
  const item = sub.items?.data?.[0];
  if (sub.status !== "active") return { ok: false, reason: "subscription_not_active" };
  if (sub.cancel_at_period_end || sub.cancel_at) return { ok: false, reason: "cancel_scheduled" };
  if (!item || sub.items.data.length !== 1 || (item.quantity ?? 1) !== 1) return review("unexpected_items");
  if (item.price.id !== s.stripe_price_id) return review("price_out_of_sync");
  if (idOf(sub.schedule)) return review("has_schedule");
  if (sub.pending_update) return review("pending_update");
  if (sub.discount || (sub.discounts && sub.discounts.length > 0)) return review("existing_discount");
  if (sub.collection_method !== "charge_automatically") return review("collection_method");
  if (sub.currency.toUpperCase() !== toPlan.currency.toUpperCase()) return review("currency_mismatch");

  const startSec = item.current_period_start ?? sub.current_period_start;
  const endSec = item.current_period_end ?? sub.current_period_end;
  if (!startSec || !endSec) return review("no_period");
  const periodStart = new Date(startSec * 1000).toISOString();
  const periodEnd = new Date(endSec * 1000).toISOString();
  if (s.current_period_end && Math.abs(Date.parse(s.current_period_end) - endSec * 1000) > DAY) return review("period_mismatch");

  // THE PERIOD'S PAYMENT — what the customer actually paid for the time and
  // credits being settled. Anything unusual is a person's decision.
  const p = ctx.payment;
  if (!p) return review("no_period_payment");
  if (p.status !== "succeeded") return review("period_payment_not_settled");
  if (p.needs_review) return review("period_payment_flagged");
  if (p.plan_id !== fromPlan.id) return review("period_payment_other_plan");
  if (p.billing_reason === "subscription_update" && !p.from_change) return review("historical_proration");
  if (p.proration_lots) return review("historical_proration");
  if (p.currency.toUpperCase() !== fromPlan.currency.toUpperCase()) return review("currency_mismatch");

  let current: CurrentSubscription;
  const fromFacts = facts(fromPlan);
  const basis = periodBasis(p.amount_cents, p.tax_cents, p.carried_deduction_cents, priceFor(fromFacts, s.period));
  if (s.period === "monthly") {
    const lots = ctx.lots.filter((l) => !l.tranche_id);
    if (Number(ctx.period_lot_credits) !== fromFacts.credits) return review("unexpected_pool");
    if (lots.some((l) => Math.abs(Date.parse(l.expires_at) - endSec * 1000) > DAY)) return review("unexpected_pool");
    current = {
      plan: fromFacts, period: "monthly", periodStart, periodEnd, basisCents: basis,
      periodCredits: Number(ctx.period_lot_credits),
      lots: lots.map((l) => ({ id: l.id, amount: Number(l.amount), remaining: Number(l.remaining), expiresAt: l.expires_at })),
      pendingTranches: [],
    };
  } else {
    if (!(Number(ctx.tranches.total) > 0) || ctx.tranches.count < 1) return review("unexpected_pool");
    if (ctx.tranches.last_end && Math.abs(Date.parse(ctx.tranches.last_end) - endSec * 1000) > DAY) return review("unexpected_pool");
    const lots = ctx.lots.filter((l) => Boolean(l.tranche_id));
    current = {
      plan: fromFacts, period: "annual", periodStart, periodEnd, basisCents: basis,
      periodCredits: Number(ctx.tranches.total),
      lots: lots.map((l) => ({ id: l.id, amount: Number(l.amount), remaining: Number(l.remaining), expiresAt: l.expires_at })),
      pendingTranches: ctx.tranches.pending.map((t) => ({ id: t.id, credits: Number(t.credits), startsAt: t.starts_at })),
    };
  }

  const q = quoteChange(current, { plan: facts(toPlan), period: target.period }, at);
  if (!q.ok) {
    if (q.reason === "deduction_exceeds_price" || q.reason === "no_period_credits" || q.reason === "currency_mismatch") return review(q.reason);
    return { ok: false, reason: q.reason === "unknown_target" ? "unknown_plan" : q.reason };
  }
  return { ok: true, quote: q.quote, ctx, sub, item, fromPlan, toPlan, toPriceId, fromPriceId: item.price.id, paymentId: p.id };
}

/**
 * What an IMMEDIATE change would invoice, asked of Stripe before anything is
 * created. Only the plain case is automated: one full line of the new price,
 * no tax, no customer balance — the invoice must equal the quote.
 */
async function previewMatches(io: StripeIO, d: Extract<Derived, { ok: true }>): Promise<boolean> {
  const inv = await io.get<SInvoice>("/invoices/upcoming", {
    customer: idOf(d.sub.customer) ?? undefined,
    subscription: d.sub.id,
    subscription_items: [{ id: d.item.id, price: d.toPriceId }],
    subscription_proration_behavior: "none",
    subscription_billing_cycle_anchor: "now",
  });
  const lines = inv.lines?.data ?? [];
  return inv.subtotal === d.quote.listPriceCents && inv.total === d.quote.listPriceCents
    && (inv.starting_balance ?? 0) === 0 && (inv.tax ?? 0) === 0
    && lines.length === 1 && lines[0].proration !== true && lines[0].price?.id === d.toPriceId
    && lines[0].amount === d.quote.listPriceCents;
}

/** The offer: priced, checked with Stripe, stored (15 minutes). */
export async function quotePlanChange(
  supabase: Client, workspace: WorkspaceRef, target: { planId: string; period: BillingPeriod }, io: StripeIO = LIVE,
): Promise<QuoteOutcome> {
  if (!paymentsEnabled()) return { ok: false, reason: "payments_disabled" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };
  try {
    const at = new Date();
    const d = await derive(supabase, token, workspace, target, at, io);
    if (!d.ok) {
      if (d.reason === "manual_review" && d.toPlan && d.ctx?.subscription) {
        await manualReview(supabase, token, workspace, d.review ?? "unknown", {
          subscription: d.ctx.subscription.provider_subscription_id, toPlan: d.toPlan, toPeriod: target.period,
          fromPlanId: d.ctx.subscription.plan_id, fromPeriod: d.ctx.subscription.period, fromPriceId: d.ctx.subscription.stripe_price_id,
        });
      }
      return { ok: false, reason: d.reason };
    }
    if (d.quote.timing === "immediate" && !(await previewMatches(io, d))) {
      await manualReview(supabase, token, workspace, "preview_mismatch", {
        subscription: d.sub.id, toPlan: d.toPlan, toPeriod: target.period, fromPlanId: d.fromPlan.id,
        fromPeriod: d.quote.from.period, fromPriceId: d.fromPriceId,
      });
      return { ok: false, reason: "manual_review" };
    }
    const q = d.quote;
    const { data: id, error } = await supabase.rpc("plan_change_open", {
      p_token: token, p_workspace_id: workspace.id,
      p: {
        status: "quoted", provider_subscription_id: d.sub.id, kind: q.kind, timing: q.timing,
        from_plan_id: q.from.planId, from_period: q.from.period, from_price_id: d.fromPriceId,
        to_plan_id: q.to.planId, to_period: q.to.period, to_price_id: d.toPriceId, currency: q.currency,
        list_price_cents: q.listPriceCents, basis_cents: q.basisCents, time_value_cents: q.timeValueCents,
        credit_value_cents: q.creditValueCents, deduction_cents: q.deductionCents, amount_due_cents: q.amountDueCents,
        closed_credits: q.closedCredits, effective_at: q.effectiveAt, fingerprint: quoteFingerprint(q),
        quote: { ...q, payment_id: d.paymentId, quoted_at: at.toISOString() } as unknown as Json,
      } as unknown as Json,
    });
    if (error || typeof id !== "string") return { ok: false, reason: "stripe_error" };
    return { ok: true, offer: { changeId: id, expiresAt: new Date(at.getTime() + 15 * 60 * 1000).toISOString(), quote: q } };
  } catch (e) {
    logStripe("quote", e, workspace.id);
    return { ok: false, reason: "stripe_error" };
  }
}

type ChangeRow = {
  id: string; workspace_id: string; status: string; kind: string; timing: string; provider_subscription_id: string;
  to_plan_id: string; to_period: BillingPeriod; to_price_id: string; from_price_id: string | null; currency: string;
  list_price_cents: number; deduction_cents: number; amount_due_cents: number; fingerprint: string | null;
  quoted_at: string; expires_at: string; effective_at: string | null;
  stripe_coupon_id: string | null; stripe_invoice_id: string | null; stripe_schedule_id: string | null;
};
const ROW_COLUMNS = "id, workspace_id, status, kind, timing, provider_subscription_id, to_plan_id, to_period, to_price_id, from_price_id, currency, list_price_cents, deduction_cents, amount_due_cents, fingerprint, quoted_at, expires_at, effective_at, stripe_coupon_id, stripe_invoice_id, stripe_schedule_id";

async function readRow(supabase: Client, workspaceId: string, changeId: string): Promise<ChangeRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(changeId)) return null;
  const { data } = await supabase.from("plan_changes").select(ROW_COLUMNS).eq("id", changeId).eq("workspace_id", workspaceId).maybeSingle();
  return (data as unknown as ChangeRow | null) ?? null;
}

async function release(supabase: Client, token: string, changeId: string, status: "released" | "canceled" | "expired" | "failed" | "manual_review", reason: string) {
  const { error } = await supabase.rpc("plan_change_release", { p_token: token, p_change_id: changeId, p_status: status, p_reason: reason });
  if (error) console.error("plan_change.release_failed", changeId, error.code ?? "unknown");
}

/** Remove the deduction coupon from the subscription (best effort, idempotent). */
async function clearDiscount(io: StripeIO, subscriptionId: string, changeId: string, tag: string) {
  try {
    const sub = await io.get<SSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {});
    if (!sub.discount && !(sub.discounts && sub.discounts.length > 0)) return;
    await io.post(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { discounts: "", proration_behavior: "none" }, `plan-change-undiscount:${changeId}:${tag}`);
  } catch (e) {
    logStripe("undiscount", e, changeId);
  }
}

/** Void an open invoice; tells whether it is (now) not payable. */
async function voidInvoice(io: StripeIO, invoiceId: string, changeId: string): Promise<"void" | "paid" | "unknown"> {
  try {
    const inv = await io.get<SInvoice>(`/invoices/${encodeURIComponent(invoiceId)}`, {});
    if (inv.status === "paid") return "paid";
    if (inv.status === "void" || inv.status === "uncollectible") return "void";
    if (inv.status === "open") {
      await io.post(`/invoices/${encodeURIComponent(invoiceId)}/void`, {}, `plan-change-void:${changeId}`);
      return "void";
    }
    return "unknown";
  } catch (e) {
    logStripe("void", e, changeId);
    return "unknown";
  }
}

const invoiceMatches = (inv: SInvoice, row: { list: number; deduction: number; due: number; price: string }) => {
  const lines = inv.lines?.data ?? [];
  const discount = (inv.total_discount_amounts ?? []).reduce((s, x) => s + (x.amount ?? 0), 0);
  return inv.subtotal === row.list && inv.total === row.due && inv.amount_due === row.due
    && discount === row.deduction && (inv.starting_balance ?? 0) === 0 && (inv.tax ?? 0) === 0
    && lines.length === 1 && lines[0].proration !== true && lines[0].price?.id === row.price && lines[0].amount === row.list;
};

/**
 * CONFIRM: the quote is re-derived at its own time; equal figures reserve the
 * pool, then Stripe is driven. Returns what the browser must do next.
 */
export async function confirmPlanChange(
  supabase: Client, workspace: WorkspaceRef, changeId: string, io: StripeIO = LIVE,
): Promise<ConfirmOutcome> {
  if (!paymentsEnabled()) return { ok: false, reason: "payments_disabled" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };
  const row = await readRow(supabase, workspace.id, changeId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "quoted" || Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: "quote_expired" };

  let d: Derived;
  try {
    d = await derive(supabase, token, workspace, { planId: row.to_plan_id, period: row.to_period }, new Date(row.quoted_at), io);
  } catch (e) {
    logStripe("rederive", e, changeId);
    return { ok: false, reason: "stripe_error" };
  }
  if (!d.ok) {
    await release(supabase, token, changeId, "expired", `rederive:${d.reason}`);
    return { ok: false, reason: d.reason === "manual_review" ? "manual_review" : d.reason };
  }
  if (quoteFingerprint(d.quote) !== row.fingerprint || d.toPriceId !== row.to_price_id) {
    await release(supabase, token, changeId, "expired", "quote_changed");
    return { ok: false, reason: "quote_changed" };
  }

  // 1. THE POOL IS RESERVED before any money moves.
  const { data: held, error: holdError } = await supabase.rpc("plan_change_hold", { p_token: token, p_change_id: changeId });
  if (holdError) return { ok: false, reason: "stripe_error" };
  const holdStatus = (held as { status?: string } | null)?.status;
  if (holdStatus !== "held") {
    const map: Record<string, PlanChangeRefusal> = {
      quote_expired: "quote_expired", pool_changed: "quote_changed", change_in_progress: "change_in_progress",
      inflight_usage: "inflight_usage", disabled: "disabled",
    };
    return { ok: false, reason: map[holdStatus ?? ""] ?? "stripe_error" };
  }

  return d.quote.timing === "period_end"
    ? scheduleAtPeriodEnd(supabase, token, d, changeId, io)
    : changeNow(supabase, token, workspace, d, changeId, io);
}

async function changeNow(
  supabase: Client, token: string, workspace: WorkspaceRef, d: Extract<Derived, { ok: true }>, changeId: string, io: StripeIO,
): Promise<ConfirmOutcome> {
  const q = d.quote;
  const subPath = `/subscriptions/${encodeURIComponent(d.sub.id)}`;
  let updated: SSubscription | null = null;
  try {
    // 2. The deduction: a coupon that can be used once, only on the new plan.
    if (q.deductionCents > 0) {
      const price = await io.get<SPrice>(`/prices/${encodeURIComponent(d.toPriceId)}`, {});
      const coupon = await io.post<{ id: string }>("/coupons", {
        amount_off: q.deductionCents, currency: q.currency.toLowerCase(), duration: "once", max_redemptions: 1,
        name: "GrovBase — rozliczenie zmiany planu",
        applies_to: { products: [idOf(price.product) ?? ""] },
        redeem_by: Math.floor(Date.now() / 1000) + 2 * 3600,
        metadata: { grovbase_plan_change_id: changeId, grovbase_workspace_id: workspace.id },
      }, `plan-change-coupon:${changeId}`);
      await supabase.rpc("plan_change_attach", { p_token: token, p_change_id: changeId, p: { coupon: coupon.id } });
      await io.post(subPath, { discounts: [{ coupon: coupon.id }], proration_behavior: "none" }, `plan-change-discount:${changeId}`);
    }
    // 3. The change itself — applied by Stripe only once the invoice is paid.
    updated = await io.post<SSubscription>(subPath, {
      items: [{ id: d.item.id, price: d.toPriceId }],
      proration_behavior: "none",
      billing_cycle_anchor: "now",
      payment_behavior: "pending_if_incomplete",
      expand: ["latest_invoice.payment_intent"],
    }, `plan-change:${changeId}`);
  } catch (e) {
    logStripe("update", e, changeId);
    // Did the update happen anyway (a timeout after Stripe accepted it)?
    try {
      const now = await io.get<SSubscription>(subPath, { expand: ["latest_invoice.payment_intent"] });
      const moved = now.pending_update || now.items?.data?.[0]?.price?.id === d.toPriceId;
      if (moved) updated = now;
    } catch (e2) {
      logStripe("update_lookup", e2, changeId);
    }
    if (!updated) {
      await clearDiscount(io, d.sub.id, changeId, "update_failed");
      await release(supabase, token, changeId, "failed", "stripe_update_failed");
      return { ok: false, reason: "stripe_error" };
    }
  }

  // 4. The invoice must be the quote, to the cent.
  const inv = typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
  if (!inv) {
    await clearDiscount(io, d.sub.id, changeId, "no_invoice");
    await release(supabase, token, changeId, "manual_review", "no_invoice");
    return { ok: false, reason: "manual_review" };
  }
  const pi = typeof inv.payment_intent === "object" ? inv.payment_intent : null;
  await supabase.rpc("plan_change_attach", {
    p_token: token, p_change_id: changeId,
    p: { status: "awaiting_payment", invoice: inv.id, payment_intent: pi?.id ?? idOf(inv.payment_intent as string | null) ?? "" },
  });
  if (!invoiceMatches(inv, { list: q.listPriceCents, deduction: q.deductionCents, due: q.amountDueCents, price: d.toPriceId })) {
    const voided = await voidInvoice(io, inv.id, changeId);
    if (voided === "paid") return { ok: true, state: "paid", changeId };
    await clearDiscount(io, d.sub.id, changeId, "mismatch");
    await release(supabase, token, changeId, "manual_review", "invoice_mismatch");
    await notify(supabase, {
      type: "finance.plan_change_review", icon: "🧾", title: "Zmiana planu zatrzymana: faktura ≠ wycena",
      rows: [["🏢 Workspace", workspace.name ?? workspace.id], ["🧾 Faktura", inv.id],
        ["💵 Wycena", `${(q.amountDueCents / 100).toFixed(2)} ${q.currency}`], ["💵 Faktura", `${(inv.amount_due / 100).toFixed(2)} ${inv.currency.toUpperCase()}`]],
      dedupeKey: `plan-change-mismatch:${changeId}`,
    });
    return { ok: false, reason: "manual_review" };
  }

  // 5. What the customer must do now.
  if (inv.status === "paid" || pi?.status === "succeeded") return { ok: true, state: "paid", changeId };
  if (pi?.status === "processing") return { ok: true, state: "processing", changeId };
  if (pi && pi.client_secret && (pi.status === "requires_action" || pi.status === "requires_confirmation")) {
    return { ok: true, state: "requires_action", changeId, clientSecret: pi.client_secret };
  }
  if (pi && pi.client_secret && pi.status === "requires_payment_method") {
    return { ok: true, state: "requires_payment_method", changeId, clientSecret: pi.client_secret };
  }
  // Anything else cannot be completed from here: undo.
  const voided = await voidInvoice(io, inv.id, changeId);
  if (voided === "paid") return { ok: true, state: "paid", changeId };
  await clearDiscount(io, d.sub.id, changeId, "unpayable");
  await release(supabase, token, changeId, "failed", `payment_${pi?.status ?? "missing"}`);
  return { ok: false, reason: "payment_failed" };
}

async function scheduleAtPeriodEnd(
  supabase: Client, token: string, d: Extract<Derived, { ok: true }>, changeId: string, io: StripeIO,
): Promise<ConfirmOutcome> {
  let scheduleId: string | null = null;
  try {
    const sched = await io.post<SSchedule>("/subscription_schedules", { from_subscription: d.sub.id }, `plan-change-schedule:${changeId}`);
    scheduleId = sched.id;
    await supabase.rpc("plan_change_attach", { p_token: token, p_change_id: changeId, p: { schedule: sched.id } });
    const phase = sched.phases?.[0];
    if (!phase) throw new Error("schedule_without_phase");
    await io.post(`/subscription_schedules/${encodeURIComponent(sched.id)}`, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        { items: [{ price: d.fromPriceId, quantity: 1 }], start_date: phase.start_date, end_date: phase.end_date, proration_behavior: "none" },
        { items: [{ price: d.toPriceId, quantity: 1 }], iterations: 1, proration_behavior: "none" },
      ],
      metadata: { grovbase_plan_change_id: changeId },
    }, `plan-change-schedule-phases:${changeId}`);
    await supabase.rpc("plan_change_attach", { p_token: token, p_change_id: changeId, p: { status: "scheduled", schedule: sched.id } });
    return { ok: true, state: "scheduled", changeId, effectiveAt: d.quote.effectiveAt };
  } catch (e) {
    logStripe("schedule", e, changeId);
    if (scheduleId) {
      try { await io.post(`/subscription_schedules/${encodeURIComponent(scheduleId)}/release`, {}, `plan-change-schedule-undo:${changeId}`); }
      catch (e2) { logStripe("schedule_undo", e2, changeId); }
    }
    await release(supabase, token, changeId, "failed", "schedule_failed");
    return { ok: false, reason: "stripe_error" };
  }
}

/** The customer cancels a change that is waiting (a payment, or a date). */
export async function cancelPlanChange(
  supabase: Client, workspace: WorkspaceRef, changeId: string, io: StripeIO = LIVE,
): Promise<{ ok: true } | { ok: false; reason: PlanChangeRefusal }> {
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };
  const row = await readRow(supabase, workspace.id, changeId);
  if (!row) return { ok: false, reason: "not_found" };
  try {
    if (row.status === "quoted") {
      await release(supabase, token, changeId, "canceled", "customer");
      return { ok: true };
    }
    if (row.status === "scheduled" && row.stripe_schedule_id) {
      await io.post(`/subscription_schedules/${encodeURIComponent(row.stripe_schedule_id)}/release`, {}, `plan-change-cancel:${changeId}`);
      await release(supabase, token, changeId, "canceled", "customer");
      return { ok: true };
    }
    if (row.status === "held" || row.status === "awaiting_payment") {
      if (row.stripe_invoice_id) {
        const voided = await voidInvoice(io, row.stripe_invoice_id, changeId);
        if (voided === "paid") return { ok: false, reason: "already_paid" };
        if (voided !== "void") return { ok: false, reason: "stripe_error" };
      }
      await clearDiscount(io, row.provider_subscription_id, changeId, "cancel");
      await release(supabase, token, changeId, "canceled", "customer");
      return { ok: true };
    }
    return { ok: false, reason: "not_found" };
  } catch (e) {
    logStripe("cancel", e, changeId);
    return { ok: false, reason: "stripe_error" };
  }
}

/** What the modal / plan page shows about this workspace's change. */
export async function planChangeStatus(supabase: Client, workspaceId: string, changeId: string): Promise<string | null> {
  const row = await readRow(supabase, workspaceId, changeId);
  return row?.status ?? null;
}

/**
 * The SIGNED WEBHOOK, after stripe_settle_v2: close the change this invoice
 * paid for (if any). Throws on a database error so Stripe retries.
 */
export async function settlePlanChange(
  supabase: Client, token: string,
  args: { subscriptionId: string | null; invoiceId: string; paymentId: string | null; priceId: string | null },
): Promise<string> {
  if (!args.subscriptionId) return "none";
  const { data, error } = await supabase.rpc("plan_change_settle", {
    p_token: token, p_subscription: args.subscriptionId, p_invoice: args.invoiceId,
    p_payment_id: args.paymentId as string, p_price_id: args.priceId as string,
  });
  if (error) throw new Error(`plan_change_settle_failed:${error.code ?? "unknown"}`);
  const status = (data as { status?: string } | null)?.status ?? "none";
  if (status === "completed" && (data as { late?: boolean }).late) {
    // Paid after the reservation was released: the released credits were
    // closed again; whatever was spent in between is a person's call.
    const id = (data as { change_id?: string }).change_id ?? "-";
    console.error("plan_change.late_payment", id);
    await notify(supabase, {
      type: "finance.plan_change_review", icon: "🧾", title: "Zmiana planu opłacona po zwolnieniu rezerwacji",
      rows: [["🔗 Subskrypcja", args.subscriptionId], ["🧾 Faktura", args.invoiceId],
        ["🔒 Ponownie zamknięte kredyty", String((data as { re_closed?: number }).re_closed ?? 0)]],
      dedupeKey: `plan-change-late:${id}`,
    });
  }
  return status;
}

/**
 * THE SWEEP (reserves cron, every 15 minutes, with the server token): a
 * reserved change past its payment window has its invoice voided in Stripe
 * FIRST and only then its pool released; a payment that went through is left
 * for the webhook. Never throws.
 */
export async function sweepPlanChanges(supabase: Client, io: StripeIO = LIVE): Promise<{ released: number; skipped: number }> {
  const token = dispatchToken();
  let released = 0, skipped = 0;
  if (!token) return { released, skipped };
  try {
    const { data } = await supabase.rpc("plan_change_due", { p_token: token });
    const due = (data ?? []) as { id: string; status: string; subscription: string; invoice: string | null; coupon: string | null; schedule: string | null }[];
    for (const c of due) {
      try {
        if (c.status === "scheduled") {
          await release(supabase, token, c.id, "manual_review", "schedule_not_settled");
          await notify(supabase, { type: "finance.plan_change_review", icon: "🧾", title: "Zaplanowana zmiana planu nie została rozliczona",
            rows: [["🔗 Subskrypcja", c.subscription], ["🗓️ Harmonogram", c.schedule ?? "—"]], dedupeKey: `plan-change-unsettled:${c.id}` });
          released++;
          continue;
        }
        let invoice = c.invoice;
        if (!invoice) {
          const sub = await io.get<SSubscription>(`/subscriptions/${encodeURIComponent(c.subscription)}`, {});
          invoice = sub.pending_update ? idOf(sub.latest_invoice as string | { id: string } | null) : null;
        }
        if (invoice) {
          const v = await voidInvoice(io, invoice, c.id);
          if (v === "paid") { skipped++; continue; }
          if (v !== "void") { skipped++; continue; }
        }
        if (c.coupon) await clearDiscount(io, c.subscription, c.id, "sweep");
        await release(supabase, token, c.id, "expired", "payment_window_passed");
        released++;
      } catch (e) {
        logStripe("sweep_item", e, c.id);
        skipped++;
      }
    }
  } catch (e) {
    console.error("plan_change.sweep_failed", e instanceof Error ? e.message : "unknown");
  }
  return { released, skipped };
}

/* ── the administrator's switch ────────────────────────────────────────────*/

export type PortalState = { id: string; isDefault: boolean; planChange: boolean };

/** The Customer Portal configurations and whether they let a customer change plan. */
export async function portalPlanChangeState(io: StripeIO = LIVE): Promise<PortalState[] | null> {
  try {
    const list = await io.get<{ data: SPortalConfig[] }>("/billing_portal/configurations", { active: true, limit: 20 });
    return list.data.map((c) => ({ id: c.id, isDefault: c.is_default, planChange: c.features?.subscription_update?.enabled === true }));
  } catch (e) {
    logStripe("portal_read", e, "-");
    return null;
  }
}

/**
 * ON: every active portal configuration stops offering a plan change (the
 * portal's own proration would be a second, different deduction); card,
 * invoices and cancellation are untouched. What each configuration had is
 * stored, so OFF restores it exactly. GrovNews is not a portal product.
 */
export async function setPlanChangesEnabled(
  supabase: Client, enabled: boolean, io: StripeIO = LIVE,
): Promise<{ ok: true } | { ok: false; reason: "stripe_error" | "not_admin" }> {
  try {
    const list = await io.get<{ data: SPortalConfig[] }>("/billing_portal/configurations", { active: true, limit: 20 });
    const stamp = Date.now();
    if (enabled) {
      const before = list.data
        .filter((c) => c.features?.subscription_update?.enabled)
        .map((c) => ({ id: c.id, subscription_update: c.features.subscription_update }));
      for (const c of before) {
        await io.post(`/billing_portal/configurations/${encodeURIComponent(c.id)}`,
          { features: { subscription_update: { enabled: false } } }, `portal-plan-change-off:${c.id}:${stamp}`);
      }
      const { error } = await supabase.rpc("plan_changes_set", { p_enabled: true, p_portal: { before, at: new Date().toISOString() } as unknown as Json });
      if (error) return { ok: false, reason: error.code === "42501" ? "not_admin" : "stripe_error" };
      return { ok: true };
    }
    // OFF: put back exactly what was there before ON.
    const { data: settings } = await supabase.from("app_settings").select("value").eq("key", "plan_changes").maybeSingle();
    const before = ((settings?.value as { portal?: { before?: { id: string; subscription_update?: SPortalConfig["features"]["subscription_update"] }[] } } | null)?.portal?.before) ?? [];
    for (const c of before) {
      const su = c.subscription_update;
      if (!su) continue;
      await io.post(`/billing_portal/configurations/${encodeURIComponent(c.id)}`, {
        features: { subscription_update: {
          enabled: true,
          default_allowed_updates: su.default_allowed_updates ?? ["price"],
          proration_behavior: su.proration_behavior ?? "always_invoice",
          ...(su.products && su.products.length ? { products: su.products.map((p) => ({ product: p.product, prices: p.prices })) } : {}),
        } },
      }, `portal-plan-change-on:${c.id}:${stamp}`);
    }
    const { error } = await supabase.rpc("plan_changes_set", { p_enabled: false, p_portal: { before: [], restored: before.map((c) => c.id), at: new Date().toISOString() } as unknown as Json });
    if (error) return { ok: false, reason: error.code === "42501" ? "not_admin" : "stripe_error" };
    return { ok: true };
  } catch (e) {
    logStripe("portal_write", e, "-");
    return { ok: false, reason: "stripe_error" };
  }
}

function logStripe(stage: string, e: unknown, ref: string) {
  console.error("plan_change.stripe", JSON.stringify({
    stage, ref,
    status: e instanceof StripeApiError ? e.status : null,
    code: e instanceof StripeApiError ? e.code ?? null : null,
    request: e instanceof StripeApiError ? e.requestId ?? null : null,
    message: e instanceof Error ? e.message.slice(0, 200) : "unknown",
  }));
}
