/**
 * THE ONE STRIPE CREDENTIAL THAT BELONGS IN A BROWSER.
 *
 * Deliberately NOT `server-only` — this module is imported by the checkout's
 * client component, and that is correct.
 *
 * ─── WHY THIS DOES NOT CONTRADICT lib/stripe/config.ts ──────────────────────
 *
 * That file says, at length, that no Stripe credential need ever reach a
 * browser. That was TRUE and is now out of date, and the reason is worth
 * writing down rather than quietly deleting:
 *
 *     it was true because checkout was HOSTED. The server created a Checkout
 *     Session and sent the customer to stripe.com, so the front end never
 *     spoke to Stripe at all.
 *
 *     it stopped being true when the payment sheet moved in-house. Stripe.js
 *     mounts the Payment Element in the browser, and it has to identify the
 *     account it is collecting for.
 *
 * ─── WHY PUBLISHING THIS ONE IS SAFE, AND THE OTHER IS NOT ──────────────────
 *
 * A publishable key (`pk_live_…`) is designed to be public. It can create and
 * confirm payment methods and confirm a PaymentIntent whose client secret the
 * holder already has. It cannot read a customer, list payments, issue a refund,
 * move a payout, or create a charge against an arbitrary card.
 *
 * A secret key (`sk_live_…` / `rk_live_…`) can do all of those. The two look
 * similar and are one typo apart in an env var name, which is exactly why this
 * module REFUSES anything that is not shaped like a publishable key rather than
 * passing along whatever it was given. A secret key pasted into
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY would otherwise be inlined into the client
 * bundle at build time and published to every visitor — the single worst
 * outcome available in this codebase.
 *
 * `scripts/stripe-tests.ts` asserts that refusal, and asserts that no secret
 * shape appears under any NEXT_PUBLIC_ name anywhere in the tree.
 */

/** `pk_live_…` or `pk_test_…`, and nothing else. */
const PUBLISHABLE = /^pk_(live|test)_[A-Za-z0-9]+$/;

/**
 * The publishable key, or null when it is absent or the wrong shape.
 *
 * NULL IS A SUPPORTED STATE, not a crash. A deployment without the key cannot
 * mount the payment sheet, and the checkout page says so plainly instead of
 * rendering an empty box where the card field should be. That is also what a
 * preview deployment looks like before anyone configures it.
 */
export function stripePublishableKey(): string | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!key || !PUBLISHABLE.test(key)) return null;
  return key;
}

/** Whether the browser half of payments can run at all. */
export function checkoutRenderable(): boolean {
  return stripePublishableKey() !== null;
}
