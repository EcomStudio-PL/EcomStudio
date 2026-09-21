import "server-only";

/**
 * STRIPE CREDENTIALS — server-side, and nowhere else.
 *
 * Two secrets, both read from the deployment environment (Vercel encrypted
 * environment variables), both read only inside this module:
 *
 *   STRIPE_SECRET_KEY      talks to the Stripe API as this account.
 *   STRIPE_WEBHOOK_SECRET  proves an inbound webhook really came from Stripe.
 *
 * NEITHER MAY EVER BE PREFIXED `NEXT_PUBLIC_`. A NEXT_PUBLIC_ variable is
 * inlined into the client bundle at build time — publishing the secret key
 * would let anyone create charges, refunds and payouts on this account, and
 * publishing the webhook secret would let anyone forge a "payment succeeded"
 * and mint credits. There is no legitimate reason for either to reach a
 * browser: Stripe Checkout is created server-side and the customer is sent to
 * a Stripe-hosted URL, so the front end never needs a Stripe credential at
 * all — not even the publishable key.
 *
 * `server-only` at the top of this file makes that a build error rather than a
 * code-review question: any client component that imports it fails the build.
 *
 * LIVEMODE IS DERIVED, NEVER CONFIGURED. It is read off the key prefix, so
 * there is no separate switch that can disagree with the key in use. A test
 * key cannot be made to claim it is live, or the reverse.
 */

/** Stripe's key formats. `rk_` is a restricted key, which is also acceptable. */
const SECRET_KEY = /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=_-]+$/;

export type StripeMode = "live" | "test";

export type StripeCredentials = {
  secretKey: string;
  mode: StripeMode;
  livemode: boolean;
};

/** The secret key, or null when it is absent or malformed. Never logged. */
export function stripeCredentials(): StripeCredentials | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || !SECRET_KEY.test(key)) return null;
  const mode: StripeMode = key.includes("_live_") ? "live" : "test";
  return { secretKey: key, mode, livemode: mode === "live" };
}

/** The endpoint signing secret, or null. Never logged, never returned to a client. */
export function stripeWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !WEBHOOK_SECRET.test(secret)) return null;
  return secret;
}

/**
 * CAN THIS DEPLOYMENT TAKE MONEY?
 *
 * Both halves are required, and this is the honest answer the UI renders. A
 * deployment with a secret key but no webhook secret can CREATE a checkout and
 * can never confirm it — the customer would pay and receive nothing, because
 * credits are granted by the verified webhook and by nothing else. That state
 * must read as "payments unavailable", not as a working buy button.
 */
export function paymentsEnabled(): boolean {
  return stripeCredentials() !== null && stripeWebhookSecret() !== null;
}

/**
 * What is missing, for the admin screen. Names only — never values, never
 * lengths, never a prefix. Knowing that STRIPE_WEBHOOK_SECRET is unset is
 * operational information; anything about its content is not.
 */
export function stripeConfigGaps(): string[] {
  const gaps: string[] = [];
  if (!stripeCredentials()) gaps.push("STRIPE_SECRET_KEY");
  if (!stripeWebhookSecret()) gaps.push("STRIPE_WEBHOOK_SECRET");
  return gaps;
}
