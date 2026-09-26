import "server-only";
import { createHash, randomUUID } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { stripeCredentials } from "@/lib/stripe/config";
import {
  stripeGet, stripePost, StripeApiError, StripeNotConfiguredError, type FormValue,
} from "@/lib/stripe/client";

/**
 * GROVNEWS PREMIUM — THE MONEY SIDE, KEPT BESIDE THE PLAN BILLING, NOT INSIDE IT.
 *
 * GrovNews is an ADD-ON. A workspace on Free, Starter, Pro or Agency may also
 * hold GrovNews, so nothing here reads or writes `subscriptions` (the plan
 * table, which every plan reader queries with `.eq("status","active")
 * .maybeSingle()`), nothing here sees `payments`, and nothing here can reach the
 * credit ledger. What IS shared is deliberately shared: the one Stripe account,
 * the one Customer per workspace, the one webhook and its exactly-once key.
 *
 * ─── WHAT THE BROWSER DECIDES ───────────────────────────────────────────────
 *
 * Nothing about money. The price, the Price id, the Product, the coupon of a
 * discount code and whether a code applies are all read here from the database
 * (migration 0123). Access comes only from the signed webhook — never from a
 * success URL, a confirmed PaymentIntent in a browser, or creating a checkout.
 */

/* ── Stripe shapes read here ───────────────────────────────────────────────*/

type StripeProduct = { id: string };
type StripePrice = {
  id: string; unit_amount: number | null; currency: string;
  recurring: { interval: string } | null;
};
type StripePaymentIntent = { id: string; client_secret: string | null; amount: number; status: string };
export type GrovNewsStripeSubscription = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items?: { data?: { price?: { id?: string } }[] };
  latest_invoice: { id: string; payment_intent: StripePaymentIntent | string | null } | string | null;
};
type StripeCoupon = { id: string };

/* ── the config, as the server sees it ─────────────────────────────────────*/

export type GrovNewsBilling = {
  sales_enabled: boolean;
  price_cents: number | null;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
  sync_status: string;
  sync_error: string | null;
  price_changed_at: string | null;
};

/** A Price that may be sold: sales on, and Stripe's confirmed amount is the
 *  displayed amount — the same parity rule `sellable()` applies to plans. */
export function grovNewsSellable(b: GrovNewsBilling | null): b is GrovNewsBilling & { stripe_price_id: string; price_cents: number } {
  return Boolean(b && b.sales_enabled && b.sync_status === "synced" && b.stripe_price_id
    && typeof b.price_cents === "number" && b.stripe_price_cents === b.price_cents);
}

export async function readGrovNewsBilling(supabase: Client, token: string): Promise<GrovNewsBilling | null> {
  const { data, error } = await supabase.rpc("grovnews_billing_state", { p_token: token });
  if (error) throw new Error(`grovnews_billing_state:${error.code ?? "unknown"}`);
  return (data ?? null) as GrovNewsBilling | null;
}

/* ── 1. THE PRICE (admin) ──────────────────────────────────────────────────*/

export type GrovNewsPriceRefusal =
  | "payments_disabled" | "no_server_key" | "invalid_amount" | "stripe_error"
  /** Stripe has the new Price; this database did not take it. */
  | "reconcile_required"
  /** Someone else changed the price at the same moment; theirs stands. */
  | "conflict";

export type GrovNewsPriceOutcome =
  | { ok: true; changed: boolean; priceId: string; amountCents: number; archived: string | null }
  | { ok: false; reason: GrovNewsPriceRefusal; detail?: string };

export const GROVNEWS_MIN_CENTS = 200;
export const GROVNEWS_MAX_CENTS = 1_000_000;

/**
 * SET THE MONTHLY PRICE. The same order of operations as the plan price sync
 * (lib/server/stripe-pricing.ts), for the same reasons:
 *
 *   1. mark 'syncing'
 *   2. the ONE Product — created once (idempotency key), stored at once
 *   3. a NEW monthly Price — Prices are immutable; the key includes the Price
 *      it replaces, so a retry returns the same object and a round trip
 *      (29 → 39 → 29) does not resurrect an archived one
 *   4. check Stripe echoed exactly what was asked
 *   5. grovnews_billing_apply_price — compare-and-swap on the replaced Price
 *   6. archive the old Price for new sales (existing subscribers stay on it:
 *      Stripe keeps billing an archived Price, and nobody is migrated)
 *
 * A Stripe failure leaves the live price exactly as it was and still on sale.
 */
export async function setGrovNewsPrice(
  supabase: Client, amountCents: number, actorId: string,
): Promise<GrovNewsPriceOutcome> {
  if (!stripeCredentials()) return { ok: false, reason: "payments_disabled" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };
  if (!Number.isSafeInteger(amountCents) || amountCents < GROVNEWS_MIN_CENTS || amountCents > GROVNEWS_MAX_CENTS) {
    return { ok: false, reason: "invalid_amount" };
  }

  let state: GrovNewsBilling | null;
  try {
    state = await readGrovNewsBilling(supabase, token);
  } catch (e) {
    logFailure("price:read", e);
    return { ok: false, reason: "stripe_error" };
  }
  if (!state) return { ok: false, reason: "stripe_error" };

  // Nothing to do: Stripe already confirmed exactly this amount.
  if (state.stripe_price_id && state.sync_status === "synced"
      && state.price_cents === amountCents && state.stripe_price_cents === amountCents) {
    return { ok: true, changed: false, priceId: state.stripe_price_id, amountCents, archived: null };
  }

  const previous = state.stripe_price_id;
  // A failed attempt must not take a working price off sale: it goes back to
  // what it was, with the reason attached for the admin.
  const restore = previous && state.sync_status === "synced" ? "synced" : "failed";
  await mark(supabase, token, "syncing", null, null);

  try {
    let productId = state.stripe_product_id;
    if (!productId) {
      const product = await stripePost<StripeProduct>("/products", {
        name: "GrovNews Premium",
        metadata: { grovbase_entity: "grovnews" },
      }, "product:grovnews:v1");
      productId = product.id;
      // Stored before anything else can fail, so no retry ever creates a
      // second Product.
      await mark(supabase, token, "syncing", null, productId);
    }

    // A FRESH KEY PER ATTEMPT. A deterministic key would let a retry within
    // Stripe's 24 h window replay a Price this module has since archived, and
    // write that inactive Price as the live one. Two parallel attempts now make
    // two Prices; the compare-and-swap below lets exactly one go live and the
    // other is archived — never the live one.
    const price = await stripePost<StripePrice>("/prices", {
      product: productId,
      unit_amount: amountCents,
      currency: "pln",
      recurring: { interval: "month" },
      metadata: { grovbase_entity: "grovnews" },
    }, `price:grovnews:${amountCents}:${previous ?? "none"}:${randomUUID()}`);

    if (price.unit_amount !== amountCents || price.currency !== "pln" || price.recurring?.interval !== "month") {
      await archive(price.id);
      await mark(supabase, token, restore, "stripe_returned_a_different_price", null);
      return { ok: false, reason: "stripe_error", detail: "amount_mismatch" };
    }

    const { data, error } = await supabase.rpc("grovnews_billing_apply_price", {
      p_token: token, p_expected_previous: previous, p_product_id: productId, p_price_id: price.id,
      p_amount: amountCents, p_currency: "PLN", p_actor: actorId,
    });
    if (error) {
      console.error("grovnews.price.apply_failed", error.code ?? "unknown");
      await archiveUnlessLive(supabase, token, price.id);
      await mark(supabase, token, restore, "apply_failed", null);
      return { ok: false, reason: "reconcile_required" };
    }
    const applied = data as { status?: string; previous_price_id?: string | null } | null;
    if (applied?.status === "conflict") {
      // Someone else's change won. Put this Price away — unless it is, after
      // all, the live one — and leave the winner's status as it stands.
      await archiveUnlessLive(supabase, token, price.id);
      return { ok: false, reason: "conflict" };
    }
    if (applied?.status !== "applied") {
      await archiveUnlessLive(supabase, token, price.id);
      await mark(supabase, token, restore, "apply_refused", null);
      return { ok: false, reason: "reconcile_required" };
    }
    const archived = await archive(applied.previous_price_id ?? null);
    return { ok: true, changed: true, priceId: price.id, amountCents, archived };
  } catch (e) {
    logFailure("price", e);
    await mark(supabase, token, restore, reason(e), null);
    if (e instanceof StripeNotConfiguredError) return { ok: false, reason: "payments_disabled" };
    return { ok: false, reason: "stripe_error", detail: reason(e) };
  }
}

async function mark(
  supabase: Client, token: string, status: string, detail: string | null, productId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("grovnews_billing_mark", {
    p_token: token, p_status: status, p_error: detail, p_product_id: productId,
  });
  if (error) console.error("grovnews.price.mark_failed", status, error.code ?? "unknown");
}

/** Archive a Price this attempt created — but NEVER the one new sales use. */
async function archiveUnlessLive(supabase: Client, token: string, priceId: string): Promise<void> {
  try {
    const live = await readGrovNewsBilling(supabase, token);
    if (live?.stripe_price_id === priceId) return;
  } catch {
    // Cannot tell what is live: leaving an extra active Price costs nothing,
    // archiving the live one stops every sale.
    return;
  }
  await archive(priceId);
}

async function archive(priceId: string | null): Promise<string | null> {
  if (!priceId) return null;
  try {
    await stripePost<StripePrice>(`/prices/${priceId}`, { active: false }, `archive:${priceId}`);
    return priceId;
  } catch (e) {
    logFailure("archive", e);
    return null;
  }
}

/* ── 2. THE SUBSCRIPTION (customer) ────────────────────────────────────────*/

export type GrovNewsBeginRefusal =
  | "payments_disabled" | "no_server_key" | "grovnews_unavailable"
  | "already_subscribed" | "in_progress" | "stripe_error";

export type GrovNewsBegin =
  | { ok: true; clientSecret: string; reference: string; amountCents: number }
  | { ok: false; reason: GrovNewsBeginRefusal };

const GROVNEWS_TYPE = "grovnews_subscription";

/** Is this Stripe subscription one of THIS user's GrovNews subscriptions? */
function isOwnGrovNews(sub: GrovNewsStripeSubscription, userId: string): boolean {
  return sub.metadata?.type === GROVNEWS_TYPE && sub.metadata?.grovbase_user_id === userId;
}

function secretOf(sub: GrovNewsStripeSubscription): { secret: string; amount: number } | null {
  const invoice = sub.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;
  const pi = invoice.payment_intent;
  if (!pi || typeof pi === "string" || !pi.client_secret) return null;
  return { secret: pi.client_secret, amount: pi.amount };
}

/**
 * START (OR RESUME) ONE GROVNEWS SUBSCRIPTION FOR THIS USER.
 *
 * TWO SUBSCRIPTIONS ARE NOT POSSIBLE BY ACCIDENT, and a disabled button is not
 * what prevents it:
 *
 *   · the database refuses when this user already has a live GrovNews
 *     subscription (the webhook's record);
 *   · Stripe itself is asked too, because the webhook may not have landed yet
 *     for a payment made seconds ago — a live one there is also a refusal;
 *   · a per-user lock (grovnews_checkout_begin) lets exactly one request create
 *     a subscription; a parallel or double-clicked one is handed the SAME
 *     incomplete subscription to finish, or told "in progress";
 *   · an incomplete attempt from earlier is resumed rather than stacked.
 *
 * Creating the subscription grants nothing. Access starts when the signed
 * invoice.paid arrives.
 */
export async function beginGrovNewsSubscription(
  supabase: Client, args: {
    userId: string; workspaceId: string; customer: string; priceId: string;
    amountCents: number; livemode: boolean;
  },
): Promise<GrovNewsBegin> {
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };
  const attempt = randomUUID();

  const { data: lockData, error: lockError } = await supabase.rpc("grovnews_checkout_begin", {
    p_token: token, p_user_id: args.userId, p_attempt: attempt,
  });
  if (lockError) {
    console.error("grovnews.checkout.lock_failed", lockError.code ?? "unknown");
    return { ok: false, reason: "stripe_error" };
  }
  const lock = (lockData ?? {}) as { status?: string; stripe_subscription_id?: string | null };
  if (lock.status === "already_active") return { ok: false, reason: "already_subscribed" };
  if (lock.status === "in_progress") {
    // The first request already started a subscription: hand back ITS payment,
    // so a double click completes one purchase instead of starting two.
    if (lock.stripe_subscription_id) {
      const sub = await stripeGet<GrovNewsStripeSubscription>(`/subscriptions/${lock.stripe_subscription_id}`, {
        expand: ["latest_invoice.payment_intent"],
      });
      const s = sub.status === "incomplete" && isOwnGrovNews(sub, args.userId) ? secretOf(sub) : null;
      // Only at the price shown now: a price changed mid-lock is not resumed.
      if (s && s.amount === args.amountCents) {
        return { ok: true, clientSecret: s.secret, reference: sub.id, amountCents: s.amount };
      }
    }
    return { ok: false, reason: "in_progress" };
  }
  if (lock.status !== "locked") return { ok: false, reason: "stripe_error" };

  const release = async (subscriptionId: string | null) => {
    const { error } = await supabase.rpc("grovnews_checkout_attach", {
      p_token: token, p_user_id: args.userId, p_attempt: attempt, p_subscription_id: subscriptionId,
    });
    if (error) console.error("grovnews.checkout.attach_failed", error.code ?? "unknown");
  };

  try {
    // WHAT STRIPE KNOWS RIGHT NOW about this user's GrovNews subscriptions on
    // this customer — newest first.
    const list = await stripeGet<{ data: GrovNewsStripeSubscription[] }>("/subscriptions", {
      customer: args.customer, status: "all", limit: 20,
      expand: ["data.latest_invoice.payment_intent"],
    });
    const own = list.data.filter((s) => isOwnGrovNews(s, args.userId));
    if (own.some((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")) {
      await release(null);
      return { ok: false, reason: "already_subscribed" };
    }
    const resumable = own.find((s) => s.status === "incomplete" && s.items?.data?.[0]?.price?.id === args.priceId);
    const resumed = resumable ? secretOf(resumable) : null;
    if (resumable && resumed && resumed.amount === args.amountCents) {
      await release(resumable.id);
      return { ok: true, clientSecret: resumed.secret, reference: resumable.id, amountCents: resumed.amount };
    }

    const sub = await stripePost<GrovNewsStripeSubscription>("/subscriptions", {
      customer: args.customer,
      items: [{ price: args.priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      // The contract with the webhook: this is GrovNews, for THIS user. It is
      // never read as a plan (no grovbase_plan_id, type is not "subscription").
      metadata: {
        grovbase_workspace_id: args.workspaceId,
        grovbase_user_id: args.userId,
        environment: args.livemode ? "production" : "test",
        type: GROVNEWS_TYPE,
      },
    } as Record<string, FormValue>, `grovnews-sub:${args.userId}:${attempt}`);
    await release(sub.id);

    const s = secretOf(sub);
    if (!s) {
      console.error("grovnews.checkout.no_client_secret", sub.id, sub.status);
      return { ok: false, reason: "stripe_error" };
    }
    // The seam where a displayed and a charged amount could come apart.
    if (s.amount !== args.amountCents) {
      console.error("grovnews.checkout.amount_mismatch", JSON.stringify({
        subscription: sub.id, charged: s.amount, quoted: args.amountCents,
      }));
      return { ok: false, reason: "stripe_error" };
    }
    return { ok: true, clientSecret: s.secret, reference: sub.id, amountCents: s.amount };
  } catch (e) {
    logFailure("checkout", e);
    await release(null);
    throw e;
  }
}

/* ── 3. CANCEL / RESUME AT PERIOD END (customer) ───────────────────────────*/

export type GrovNewsCancelResult =
  | { ok: true; cancelAtPeriodEnd: boolean }
  | { ok: false; reason: "payments_disabled" | "no_server_key" | "no_subscription" | "stripe_error" };

/**
 * Cancelling keeps what was paid for: `cancel_at_period_end` stops the NEXT
 * renewal and access runs to the end of the paid period. Resuming undoes that
 * before the period ends. The subscription is found from the SESSION's user —
 * there is no id a caller could pass to act on somebody else's.
 */
export async function setGrovNewsCancelAtPeriodEnd(
  supabase: Client, userId: string, cancel: boolean,
): Promise<GrovNewsCancelResult> {
  if (!stripeCredentials()) return { ok: false, reason: "payments_disabled" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };

  const { data, error } = await supabase.rpc("grovnews_subscription_for", { p_token: token, p_user_id: userId });
  if (error) return { ok: false, reason: "stripe_error" };
  const sub = (data ?? null) as { stripe_subscription_id?: string; live?: boolean } | null;
  if (!sub?.stripe_subscription_id || !sub.live) return { ok: false, reason: "no_subscription" };

  try {
    const updated = await stripePost<GrovNewsStripeSubscription>(`/subscriptions/${sub.stripe_subscription_id}`, {
      cancel_at_period_end: cancel,
    }, `grovnews-cancel:${sub.stripe_subscription_id}:${cancel}:${randomUUID()}`);
    const flag = updated.cancel_at_period_end === true;
    // Reflect what Stripe just confirmed; subscription.updated will agree.
    await supabase.rpc("grovnews_subscription_set_cancel", {
      p_token: token, p_user_id: userId, p_subscription_id: sub.stripe_subscription_id, p_cancel: flag,
    });
    return { ok: true, cancelAtPeriodEnd: flag };
  } catch (e) {
    logFailure("cancel", e);
    return { ok: false, reason: e instanceof StripeNotConfiguredError ? "payments_disabled" : "stripe_error" };
  }
}

/** For the status screen: has the webhook recorded this subscription as paid? */
export async function grovNewsPaidFor(
  supabase: Client, userId: string, subscriptionId: string,
): Promise<boolean> {
  const token = dispatchToken();
  if (!token) return false;
  const { data, error } = await supabase.rpc("grovnews_subscription_for", { p_token: token, p_user_id: userId });
  if (error || !data) return false;
  const sub = data as { stripe_subscription_id?: string; has_access?: boolean };
  return sub.stripe_subscription_id === subscriptionId && sub.has_access === true;
}

/* ── 4. LAUNCH CAMPAIGN (admin activation, customer claim) ─────────────────*/

export type LaunchActivateResult =
  | { ok: true }
  | { ok: false; reason: "payments_disabled" | "no_server_key" | "not_draft" | "invalid" | "stripe_error" | string };

type CampaignRow = {
  id: string; name: string; status: string; updated_at: string; discount_enabled: boolean;
  discount_type: string | null; discount_value: number | null;
  discount_duration: string | null; discount_months: number | null;
  eligible_plan_ids: string[];
};

/**
 * ACTIVATE A CAMPAIGN. With a discount, the Stripe Coupon is created FIRST —
 * restricted with `applies_to` to the eligible plans' Products, so even a
 * coupon somehow attached elsewhere discounts nothing else — and only then is
 * the campaign switched on, in one database statement that re-validates every
 * rule (grovnews_launch_activate). The key covers the exact coupon terms: a
 * retry returns the same coupon, an edited draft gets a new one.
 */
export async function activateLaunchCampaign(
  supabase: Client, campaignId: string, actorId: string,
): Promise<LaunchActivateResult> {
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };

  const { data: c, error } = await supabase.from("grovnews_launch_campaigns")
    .select("id, name, status, updated_at, discount_enabled, discount_type, discount_value, discount_duration, discount_months, eligible_plan_ids")
    .eq("id", campaignId).maybeSingle();
  if (error || !c) return { ok: false, reason: "invalid" };
  const campaign = c as CampaignRow;
  if (campaign.status !== "DRAFT") return { ok: false, reason: "not_draft" };

  let couponId: string | null = null;
  if (campaign.discount_enabled) {
    if (!stripeCredentials()) return { ok: false, reason: "payments_disabled" };
    const { data: plans, error: planError } = await supabase.from("subscription_plans")
      .select("id, stripe_product_id").in("id", campaign.eligible_plan_ids);
    if (planError) return { ok: false, reason: "invalid" };
    const products = (plans ?? []).map((p) => p.stripe_product_id).filter((v): v is string => Boolean(v));
    if (products.length !== campaign.eligible_plan_ids.length) return { ok: false, reason: "plan_ineligible" };

    const params: Record<string, FormValue> = {
      name: `GrovBase launch ${campaign.name}`.slice(0, 40),
      duration: campaign.discount_duration === "REPEATING" ? "repeating" : "once",
      ...(campaign.discount_duration === "REPEATING" ? { duration_in_months: campaign.discount_months } : {}),
      ...(campaign.discount_type === "PERCENT"
        ? { percent_off: campaign.discount_value }
        : { amount_off: campaign.discount_value, currency: "pln" }),
      applies_to: { products: [...products].sort() },
      metadata: { grovbase_entity: "grovnews_launch", grovbase_campaign_id: campaign.id },
    };
    const terms = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 16);
    try {
      const coupon = await stripePost<StripeCoupon>("/coupons", params, `launch-coupon:${campaign.id}:${terms}`);
      couponId = coupon.id;
    } catch (e) {
      logFailure("coupon", e);
      return { ok: false, reason: "stripe_error" };
    }
  }

  const { data, error: actError } = await supabase.rpc("grovnews_launch_activate", {
    p_token: token, p_id: campaignId, p_coupon_id: couponId, p_actor: actorId,
    p_expected_updated_at: campaign.updated_at,
  });
  if (actError) return { ok: false, reason: "invalid" };
  const status = (data as { status?: string } | null)?.status;
  return status === "applied" ? { ok: true } : { ok: false, reason: status ?? "invalid" };
}

/**
 * THE CUSTOMER'S LAUNCH BONUS, IF THEY QUALIFY. Asked for the signed-in user
 * only (the function reads auth.uid()); safe to call on every visit — after
 * the first claim it answers 'claimed' and does nothing. Never throws: a
 * bonus that cannot be checked right now is checked on the next visit.
 */
export async function ensureLaunchBonus(supabase: Client): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("grovnews_launch_ensure");
    if (error) {
      console.error("grovnews.launch.ensure_failed", error.code ?? "unknown");
      return null;
    }
    return (data as { status?: string } | null)?.status ?? null;
  } catch {
    return null;
  }
}

/* ── 5. THE DISCOUNT CODE AT THE PLAN CHECKOUT ─────────────────────────────*/

export type CodeRefusal = "code_invalid" | "code_used" | "code_expired" | "code_plan" | "code_monthly_only";

export type ResolvedCode = {
  codeId: string;
  couponId: string;
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
  duration: "ONCE" | "REPEATING";
  months: number | null;
  firstChargeCents: number;
};

/** The shape a code must have before the database is even asked. */
export const LAUNCH_CODE_RE = /^GROV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 && code.length <= 32 ? code : null;
}

/**
 * Resolve a code FOR THE SIGNED-IN USER against a plan and period. The user id
 * comes from the session on the server; another person's code answers exactly
 * like a code that does not exist. The coupon comes from the campaign row —
 * never from the request.
 */
export async function resolveLaunchCode(
  supabase: Client, userId: string, code: string, planId: string, period: "monthly" | "annual",
): Promise<{ ok: true; code: ResolvedCode } | { ok: false; reason: CodeRefusal }> {
  if (!LAUNCH_CODE_RE.test(code)) return { ok: false, reason: "code_invalid" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "code_invalid" };
  const { data, error } = await supabase.rpc("grovnews_launch_code_resolve", {
    p_token: token, p_user_id: userId, p_code: code, p_plan_id: planId, p_period: period,
  });
  if (error || !data) return { ok: false, reason: "code_invalid" };
  const r = data as {
    ok?: boolean; reason?: CodeRefusal; code_id?: string; coupon_id?: string;
    discount_type?: "PERCENT" | "AMOUNT"; discount_value?: number;
    discount_duration?: "ONCE" | "REPEATING"; discount_months?: number | null; first_charge_cents?: number;
  };
  if (!r.ok || !r.code_id || !r.coupon_id || !r.discount_type || !r.discount_duration
      || typeof r.discount_value !== "number" || typeof r.first_charge_cents !== "number") {
    return { ok: false, reason: r.reason ?? "code_invalid" };
  }
  return {
    ok: true,
    code: {
      codeId: r.code_id, couponId: r.coupon_id, discountType: r.discount_type,
      discountValue: r.discount_value, duration: r.discount_duration,
      months: r.discount_months ?? null, firstChargeCents: r.first_charge_cents,
    },
  };
}

/* ── logging ───────────────────────────────────────────────────────────────*/

function reason(e: unknown): string {
  if (e instanceof StripeApiError) return e.code ?? e.type ?? `http_${e.status}`;
  return e instanceof Error ? e.name : "unknown";
}

/** Stripe's own classification and request id; never a key, a secret or a card. */
function logFailure(where: string, e: unknown): void {
  if (e instanceof StripeApiError) {
    console.error("grovnews.billing", where, e.status, e.type ?? "-", e.code ?? "-", e.requestId ?? "-", e.message);
    return;
  }
  console.error("grovnews.billing", where, e instanceof Error ? e.message : "unknown");
}
