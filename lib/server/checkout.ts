import "server-only";
import { randomUUID } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { stripeCredentials, paymentsEnabled } from "@/lib/stripe/config";
import {
  stripePost, stripeGet, StripeApiError, StripeNotConfiguredError, type FormValue,
} from "@/lib/stripe/client";
import { creditLadder, validateCustomCredits } from "@/lib/plans/credit-price";
import { resolveStripeCustomer, ServerKeyMissingError } from "@/lib/server/billing";
import { sellable } from "@/lib/server/stripe-pricing";

/**
 * THE TILL, INSIDE GROVBASE.
 *
 * The old flow created a Stripe Checkout Session and sent the customer to
 * stripe.com. It worked, and it meant the middle of the most important journey
 * in the product happened on somebody else's page, in somebody else's design,
 * with GrovBase's name in small print.
 *
 * This module is the same transaction with the payment sheet brought inside:
 * a PaymentIntent (or a Subscription's first invoice) is created here, and the
 * browser is handed ONLY a client secret — a token scoped to that one payment,
 * which can confirm it and read nothing else. Card numbers go from Stripe's
 * iframe to Stripe. They never touch this application, and this application is
 * therefore never in scope for them.
 *
 * ─── WHAT THE BROWSER MAY SEND ──────────────────────────────────────────────
 *
 *     a package id     names a row
 *     a plan id + period
 *     a number of credits
 *
 * and nothing else. No amount, no currency, no price id, no workspace, no
 * customer. Every one of those is resolved here, and the reasons are the same
 * ones written out in lib/server/billing.ts — this module simply keeps the rule
 * when the payment sheet moves in-house, which is exactly when it would be
 * easiest to start trusting the client "just for the total".
 *
 * ─── THE PRICE PARITY CHECK ─────────────────────────────────────────────────
 *
 * Every quote is checked with `sellable()` before a single grosz is charged. A
 * catalogue row whose displayed price is not provably the amount Stripe
 * confirmed is REFUSED, not sold. That is the runtime half of the guarantee
 * migration 0117 exists for: the admin panel is the source of truth, and a row
 * that has not proved it reached Stripe does not get to take money.
 *
 * ─── AND NOTHING HERE GRANTS ANYTHING ───────────────────────────────────────
 *
 * A confirmed PaymentIntent is not a credited account. The browser finding out
 * the payment succeeded is not either. The ledger moves when the signed webhook
 * arrives and `stripe_settle_payment` runs, and this module deliberately writes
 * the same metadata the webhook already reads — so settlement works through the
 * existing, tested path rather than a second one built beside it.
 */

/* ── Stripe response shapes this module reads ──────────────────────────────*/

type StripePaymentIntent = {
  id: string;
  client_secret: string | null;
  status: string;
  amount: number;
  currency: string;
};

type StripeSubscription = {
  id: string;
  status: string;
  latest_invoice: {
    id: string;
    payment_intent: StripePaymentIntent | string | null;
  } | string | null;
  items?: { data?: { price?: { id?: string } }[] };
};

type StripeList<T> = { data: T[] };

/* ── what a customer is about to buy ───────────────────────────────────────*/

export type CheckoutKind = "credit_package" | "custom_credits" | "subscription";
export type BillingPeriod = "monthly" | "annual";

/** What the browser is allowed to ask for. */
export type CheckoutRequest =
  | { kind: "credit_package"; packageId: string }
  | { kind: "custom_credits"; credits: number }
  | { kind: "subscription"; planId: string; period?: BillingPeriod };

/**
 * The server's description of the order — the ONLY thing the summary panel is
 * rendered from. The browser never adds up a total; it displays one.
 */
export type Quote = {
  kind: CheckoutKind;
  /** Human title, already in the customer's language where the row provides it. */
  title: string;
  subtitle: string | null;
  /** Credits the customer ends up with. Base + bonus, already summed. */
  credits: number;
  baseCredits: number;
  bonusCredits: number;
  amountCents: number;
  currency: string;
  period: BillingPeriod | null;
  recurring: boolean;
  planId: string | null;
  packageId: string | null;
  /**
   * The Stripe Price this order is mapped to, or null for custom credits which
   * have no Price of their own. DIAGNOSTIC AND SUBSCRIPTION USE ONLY — the
   * amount charged comes from the catalogue row, never from here, and a Price
   * id is not a secret (Stripe's own integrations put them in the browser).
   */
  stripePriceId: string | null;
  /** Plan selling points, for the summary panel. Never used for pricing. */
  highlights: string[];
};

export type QuoteRefusal =
  | "payments_disabled" | "unknown_package" | "unknown_plan" | "plan_not_purchasable"
  | "not_mapped" | "invalid_credits" | "no_server_key" | "already_subscribed"
  /** The displayed price is not provably what Stripe would charge. */
  | "price_out_of_sync";

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; reason: QuoteRefusal };

type WorkspaceRef = { id: string; name?: string | null };

/* ── 1. PRICING THE ORDER ──────────────────────────────────────────────────*/

/**
 * What this order costs, decided entirely from the database.
 *
 * Called twice per checkout and that is deliberate: once to render the summary,
 * once again immediately before creating the PaymentIntent. If an admin changes
 * a price while a customer is sitting on the page, the second call is the one
 * that binds — so the amount charged is always the amount that was current when
 * the card was confirmed, and never a figure the page has been holding since.
 */
export async function quoteCheckout(
  supabase: Client, workspace: WorkspaceRef, req: CheckoutRequest,
): Promise<QuoteResult> {
  if (!paymentsEnabled()) return { ok: false, reason: "payments_disabled" };

  if (req.kind === "credit_package") {
    const { data: pack } = await supabase
      .from("credit_packages")
      .select("id, name, description, credits, bonus_credits, price_cents, currency, stripe_price_id, stripe_price_cents, stripe_sync_status")
      .eq("id", req.packageId).eq("active", true).maybeSingle();
    if (!pack) return { ok: false, reason: "unknown_package" };
    if (!pack.stripe_price_id) return { ok: false, reason: "not_mapped" };
    if (!sellable(pack)) return { ok: false, reason: "price_out_of_sync" };

    return {
      ok: true,
      quote: {
        kind: "credit_package",
        title: pack.name,
        subtitle: pack.description,
        credits: pack.credits + pack.bonus_credits,
        baseCredits: pack.credits,
        bonusCredits: pack.bonus_credits,
        amountCents: pack.price_cents,
        currency: pack.currency,
        period: null,
        recurring: false,
        planId: null,
        packageId: pack.id,
        stripePriceId: pack.stripe_price_id,
        highlights: [],
      },
    };
  }

  if (req.kind === "custom_credits") {
    // THE RATE CARD IS THE PACKS. Same function the slider uses in the browser,
    // so the preview and the charge are produced by one piece of code — and
    // only this side's answer reaches Stripe.
    const { data: packs } = await supabase
      .from("credit_packages")
      .select("credits, bonus_credits, price_cents, currency, stripe_price_cents, stripe_sync_status")
      .eq("active", true);
    const rows = packs ?? [];
    // A rate card built from rows that have not proved they match Stripe is a
    // rate card built on unverified numbers. Custom credits have no Price of
    // their own, so the packs ARE the price authority here.
    if (rows.length === 0 || !rows.every((p) => sellable(p))) {
      return { ok: false, reason: "price_out_of_sync" };
    }
    const ladder = creditLadder(rows);
    const q = validateCustomCredits(req.credits, ladder);
    if (!q.ok) return { ok: false, reason: "invalid_credits" };

    return {
      ok: true,
      quote: {
        kind: "custom_credits",
        title: `${q.credits} kredytów`,
        subtitle: null,
        credits: q.credits,
        baseCredits: q.credits,
        bonusCredits: 0,
        amountCents: q.amountCents,
        currency: (rows[0]?.currency ?? "PLN").toUpperCase(),
        period: null,
        recurring: false,
        planId: null,
        packageId: null,
        // Custom credits are priced from the pack ladder and charged as a bare
        // amount; there is no Price object to name.
        stripePriceId: null,
        highlights: [],
      },
    };
  }

  const period: BillingPeriod = req.period === "annual" ? "annual" : "monthly";
  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, name, description, price_cents, annual_price_cents, currency, monthly_credits, bonus_credits, features, stripe_price_id_monthly, stripe_price_id_annual, stripe_price_monthly_cents, stripe_price_annual_cents, stripe_sync_status")
    .eq("id", req.planId).eq("active", true).maybeSingle();
  if (!plan) return { ok: false, reason: "unknown_plan" };
  // The free tier is the ABSENCE of a subscription, not a 0 zł one — selling it
  // would create a subscription that bills nothing forever.
  if (plan.price_cents <= 0) return { ok: false, reason: "plan_not_purchasable" };

  const priceId = period === "annual" ? plan.stripe_price_id_annual : plan.stripe_price_id_monthly;
  if (!priceId) return { ok: false, reason: "not_mapped" };
  if (!sellable(plan, period)) return { ok: false, reason: "price_out_of_sync" };

  const amountCents = period === "annual" ? plan.annual_price_cents : plan.price_cents;

  return {
    ok: true,
    quote: {
      kind: "subscription",
      title: plan.name,
      subtitle: plan.description,
      credits: plan.monthly_credits + plan.bonus_credits,
      baseCredits: plan.monthly_credits,
      bonusCredits: plan.bonus_credits,
      amountCents,
      currency: plan.currency,
      period,
      recurring: true,
      planId: plan.id,
      packageId: null,
      stripePriceId: priceId,
      highlights: highlightsOf(plan.features),
    },
  };
}

/** A few plan capabilities worth printing beside the total. Display only. */
function highlightsOf(features: unknown): string[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];
  const bag = features as Record<string, unknown>;
  const out: string[] = [];
  for (const [key, value] of Object.entries(bag)) {
    if (out.length >= 4) break;
    if (value === true) out.push(key);
    else if (typeof value === "number" && value > 0) out.push(`${key}: ${value}`);
  }
  return out;
}

/* ── 2. STARTING THE PAYMENT ───────────────────────────────────────────────*/

export type BeginRefusal =
  | QuoteRefusal
  | "no_customer"
  /**
   * STRIPE REFUSED THE KEY, NOT THE PAYMENT.
   *
   * Separate from `stripe_error` because the two need opposite handling. A
   * `stripe_error` is a bad moment — retrying is reasonable. This is a
   * deployment whose credential is not allowed to do what the checkout needs,
   * and it will answer exactly the same way on the thousandth attempt. Telling
   * a customer to "try again" would be a lie, and telling an operator nothing
   * is how a restricted key without PaymentIntents access stays undiagnosed
   * while subscriptions keep selling.
   */
  | "stripe_unauthorized"
  | "stripe_error";

/** Where in the sequence it went wrong. Logged; never shown to a customer. */
type Stage =
  | "quote" | "customer" | "payment_intent" | "subscription"
  | "incomplete_lookup" | "status";

export type BeginResult =
  | {
      ok: true;
      /** Scoped to this one payment. Safe in the browser — it can confirm this
       *  payment and read nothing else. */
      clientSecret: string;
      quote: Quote;
      /** For the status screen to ask the server about afterwards. */
      reference: string;
    }
  | { ok: false; reason: BeginRefusal };

/**
 * Create the payment the customer is about to confirm.
 *
 * RE-QUOTES FIRST. The request that reaches here carries the same ids the page
 * was rendered from, never the amount it displayed, so the charge is priced at
 * this instant from the catalogue as it stands right now.
 */
export async function beginCheckout(
  supabase: Client, workspace: WorkspaceRef, email: string | null, req: CheckoutRequest,
): Promise<BeginResult> {
  const priced = await quoteCheckout(supabase, workspace, req);
  if (!priced.ok) {
    // A REFUSED QUOTE USED TO LEAVE NO TRACE AT ALL. `unknown_package` and
    // `price_out_of_sync` are decisions this server makes about its own data,
    // and both end as the same shrug on the customer's screen — so without this
    // line the only way to tell them apart was to guess.
    console.error("checkout.refused", JSON.stringify({
      stage: "quote" satisfies Stage,
      kind: req.kind,
      workspace: workspace.id,
      target: targetOf(req),
      reason: priced.reason,
    }));
    return priced;
  }
  const quote = priced.quote;

  const creds = stripeCredentials();
  if (!creds) return { ok: false, reason: "payments_disabled" };

  // The stage is tracked rather than inferred, because the failing call and the
  // catch block are several frames apart and "begin" told nobody anything.
  let stage: Stage = "customer";
  try {
    const customer = await resolveStripeCustomer(supabase, workspace, email);
    if (!customer) return { ok: false, reason: "no_customer" };

    stage = quote.kind === "subscription" ? "subscription" : "payment_intent";
    return quote.kind === "subscription"
      ? await beginSubscription(supabase, workspace, customer, quote, creds.livemode)
      : await beginOneOff(workspace, customer, quote, creds.livemode);
  } catch (e) {
    logFailure(stage, e, { workspaceId: workspace.id, quote });
    if (e instanceof ServerKeyMissingError) return { ok: false, reason: "no_server_key" };
    if (e instanceof StripeNotConfiguredError) return { ok: false, reason: "payments_disabled" };
    // A key that may not do this is not a transient error, and must not be
    // reported as one. See BeginRefusal.stripe_unauthorized.
    if (e instanceof StripeApiError && e.unauthorized) {
      return { ok: false, reason: "stripe_unauthorized" };
    }
    return { ok: false, reason: "stripe_error" };
  }
}

/** The internal id this request names — a package, a plan, or a credit count. */
function targetOf(req: CheckoutRequest): string {
  return req.kind === "credit_package" ? req.packageId
    : req.kind === "subscription" ? req.planId
    : `credits:${req.credits}`;
}

/** The marks the webhook already knows how to read. */
function baseMetadata(workspaceId: string, livemode: boolean): Record<string, string> {
  return {
    grovbase_workspace_id: workspaceId,
    environment: livemode ? "production" : "test",
  };
}

/**
 * A pack or a custom top-up: one PaymentIntent, priced here.
 *
 * `automatic_payment_methods` is what makes BLIK, Przelewy24, cards and wallets
 * appear or not appear on their own. Stripe decides from the amount, the
 * currency, the customer's country, the device and what is enabled on the
 * account — which is the only place that can decide correctly. A hardcoded list
 * would offer BLIK to a customer paying in EUR and Apple Pay on a Windows
 * desktop, and would silently stop offering a method the day one is turned on
 * in the dashboard.
 *
 * THE METADATA IS THE CONTRACT WITH THE WEBHOOK. `type` must be
 * `credit_package` or `custom_credits`, because `onPaymentIntentSucceeded`
 * settles exactly those two and ignores everything else. A pack carries its row
 * id and the webhook reads the CREDITS FROM THAT ROW; a custom top-up carries
 * the figure this server computed, which is the only case where metadata is the
 * authority — and only because nothing else could be.
 */
async function beginOneOff(
  workspace: WorkspaceRef, customer: string, quote: Quote, livemode: boolean,
): Promise<BeginResult> {
  const metadata: Record<string, string> = {
    ...baseMetadata(workspace.id, livemode),
    type: quote.kind,
    credits: String(quote.baseCredits),
    bonus_credits: String(quote.bonusCredits),
    ...(quote.packageId ? { grovbase_package_id: quote.packageId } : {}),
  };

  const intent = await stripePost<StripePaymentIntent>("/payment_intents", {
    amount: quote.amountCents,
    currency: quote.currency.toLowerCase(),
    customer,
    automatic_payment_methods: { enabled: true },
    description: quote.kind === "credit_package"
      ? `GrovBase — pakiet ${quote.title}`
      : `GrovBase — ${quote.credits} kredytów`,
    metadata,
  // A FRESH KEY PER ATTEMPT, on purpose. A deterministic key would be wrong in
  // both directions here: it would refuse a customer who legitimately buys the
  // same pack twice in a day, and it would hand back a stale intent to someone
  // who abandoned one and came back. Abandoned intents cost nothing and expire.
  //
  // Paying twice is prevented where it actually matters — at settlement, where
  // `payments (provider, provider_payment_id)` makes one PaymentIntent grant
  // exactly once no matter how many events describe it.
  }, `pi:${workspace.id}:${randomUUID()}`);

  // THE INTENT ID IS SAFE TO LOG AND THE SECRET IS NOT. `pi_…` names a payment
  // for support to look up; `pi_…_secret_…` is the token that CONFIRMS it. Only
  // the first ever appears here.
  if (!intent.client_secret) {
    console.error("checkout.no_client_secret", JSON.stringify({
      stage: "payment_intent" satisfies Stage,
      kind: quote.kind, workspace: workspace.id,
      package: quote.packageId, intent: intent.id, status: intent.status,
    }));
    return { ok: false, reason: "stripe_error" };
  }
  // The same assertion the price sync makes, for the same reason: this is the
  // seam where a displayed total and a charged total could come apart.
  if (intent.amount !== quote.amountCents) {
    console.error("checkout.amount_mismatch", JSON.stringify({
      stage: "payment_intent" satisfies Stage,
      kind: quote.kind, workspace: workspace.id, package: quote.packageId,
      intent: intent.id, charged: intent.amount, quoted: quote.amountCents,
    }));
    return { ok: false, reason: "stripe_error" };
  }

  return { ok: true, clientSecret: intent.client_secret, quote, reference: intent.id };
}

/**
 * A plan: a real Subscription, created incomplete, paid through the same sheet.
 *
 * `payment_behavior: default_incomplete` is what makes this possible. The
 * Subscription exists immediately but does not activate until its first invoice
 * is paid, and that invoice's PaymentIntent is what the Payment Element
 * confirms. Without it Stripe would try to charge a saved card on the spot and
 * there would be nothing for the customer to confirm.
 *
 * `expand` reaches through invoice to PaymentIntent in one call. The shape is
 * the one pinned by `Stripe-Version: 2024-06-20` in lib/stripe/client.ts — the
 * field moved in later releases, and the pin is what makes it safe to read this
 * one rather than guess which account default is in force.
 */
async function beginSubscription(
  supabase: Client, workspace: WorkspaceRef, customer: string, quote: Quote, livemode: boolean,
): Promise<BeginResult> {
  // ONE LIVE SUBSCRIPTION PER WORKSPACE. Stripe does not replace or merge:
  // subscribing twice bills twice, forever, and nothing warns anyone.
  const { data: active, error: subError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("workspace_id", workspace.id)
    .in("status", ["active", "trialing", "past_due"])
    .limit(1);
  if (subError) return { ok: false, reason: "stripe_error" };
  if (active && active.length > 0) return { ok: false, reason: "already_subscribed" };

  const priceId = await priceIdFor(supabase, quote);
  if (!priceId) return { ok: false, reason: "not_mapped" };

  // REUSE AN INCOMPLETE ATTEMPT RATHER THAN STACK ANOTHER ONE.
  //
  // A customer who opens checkout, hesitates, reloads and tries again would
  // otherwise leave a trail of incomplete Subscriptions — and if two of them
  // were ever completed, that workspace is billed twice every month until
  // somebody notices. Stripe expires incomplete subscriptions after about a
  // day, which is far too long to rely on.
  //
  // So: an existing incomplete subscription on the SAME price is resumed by
  // handing back its own client secret. The customer finishes the attempt they
  // started instead of starting a parallel one.
  const existing = await incompleteSubscriptionFor(customer, priceId);
  if (existing) {
    const secret = clientSecretOf(existing);
    if (secret) return { ok: true, clientSecret: secret, quote, reference: existing.id };
  }

  const metadata: Record<string, string> = {
    ...baseMetadata(workspace.id, livemode),
    type: "subscription",
    grovbase_plan_id: quote.planId ?? "",
    billing_period: quote.period ?? "monthly",
  };

  const sub = await stripePost<StripeSubscription>("/subscriptions", {
    customer,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
    // Copied onto the Subscription so `customer.subscription.*` — which carry
    // no session and no invoice — can still name the workspace and the plan.
    metadata,
  } as Record<string, FormValue>, `sub:${workspace.id}:${priceId}:${randomUUID()}`);

  const secret = clientSecretOf(sub);
  if (!secret) {
    console.error("checkout.subscription_without_secret", sub.id, sub.status);
    return { ok: false, reason: "stripe_error" };
  }
  return { ok: true, clientSecret: secret, quote, reference: sub.id };
}

/** The mapping column for the period being bought. Never a price from a client. */
async function priceIdFor(supabase: Client, quote: Quote): Promise<string | null> {
  if (!quote.planId) return null;
  const { data } = await supabase
    .from("subscription_plans")
    .select("stripe_price_id_monthly, stripe_price_id_annual")
    .eq("id", quote.planId).maybeSingle();
  if (!data) return null;
  return quote.period === "annual" ? data.stripe_price_id_annual : data.stripe_price_id_monthly;
}

async function incompleteSubscriptionFor(
  customer: string, priceId: string,
): Promise<StripeSubscription | null> {
  try {
    const list = await stripeGet<StripeList<StripeSubscription>>("/subscriptions", {
      customer, status: "incomplete", limit: 10,
      expand: ["data.latest_invoice.payment_intent"],
    });
    return list.data.find((s) => s.items?.data?.[0]?.price?.id === priceId) ?? null;
  } catch (e) {
    // Not being able to look is not a reason to refuse the sale; it only means
    // this optimisation is skipped for this attempt.
    logFailure("incomplete_lookup", e);
    return null;
  }
}

function clientSecretOf(sub: StripeSubscription): string | null {
  const invoice = sub.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;
  const pi = invoice.payment_intent;
  if (!pi || typeof pi === "string") return null;
  return pi.client_secret;
}

/* ── 3. WHAT ACTUALLY HAPPENED ─────────────────────────────────────────────*/

export type SettlementState =
  /** Stripe says paid. The webhook may or may not have landed yet. */
  | "paid"
  /** Paid AND credited — `payments` has the row, the ledger moved. */
  | "credited"
  | "processing"
  | "requires_action"
  | "failed"
  | "unknown";

export type StatusResult = {
  state: SettlementState;
  amountCents: number | null;
  currency: string | null;
  credits: number | null;
  kind: string | null;
};

/**
 * THE STATUS SCREEN'S ONLY SOURCE, AND IT GRANTS NOTHING.
 *
 * The browser arrives back from a redirect — or never left — holding a
 * PaymentIntent id that Stripe put in the URL. That id is not evidence of
 * anything on its own: anyone can type one. So this asks STRIPE what the
 * payment's status is, and asks the DATABASE whether the webhook has credited
 * it, and reports both.
 *
 * It never writes. "Zapłacono" and "kredyty dodane" are two different facts and
 * the screen says which one it has — because telling a customer their credits
 * arrived before the ledger moved is how support tickets are made.
 */
export async function checkoutStatus(
  supabase: Client, workspace: WorkspaceRef, reference: string,
): Promise<StatusResult> {
  const empty: StatusResult = {
    state: "unknown", amountCents: null, currency: null, credits: null, kind: null,
  };
  if (!stripeCredentials()) return empty;
  if (typeof reference !== "string" || !/^(pi|sub)_[A-Za-z0-9_]+$/.test(reference)) return empty;

  // THE LEDGER FIRST. A settled payment is the strongest answer available and
  // it is scoped to THIS workspace by the query, so a reference belonging to
  // somebody else's payment reveals nothing.
  const settled = await settledPayment(supabase, workspace.id, reference);
  if (settled) {
    return {
      state: "credited",
      amountCents: settled.amount_cents,
      currency: settled.currency,
      credits: settled.credits_granted,
      kind: settled.kind,
    };
  }

  try {
    if (reference.startsWith("sub_")) {
      const sub = await stripeGet<StripeSubscription>(`/subscriptions/${reference}`, {
        expand: ["latest_invoice.payment_intent"],
      });
      const invoice = typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
      const pi = invoice && typeof invoice.payment_intent === "object" ? invoice.payment_intent : null;
      return {
        state: sub.status === "active" || sub.status === "trialing"
          ? "paid"
          : mapIntentStatus(pi?.status ?? null),
        amountCents: pi?.amount ?? null,
        currency: pi?.currency?.toUpperCase() ?? null,
        credits: null,
        kind: "subscription",
      };
    }

    const pi = await stripeGet<StripePaymentIntent>(`/payment_intents/${reference}`, {});
    return {
      state: mapIntentStatus(pi.status),
      amountCents: pi.amount,
      currency: pi.currency.toUpperCase(),
      credits: null,
      kind: null,
    };
  } catch (e) {
    logFailure("status", e);
    return empty;
  }
}

/**
 * Has the webhook credited this one?
 *
 * Read through the dispatch-token function rather than PostgREST, because
 * `payments` is not readable by a member role — and because this must answer
 * "credited" only from the row the webhook itself wrote.
 */
async function settledPayment(
  supabase: Client, workspaceId: string, reference: string,
): Promise<{ amount_cents: number; currency: string; credits_granted: number; kind: string | null } | null> {
  const token = dispatchToken();
  if (!token) return null;
  const { data, error } = await supabase.rpc("stripe_payment_status", {
    p_token: token, p_workspace_id: workspaceId, p_reference: reference,
  });
  if (error || !data) return null;
  const row = data as { found?: boolean; amount_cents?: number; currency?: string;
    credits_granted?: number; kind?: string | null };
  if (!row.found) return null;
  return {
    amount_cents: row.amount_cents ?? 0,
    currency: row.currency ?? "PLN",
    credits_granted: row.credits_granted ?? 0,
    kind: row.kind ?? null,
  };
}

function mapIntentStatus(status: string | null): SettlementState {
  switch (status) {
    case "succeeded": return "paid";
    case "processing": return "processing";
    case "requires_action":
    case "requires_confirmation":
    case "requires_payment_method": return "requires_action";
    case "canceled": return "failed";
    default: return "unknown";
  }
}

/**
 * THE LINE THAT HAS TO BE ENOUGH, because nobody gets a second run at a
 * customer's failed purchase.
 *
 * ─── WHAT IT CARRIES ────────────────────────────────────────────────────────
 *
 *   stage       which call failed — quote, customer, payment_intent,
 *               subscription. The previous version logged the literal string
 *               "begin" for all four, which is how a 403 on PaymentIntents
 *               looked identical to a database problem.
 *   kind        subscription / credit_package / custom_credits — the single
 *               fact that separates the path that works from the one that does
 *               not.
 *   workspace   the internal id, so the attempt can be found again.
 *   package /
 *   plan /
 *   price       the internal row and the Stripe Price it is mapped to.
 *   amount      what would have been charged, in the smallest unit.
 *   status /
 *   type /
 *   code /
 *   param       Stripe's own classification of the refusal.
 *   request     Stripe's Request-Id, which is the ONE value that ties this line
 *               to the matching entry in the account's request log.
 *
 * ─── WHAT IT MUST NEVER CARRY, AND DOES NOT ─────────────────────────────────
 *
 * No client secret. No secret or restricted key — `StripeApiError` is built
 * from the response body and never holds the credential, and nothing here
 * reads process.env. No webhook signing secret. No card details, which this
 * process has never had and cannot obtain: they go from Stripe's iframe to
 * Stripe. No customer email.
 *
 * `e.message` is Stripe's own text. Stripe masks the key inside it — the
 * production line read `rk_live_****…QHJ7kw` — so the identifiable part is the
 * account, not the credential.
 *
 * It is one JSON object rather than positional arguments so that a log search
 * can match on a field instead of on word order.
 */
function logFailure(
  stage: Stage, e: unknown, ctx?: { workspaceId: string; quote: Quote },
): void {
  const where = {
    stage,
    kind: ctx?.quote.kind ?? null,
    workspace: ctx?.workspaceId ?? null,
    package: ctx?.quote.packageId ?? null,
    plan: ctx?.quote.planId ?? null,
    price: ctx?.quote.stripePriceId ?? null,
    amount: ctx?.quote.amountCents ?? null,
    currency: ctx?.quote.currency ?? null,
  };

  if (e instanceof StripeApiError) {
    console.error("checkout.stripe", JSON.stringify({
      ...where,
      status: e.status,
      type: e.type ?? null,
      code: e.code ?? null,
      param: e.param ?? null,
      request: e.requestId ?? null,
      // Named explicitly rather than left to be inferred from the status, so an
      // operator scanning for the cause does not have to know that 403 means
      // "the key is not allowed to" rather than "the payment was rejected".
      unauthorized: e.unauthorized,
      message: e.message,
    }));
    return;
  }
  console.error("checkout.failed", JSON.stringify({
    ...where,
    message: e instanceof Error ? e.message : "unknown",
  }));
}
