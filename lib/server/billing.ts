import "server-only";
import { randomUUID } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { absoluteUrl } from "@/lib/site";
import { dispatchToken } from "@/lib/server/server-token";
import { stripeCredentials, paymentsEnabled } from "@/lib/stripe/config";
import {
  stripePost, stripeGet, StripeNotConfiguredError, StripeApiError,
  type StripeCheckoutSession, type StripeCustomer, type StripeBillingPortalSession,
} from "@/lib/stripe/client";
import { sellable } from "@/lib/server/stripe-pricing";
import {
  PRICING_OFFER, annualOnSale, premiereExpiredFor, premiereMetadata, priceTopup,
} from "@/lib/server/pricing-offer";

/**
 * CHECKOUT — created on the server, priced by the server, attributed by the
 * server. The browser's entire contribution is a package id, a plan id, or a
 * number of credits.
 *
 * WHAT THE BROWSER MAY NEVER SEND, and what would happen if it could:
 *
 *   an amount           → buy 2500 credits for 1 grosz;
 *   a credits figure
 *     beside an amount  → pay for the small pack, receive the big one;
 *   a workspace id      → put someone else's workspace on the invoice, or
 *                         top up an account you do not own;
 *   a stripe_customer_id→ attach your payment to another customer, and with
 *                         the Billing Portal, read their cards and invoices;
 *   a price id          → pay yesterday's price, or another tier's.
 *
 * So: the workspace is read from the SESSION, the price is read from the
 * DATABASE, and the Stripe ids are read from the mapping columns. The checkout
 * request object is assembled here and never merged with anything a client
 * sent.
 *
 * AND NOTHING HERE GRANTS CREDITS. A created session is an intent. The only
 * thing that moves the ledger is the signed webhook (app/api/hooks/stripe),
 * because a customer can reach `success_url` by typing it.
 */

/**
 * WHAT WENT WRONG AT THE TILL, WRITTEN DOWN.
 *
 * Every entry point below used to end in a catch that mapped everything to one
 * refusal and logged nothing at all. A customer saw "could not start the
 * payment", and there was no record anywhere of why — which makes the first
 * real payment undebuggable at exactly the moment it matters most.
 *
 * Stripe's own `message`, `type` and `code` describe the refusal and contain no
 * credential; the key lives only in an Authorization header this never touches.
 * So those three are logged, and nothing else — no request body, no customer
 * email, no key.
 */
function logStripeFailure(where: string, e: unknown): void {
  if (e instanceof StripeApiError) {
    console.error("billing.stripe", where, e.status, e.type ?? "-", e.code ?? "-", e.message);
    return;
  }
  if (e instanceof StripeNotConfiguredError || e instanceof ServerKeyMissingError) {
    console.error("billing.misconfigured", where, e.name);
    return;
  }
  console.error("billing.failed", where, e instanceof Error ? e.message : "unknown");
}

/** No GROVBASE_SERVER_KEY: nothing can authenticate itself to the database. */
export class ServerKeyMissingError extends Error {
  constructor() { super("server_key_missing"); this.name = "ServerKeyMissingError"; }
}

export type CheckoutRefusal =
  | "payments_disabled" | "unknown_package" | "unknown_plan" | "plan_not_purchasable"
  | "not_mapped" | "no_customer" | "invalid_credits" | "no_server_key"
  | "already_subscribed" | "stripe_error" | "price_out_of_sync" | TopupLiveRefusal
  /** Annual billing is not on sale (lib/server/pricing-offer.ts). */
  | "annual_unavailable"
  /** The premiere ended and the plan still carries its premiere price. */
  | "offer_expired";

/**
 * Why a top-up was refused before any payment was created.
 *
 *   plan_required      the workspace has no paid plan at all (or Stripe says
 *                      it has ended) — the way forward is to choose one;
 *   plan_inactive      a subscription EXISTS but is not active and paid-up
 *                      right now (trialing, past_due, or `active` with a
 *                      period that has run out). Choosing a plan would be
 *                      refused as a second subscription, so the customer is
 *                      sent to the subscription settings instead;
 *   plan_check_failed  the plan could not be read — a database or Stripe
 *                      error. Fails closed, and says "try again", because an
 *                      active subscriber must not be told they have no plan.
 */
export type TopupGateRefusal = "plan_required" | "plan_inactive" | "plan_check_failed";
/** What the live (Stripe) half of the gate can add: a key that may not read
 *  subscriptions is a configuration state, reported as such — never as "try
 *  again" and never as "you have no plan". */
export type TopupLiveRefusal = TopupGateRefusal | "stripe_unauthorized";

export type CheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: CheckoutRefusal };

type WorkspaceRef = { id: string; name?: string | null };

/* ── 1. WHICH STRIPE CUSTOMER IS THIS WORKSPACE ────────────────────────────*/

/**
 * The workspace's Stripe Customer, created once and remembered.
 *
 * The mapping lives in `stripe_customers`, a table with RLS on, no policy and
 * no grants — so it is reachable only through the SECURITY DEFINER functions
 * below, and a workspace member cannot repoint their own row. It is
 * deliberately NOT a column on `billing_profiles`, which members may write:
 * that would let anyone hand their workspace somebody else's customer id and,
 * through the Billing Portal, somebody else's saved cards.
 *
 * `stripe_link_customer` returns the EXISTING id when there is one, so a race
 * between two tabs cannot produce two customers for one workspace. The loser's
 * freshly created Stripe Customer is simply never referenced again.
 */
export async function resolveStripeCustomer(
  supabase: Client,
  workspace: WorkspaceRef,
  email: string | null,
): Promise<string | null> {
  // The dispatch token is what proves to Postgres that this is the server; a
  // deployment without GROVBASE_SERVER_KEY cannot read or write the mapping at
  // all. That is a MISCONFIGURATION, not a customer problem, and the callers
  // report it as `no_server_key` rather than as a generic failure — otherwise
  // the one thing an operator needs to know is the one thing nothing says.
  const token = dispatchToken();
  if (!token) throw new ServerKeyMissingError();
  const creds = stripeCredentials();
  if (!creds) return null;

  // AN ERROR HERE IS NOT "NO CUSTOMER YET". supabase-js surfaces a raised
  // exception as `{ data: null, error }` rather than throwing, so a dispatch
  // token mismatch — which makes stripe_customer_for raise `forbidden` — used
  // to look identical to a workspace that has never paid. The code would then
  // create a real Customer on the LIVE account and fail to persist it, leaving
  // an orphan behind on every attempt.
  const { data: existing, error: readError } = await supabase.rpc("stripe_customer_for", {
    p_token: token, p_workspace_id: workspace.id,
  });
  if (readError) throw new Error(`customer_lookup_failed:${readError.code ?? "unknown"}`);
  if (typeof existing === "string" && existing) return existing;

  const customer = await stripePost<StripeCustomer>("/customers", {
    email: email ?? undefined,
    name: workspace.name ?? undefined,
    metadata: {
      grovbase_workspace_id: workspace.id,
      environment: creds.livemode ? "production" : "test",
    },
  }, `customer:${workspace.id}`);

  const { data: linked, error: linkError } = await supabase.rpc("stripe_link_customer", {
    p_token: token,
    p_workspace_id: workspace.id,
    p_stripe_customer_id: customer.id,
    p_livemode: creds.livemode,
  });
  // The Customer now exists in Stripe. If we cannot record which workspace it
  // belongs to, saying so loudly is the only safe answer: a checkout attached
  // to a customer the database does not know about would settle against no
  // workspace at all.
  if (linkError) throw new Error(`customer_link_failed:${linkError.code ?? "unknown"}`);
  return typeof linked === "string" && linked ? linked : null;
}

/* ── 1b. WHO MAY TOP UP ────────────────────────────────────────────────────*/

export type TopupGate =
  | { ok: true; planId: string; provider: string; providerSubscriptionId: string | null }
  | { ok: false; reason: TopupGateRefusal };

/**
 * TOP-UPS ARE FOR PAYING SUBSCRIBERS — decided here, on the server, for every
 * route a top-up can be started from (the embedded checkout's quote and begin,
 * and the hosted fallback's two actions). A browser saying it has a plan is
 * not asked; a manual POST to an action meets this function like any click.
 *
 * WHAT COUNTS: a `subscriptions` row of this workspace with status `active`
 * whose paid period has not run out. Every other status is refused, and on
 * purpose (a live but not-paid-up row — trialing, past_due, a lapsed period —
 * as `plan_inactive`, anything else as `plan_required`):
 *
 *   trialing            never created by this app (no trial_period_days); a
 *                       dashboard-made trial has not paid anything yet;
 *   past_due / unpaid   the plan's own invoice is failing — selling more on
 *                       top of an unpaid one is the wrong order;
 *   incomplete(_expired), canceled, paused — not a live paid plan.
 *
 * `cancel_at_period_end` keeps status `active` until the period ends, so a
 * customer who cancelled can still top up until then — they paid for it.
 *
 * THE PERIOD END IS CHECKED TOO. The row moves only when the webhook runs, and
 * events can arrive late or out of order (a stale `updated` after `deleted`
 * revives `active`). A period that ended in the past is not a live plan
 * whatever the status says. At the moment of payment, `confirmTopupPlanLive`
 * additionally asks Stripe itself.
 *
 * No join to subscription_plans: RLS hides a withdrawn plan from members, and
 * a subscriber on a withdrawn plan is still a subscriber. A subscription row
 * exists only for a paid plan — the free tier is `plan_not_purchasable`.
 *
 * It reads; it never writes. Balances, the ledger and credits already bought
 * are untouched — only NEW top-up purchases are refused.
 */
export async function requireActivePaidPlan(
  supabase: Client, workspace: WorkspaceRef, now: number = Date.now(),
): Promise<TopupGate> {
  if (!PRICING_OFFER.topups.requireActivePlan) {
    return { ok: true, planId: "", provider: "", providerSubscriptionId: null };
  }
  // The statuses that block buying a second subscription (beginSubscription's
  // own set): one of them without a paid-up period is "inactive", not "none".
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan_id, status, current_period_end, provider, provider_subscription_id")
    .eq("workspace_id", workspace.id)
    .in("status", ["active", "trialing", "past_due"])
    .order("current_period_end", { ascending: false })
    .limit(10);
  if (error) {
    console.error("billing.plan_gate", "lookup_failed", error.code ?? "-");
    return { ok: false, reason: "plan_check_failed" };
  }
  const rows = data ?? [];
  const row = rows.find((r) => {
    if (r.status !== "active") return false;
    const end = r.current_period_end ? Date.parse(r.current_period_end) : Number.NaN;
    return Number.isFinite(end) && end > now;
  });
  if (!row) return { ok: false, reason: rows.length > 0 ? "plan_inactive" : "plan_required" };
  return {
    ok: true, planId: row.plan_id, provider: row.provider ?? "",
    providerSubscriptionId: row.provider_subscription_id ?? null,
  };
}

/**
 * The same rule, asked of Stripe at the moment a top-up payment is CREATED.
 *
 * The database row is GrovBase's copy and trails Stripe by one webhook. A plan
 * cancelled immediately in the dashboard still reads `active` here until
 * `customer.subscription.deleted` lands. So the call that creates the payment
 * asks Stripe directly; anything but `active` refuses, and a failed lookup
 * refuses too (closed, not open).
 *
 * After this point a PaymentIntent exists and is settled by the webhook like
 * any other: eligibility is judged when the order is created. A plan cancelled
 * between that moment and the confirmation does not un-sell the credits —
 * the webhook and the ledger are deliberately not taught to refuse money they
 * have already taken.
 */
export async function confirmTopupPlanLive(
  supabase: Client, workspace: WorkspaceRef,
  /** The database answer, when the caller has just read it. */
  known?: TopupGate,
): Promise<{ ok: true } | { ok: false; reason: TopupLiveRefusal }> {
  const gate = known ?? await requireActivePaidPlan(supabase, workspace);
  if (!gate.ok) return gate;
  if (!PRICING_OFFER.topups.requireActivePlan) return { ok: true };
  if (gate.provider !== "stripe" || !gate.providerSubscriptionId) return { ok: false, reason: "plan_required" };
  try {
    const sub = await stripeGet<{ id: string; status: string }>(
      `/subscriptions/${encodeURIComponent(gate.providerSubscriptionId)}`, {},
    );
    return sub.status === "active" ? { ok: true }
      : { ok: false, reason: sub.status === "trialing" || sub.status === "past_due" ? "plan_inactive" : "plan_required" };
  } catch (e) {
    logStripeFailure("plan_gate:live", e);
    if (e instanceof StripeApiError && e.unauthorized) return { ok: false, reason: "stripe_unauthorized" };
    return { ok: false, reason: "plan_check_failed" };
  }
}

/**
 * A hosted top-up session lives 31 minutes, not Stripe's default 24 hours:
 * eligibility is judged when the session is created, and a plan can end while
 * a tab stays open. 30 minutes is Stripe's minimum; one more absorbs clock skew.
 */
const topupSessionExpiry = () => Math.floor(Date.now() / 1000) + 31 * 60;

/** The buyer's plan, for per-plan top-up prices. Read only when such prices
 *  are configured; an unreadable (withdrawn) plan gets the common price. */
export async function topupPlanContext(
  supabase: Client, planId: string,
): Promise<{ slug: string | null; centsPerCredit: number | null }> {
  if (!planId || (!PRICING_OFFER.topups.perPlanCents && PRICING_OFFER.topups.minUnitVsPlan === null)) {
    return { slug: null, centsPerCredit: null };
  }
  const { data } = await supabase
    .from("subscription_plans")
    .select("slug, price_cents, monthly_credits, bonus_credits")
    .eq("id", planId).maybeSingle();
  if (!data) return { slug: null, centsPerCredit: null };
  const credits = data.monthly_credits + data.bonus_credits;
  return { slug: data.slug, centsPerCredit: credits > 0 ? data.price_cents / credits : null };
}

/* ── 2. THE THREE THINGS THAT CAN BE BOUGHT ────────────────────────────────*/

const successUrl = () => `${absoluteUrl("/credits")}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
const cancelUrl = () => `${absoluteUrl("/plan")}?checkout=cancelled`;
const planSuccessUrl = () => `${absoluteUrl("/plan")}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;

/**
 * The metadata every session carries. The webhook prefers the DATABASE mapping
 * (price id → package/plan) and reads these as a cross-check and as the record
 * of who the payment was for — a Checkout Session's own customer is not always
 * enough to name a workspace when a customer was created by another route.
 */
function baseMetadata(workspaceId: string, livemode: boolean): Record<string, string> {
  return {
    grovbase_workspace_id: workspaceId,
    environment: livemode ? "production" : "test",
  };
}

/** A fixed credit package. The browser sends `package_id` and nothing else. */
export async function createPackageCheckout(
  supabase: Client, workspace: WorkspaceRef, email: string | null, packageId: string,
): Promise<CheckoutResult> {
  if (!paymentsEnabled()) return { ok: false, reason: "payments_disabled" };
  const creds = stripeCredentials();
  if (!creds) return { ok: false, reason: "payments_disabled" };

  // ACTIVE ONLY. An id that names a withdrawn package must not be purchasable
  // just because someone kept the old page open.
  const { data: pack } = await supabase
    .from("credit_packages")
    .select("id, name, credits, bonus_credits, price_cents, currency, stripe_price_id, stripe_price_cents, stripe_sync_status")
    .eq("id", packageId).eq("active", true).maybeSingle();
  if (!pack) return { ok: false, reason: "unknown_package" };
  if (!pack.stripe_price_id) return { ok: false, reason: "not_mapped" };
  // The same parity rule the embedded checkout applies: a Price that has not
  // proved it charges the displayed amount is not sold from this path either.
  if (!sellable(pack)) return { ok: false, reason: "price_out_of_sync" };

  // TOP-UPS NEED A LIVE PAID PLAN — this action is a public endpoint, so the
  // rule is enforced here and not only on the page that links to it.
  const gate = await confirmTopupPlanLive(supabase, workspace);
  if (!gate.ok) return gate;

  try {
    const customer = await resolveStripeCustomer(supabase, workspace, email);
    if (!customer) return { ok: false, reason: "no_customer" };

    const session = await stripePost<StripeCheckoutSession>("/checkout/sessions", {
      mode: "payment",
      customer,
      expires_at: topupSessionExpiry(),
      // The PRICE ID from the mapping, so the amount is Stripe's copy of the
      // database's number. Nothing in this call carries a price.
      line_items: [{ price: pack.stripe_price_id, quantity: 1 }],
      success_url: successUrl(),
      cancel_url: cancelUrl(),
      client_reference_id: workspace.id,
      metadata: {
        ...baseMetadata(workspace.id, creds.livemode),
        type: "credit_package",
        grovbase_package_id: pack.id,
        credits: String(pack.credits),
        bonus_credits: String(pack.bonus_credits),
      },
      // The PaymentIntent carries the same marks, because a refund or a
      // dispute arrives as a charge event and has to be traceable without the
      // session.
      payment_intent_data: {
        metadata: {
          ...baseMetadata(workspace.id, creds.livemode),
          type: "credit_package",
          grovbase_package_id: pack.id,
        },
      },
      // A fresh key per attempt: a customer who abandons checkout and tries
      // again must get a new session, not the stale one they walked away from.
    }, `checkout:pack:${workspace.id}:${randomUUID()}`);

    return session.url
      ? { ok: true, url: session.url, sessionId: session.id }
      : { ok: false, reason: "stripe_error" };
  } catch (e) {
    logStripeFailure("checkout:package", e);
    if (e instanceof ServerKeyMissingError) return { ok: false, reason: "no_server_key" };
    return { ok: false, reason: e instanceof StripeNotConfiguredError ? "payments_disabled" : "stripe_error" };
  }
}

/**
 * An arbitrary number of credits.
 *
 * There is no Stripe Price for this — there cannot be, the amount is chosen at
 * the till — so the line item is built with `price_data` HERE, from the rate
 * card in `credit_packages`. The browser sends `credits_requested`; the price
 * is computed, never received.
 */
export async function createCustomCreditsCheckout(
  supabase: Client, workspace: WorkspaceRef, email: string | null, creditsRequested: unknown,
): Promise<CheckoutResult> {
  if (!paymentsEnabled()) return { ok: false, reason: "payments_disabled" };
  const creds = stripeCredentials();
  if (!creds) return { ok: false, reason: "payments_disabled" };

  const { data: packs } = await supabase
    .from("credit_packages")
    .select("credits, bonus_credits, price_cents, currency, stripe_price_cents, stripe_sync_status")
    .eq("active", true);
  const rows = packs ?? [];
  // The packs are the price authority for a custom amount; unverified packs
  // make an unverified rate card (the same rule as lib/server/checkout.ts).
  if (rows.length === 0 || !rows.every((p) => sellable(p))) return { ok: false, reason: "price_out_of_sync" };

  const gate = await requireActivePaidPlan(supabase, workspace);
  if (!gate.ok) return gate;
  // ONLY THE OFFERED AMOUNTS, priced by the one function the page uses.
  const plan = await topupPlanContext(supabase, gate.planId);
  const quote = priceTopup(creditsRequested, {
    packs: rows, planSlug: plan.slug, planCentsPerCredit: plan.centsPerCredit,
  });
  if (!quote.ok) return { ok: false, reason: "invalid_credits" };
  const live = await confirmTopupPlanLive(supabase, workspace, gate);
  if (!live.ok) return live;

  const currency = (rows[0]?.currency ?? "PLN").toLowerCase();

  try {
    const customer = await resolveStripeCustomer(supabase, workspace, email);
    if (!customer) return { ok: false, reason: "no_customer" };

    const session = await stripePost<StripeCheckoutSession>("/checkout/sessions", {
      mode: "payment",
      customer,
      expires_at: topupSessionExpiry(),
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: quote.amountCents,
          product_data: {
            name: `GrovBase — ${quote.credits} kredytów`,
            metadata: {
              type: "custom_credits",
              credits: String(quote.credits),
              environment: creds.livemode ? "production" : "test",
            },
          },
        },
      }],
      success_url: successUrl(),
      cancel_url: cancelUrl(),
      client_reference_id: workspace.id,
      metadata: {
        ...baseMetadata(workspace.id, creds.livemode),
        type: "custom_credits",
        credits: String(quote.credits),
        bonus_credits: "0",
      },
      payment_intent_data: {
        metadata: {
          ...baseMetadata(workspace.id, creds.livemode),
          type: "custom_credits",
          credits: String(quote.credits),
        },
      },
    }, `checkout:custom:${workspace.id}:${randomUUID()}`);

    return session.url
      ? { ok: true, url: session.url, sessionId: session.id }
      : { ok: false, reason: "stripe_error" };
  } catch (e) {
    logStripeFailure("checkout:custom_credits", e);
    if (e instanceof ServerKeyMissingError) return { ok: false, reason: "no_server_key" };
    return { ok: false, reason: e instanceof StripeNotConfiguredError ? "payments_disabled" : "stripe_error" };
  }
}

/**
 * A subscription. `billing` selects which stored price to use.
 *
 * ANNUAL IS REFUSED UNTIL A REAL ANNUAL PRICE EXISTS — see lib/plans/pricing.ts.
 * `stripe_price_id_annual` is null on every plan today, so the branch answers
 * `not_mapped` rather than falling back to the monthly price and charging a
 * month for a year.
 */
export async function createPlanCheckout(
  supabase: Client, workspace: WorkspaceRef, email: string | null,
  planId: string, billing: "monthly" | "annual" = "monthly",
): Promise<CheckoutResult> {
  if (!paymentsEnabled()) return { ok: false, reason: "payments_disabled" };
  const creds = stripeCredentials();
  if (!creds) return { ok: false, reason: "payments_disabled" };

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, slug, name, price_cents, annual_price_cents, stripe_price_id_monthly, stripe_price_id_annual")
    .eq("id", planId).eq("active", true).maybeSingle();
  if (!plan) return { ok: false, reason: "unknown_plan" };
  // The free tier is the ABSENCE of a subscription, not a 0 zł one. Selling it
  // would create a Stripe subscription that bills nothing forever and a
  // `subscriptions` row that contradicts what the app means by "free".
  if (plan.price_cents <= 0) return { ok: false, reason: "plan_not_purchasable" };
  // Annual is not on sale until credits follow a yearly invoice correctly —
  // even if a synced annual Price exists (lib/server/pricing-offer.ts).
  if (billing === "annual" && !annualOnSale()) return { ok: false, reason: "annual_unavailable" };
  if (premiereExpiredFor(plan.slug, plan.price_cents, Date.now())) return { ok: false, reason: "offer_expired" };

  const priceId = billing === "annual" ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
  if (!priceId) return { ok: false, reason: "not_mapped" };

  // ONE LIVE SUBSCRIPTION PER WORKSPACE.
  //
  // Stripe Checkout in `mode: subscription` does not replace or merge: it
  // creates ANOTHER Subscription on the same Customer, and both then bill every
  // month, forever. Nothing in the flow warns anyone — least of all a customer
  // who has just paid, landed back on the pricing page, and clicked the same
  // button again because they were not sure it worked.
  //
  // Changing plan is a real need and it has a real home: the Stripe Billing
  // Portal, which prorates and cancels the old one. So this refuses, and the UI
  // points there.
  const { data: active, error: subError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("workspace_id", workspace.id)
    .in("status", ["active", "trialing", "past_due"])
    .limit(1);
  if (subError) return { ok: false, reason: "stripe_error" };
  if (active && active.length > 0) return { ok: false, reason: "already_subscribed" };

  try {
    const customer = await resolveStripeCustomer(supabase, workspace, email);
    if (!customer) return { ok: false, reason: "no_customer" };

    const session = await stripePost<StripeCheckoutSession>("/checkout/sessions", {
      mode: "subscription",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: planSuccessUrl(),
      cancel_url: cancelUrl(),
      client_reference_id: workspace.id,
      metadata: {
        ...baseMetadata(workspace.id, creds.livemode),
        type: "subscription",
        grovbase_plan_id: plan.id,
        billing_period: billing,
      },
      // Copied onto the Subscription, so `customer.subscription.*` events —
      // which carry no session — can still name the workspace and the plan.
      subscription_data: {
        metadata: {
          ...baseMetadata(workspace.id, creds.livemode),
          type: "subscription",
          grovbase_plan_id: plan.id,
          billing_period: billing,
          // Present only while the premiere runs (off today): the record that
          // this subscription keeps its price through renewals.
          ...premiereMetadata(Date.now()),
        },
      },
    }, `checkout:plan:${workspace.id}:${randomUUID()}`);

    return session.url
      ? { ok: true, url: session.url, sessionId: session.id }
      : { ok: false, reason: "stripe_error" };
  } catch (e) {
    logStripeFailure("checkout:plan", e);
    if (e instanceof ServerKeyMissingError) return { ok: false, reason: "no_server_key" };
    return { ok: false, reason: e instanceof StripeNotConfiguredError ? "payments_disabled" : "stripe_error" };
  }
}

/* ── 3. THE BILLING PORTAL ─────────────────────────────────────────────────*/

/**
 * Stripe's own screen for cards, invoices and cancelling — so GrovBase never
 * stores a card number and never writes a cancellation flow.
 *
 * The customer id is RESOLVED, never accepted: a portal session created for an
 * id supplied by the caller is a session into someone else's billing history.
 * A workspace with no customer yet gets `no_customer`, not a new one — there
 * is nothing to manage before a first purchase.
 */
export async function createBillingPortalSession(
  supabase: Client, workspace: WorkspaceRef,
): Promise<CheckoutResult> {
  if (!stripeCredentials()) return { ok: false, reason: "payments_disabled" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };

  // "No billing history yet" is what a workspace that has never paid is told.
  // A FAILED LOOKUP IS NOT THAT. Telling a paying customer they have no
  // billing history because an RPC errored is worse than an error message.
  const { data: customer, error: lookupError } = await supabase.rpc("stripe_customer_for", {
    p_token: token, p_workspace_id: workspace.id,
  });
  if (lookupError) {
    logStripeFailure("portal:lookup", new Error(lookupError.code ?? "unknown"));
    return { ok: false, reason: "stripe_error" };
  }
  if (typeof customer !== "string" || !customer) return { ok: false, reason: "no_customer" };

  try {
    const session = await stripePost<StripeBillingPortalSession>("/billing_portal/sessions", {
      customer,
      return_url: absoluteUrl("/credits"),
    }, `portal:${workspace.id}:${randomUUID()}`);
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (e) {
    logStripeFailure("portal", e);
    if (e instanceof ServerKeyMissingError) return { ok: false, reason: "no_server_key" };
    return { ok: false, reason: e instanceof StripeNotConfiguredError ? "payments_disabled" : "stripe_error" };
  }
}
