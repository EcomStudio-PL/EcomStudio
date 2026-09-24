import "server-only";
import { randomUUID } from "crypto";
import { stripeCredentials } from "@/lib/stripe/config";
import { stripePost, StripeApiError, StripeNotConfiguredError } from "@/lib/stripe/client";

/**
 * CAN THIS KEY ACTUALLY CREATE A PAYMENT?
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * On 2026-09-24 production held a well-formed live key, reported
 * `ready: true`, `grants: true`, `checkout: live`, sold subscriptions
 * correctly — and refused every credit-package purchase with a generic error.
 * The key was a RESTRICTED key (`rk_live_…`) carrying write access to
 * Subscriptions and Customers but not to PaymentIntents, so exactly one half of
 * the checkout worked and no signal anywhere said which half.
 *
 * Every existing readiness check was about whether a SECRET WAS PRESENT.
 * Presence is not permission. A restricted key is granted resource by resource,
 * so "the key is set and well-formed" and "the key may do the thing the
 * checkout needs" are different questions, and only the second one decides
 * whether a customer can buy anything.
 *
 * ─── HOW THE PROBE WORKS, AND WHY IT COSTS NOTHING ──────────────────────────
 *
 * It POSTs to /v1/payment_intents WITH NO PARAMETERS. Stripe checks the key's
 * permission for the endpoint before it validates the body, so the answer
 * separates cleanly:
 *
 *   403 / 401  →  the key may not create PaymentIntents          "forbidden"
 *   400        →  the key MAY; it got as far as "amount is missing"   "ok"
 *
 * Nothing is created in either case. A PaymentIntent without an amount and a
 * currency cannot come into existence, so this can never leave an object on a
 * live account, never touches a card, and never moves money.
 *
 * Reading the endpoint instead would have proved nothing: `GET` needs the READ
 * permission and the checkout needs WRITE, and this account demonstrates that
 * the two come apart.
 *
 * ─── WHY IT IS CACHED ───────────────────────────────────────────────────────
 *
 * It answers a question about a deployment's configuration, which changes when
 * someone edits an environment variable or a key's permissions — not between
 * one request and the next. The readiness endpoint is public, so an uncached
 * probe would let anyone turn a page refresh into a Stripe API call. Five
 * minutes per instance keeps it honest and unexploitable.
 */

export type WriteCapability =
  /** The key is permitted to create PaymentIntents. */
  | "ok"
  /** The key is valid but not allowed to. One-off purchases CANNOT work. */
  | "forbidden"
  /** No usable STRIPE_SECRET_KEY in this deployment. */
  | "unconfigured"
  /** Stripe could not be reached, or answered something unexpected. */
  | "unknown";

const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; value: WriteCapability } | null = null;

async function probe(): Promise<WriteCapability> {
  if (!stripeCredentials()) return "unconfigured";
  try {
    // A deliberately empty body. If this ever returned 2xx, Stripe would have
    // created a PaymentIntent with no amount, which the API does not allow.
    await stripePost("/payment_intents", {}, `probe:${randomUUID()}`);
    return "ok";
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) return "unconfigured";
    if (e instanceof StripeApiError) {
      if (e.unauthorized) return "forbidden";
      // 400 means the request reached parameter validation, which it can only
      // do once the key has cleared the permission check. That is the answer.
      if (e.status === 400) return "ok";
      return "unknown";
    }
    return "unknown";
  }
}

/** Cached per server instance. `force` skips the cache for an admin re-check. */
export async function paymentIntentWriteCapability(force = false): Promise<WriteCapability> {
  const now = Date.now();
  if (!force && cached && now - cached.at < TTL_MS) return cached.value;
  const value = await probe();
  // A transport failure is not evidence about the key, so it is not cached —
  // otherwise one blip would report "unknown" for five minutes.
  if (value !== "unknown") cached = { at: now, value };
  return value;
}

/** Test seam: the cache is per-process and must not leak between cases. */
export function resetCapabilityCache(): void {
  cached = null;
}
