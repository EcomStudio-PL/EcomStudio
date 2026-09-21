import "server-only";
import { randomUUID } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { absoluteUrl } from "@/lib/site";
import { dispatchToken } from "@/lib/server/server-token";
import { stripeCredentials, paymentsEnabled } from "@/lib/stripe/config";
import {
  stripePost, StripeNotConfiguredError,
  type StripeCheckoutSession, type StripeCustomer, type StripeBillingPortalSession,
} from "@/lib/stripe/client";
import { creditLadder, validateCustomCredits } from "@/lib/plans/credit-price";

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

/** No GROVBASE_SERVER_KEY: nothing can authenticate itself to the database. */
export class ServerKeyMissingError extends Error {
  constructor() { super("server_key_missing"); this.name = "ServerKeyMissingError"; }
}

export type CheckoutRefusal =
  | "payments_disabled" | "unknown_package" | "unknown_plan" | "plan_not_purchasable"
  | "not_mapped" | "no_customer" | "invalid_credits" | "no_server_key" | "stripe_error";

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

  const { data: existing } = await supabase.rpc("stripe_customer_for", {
    p_token: token, p_workspace_id: workspace.id,
  });
  if (typeof existing === "string" && existing) return existing;

  const customer = await stripePost<StripeCustomer>("/customers", {
    email: email ?? undefined,
    name: workspace.name ?? undefined,
    metadata: {
      grovbase_workspace_id: workspace.id,
      environment: creds.livemode ? "production" : "test",
    },
  }, `customer:${workspace.id}`);

  const { data: linked } = await supabase.rpc("stripe_link_customer", {
    p_token: token,
    p_workspace_id: workspace.id,
    p_stripe_customer_id: customer.id,
    p_livemode: creds.livemode,
  });
  return typeof linked === "string" && linked ? linked : null;
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
    .select("id, name, credits, bonus_credits, price_cents, currency, stripe_price_id")
    .eq("id", packageId).eq("active", true).maybeSingle();
  if (!pack) return { ok: false, reason: "unknown_package" };
  if (!pack.stripe_price_id) return { ok: false, reason: "not_mapped" };

  try {
    const customer = await resolveStripeCustomer(supabase, workspace, email);
    if (!customer) return { ok: false, reason: "no_customer" };

    const session = await stripePost<StripeCheckoutSession>("/checkout/sessions", {
      mode: "payment",
      customer,
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
    .select("credits, bonus_credits, price_cents, currency")
    .eq("active", true);
  const ladder = creditLadder(packs ?? []);
  const quote = validateCustomCredits(creditsRequested, ladder);
  if (!quote.ok) return { ok: false, reason: "invalid_credits" };

  const currency = (packs?.[0]?.currency ?? "PLN").toLowerCase();

  try {
    const customer = await resolveStripeCustomer(supabase, workspace, email);
    if (!customer) return { ok: false, reason: "no_customer" };

    const session = await stripePost<StripeCheckoutSession>("/checkout/sessions", {
      mode: "payment",
      customer,
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

  const priceId = billing === "annual" ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
  if (!priceId) return { ok: false, reason: "not_mapped" };

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
        },
      },
    }, `checkout:plan:${workspace.id}:${randomUUID()}`);

    return session.url
      ? { ok: true, url: session.url, sessionId: session.id }
      : { ok: false, reason: "stripe_error" };
  } catch (e) {
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

  const { data: customer } = await supabase.rpc("stripe_customer_for", {
    p_token: token, p_workspace_id: workspace.id,
  });
  if (typeof customer !== "string" || !customer) return { ok: false, reason: "no_customer" };

  try {
    const session = await stripePost<StripeBillingPortalSession>("/billing_portal/sessions", {
      customer,
      return_url: absoluteUrl("/credits"),
    }, `portal:${workspace.id}:${randomUUID()}`);
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (e) {
    if (e instanceof ServerKeyMissingError) return { ok: false, reason: "no_server_key" };
    return { ok: false, reason: e instanceof StripeNotConfiguredError ? "payments_disabled" : "stripe_error" };
  }
}
