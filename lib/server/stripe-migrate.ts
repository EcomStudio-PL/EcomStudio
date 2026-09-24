import "server-only";
import type { Client } from "@/lib/services/workspace";
import { stripeGet, stripePost, StripeApiError } from "@/lib/stripe/client";
import type { PricePeriod } from "@/lib/server/stripe-pricing";

/**
 * MOVING PEOPLE WHO ARE ALREADY PAYING ONTO A NEW PRICE.
 *
 * This is the one operation in the billing system that changes what an
 * EXISTING customer is charged, and it is the one that is never automatic.
 *
 * ─── WHY A PRICE CHANGE DOES NOT DO THIS BY ITSELF ──────────────────────────
 *
 * When an admin edits a plan from 299 zł to 399 zł, `syncPrice` creates a new
 * Stripe Price and points the catalogue at it. Every subscription created from
 * then on bills 399. Everyone who subscribed at 299 stays on the Price object
 * they subscribed to — because an archived Price keeps working for the
 * subscriptions already on it, which is exactly the behaviour that protects
 * them.
 *
 * That is not an oversight to fix later. A customer agreed to a number. Moving
 * them to a different one is a commercial decision with legal weight, and the
 * system should make somebody make it on purpose rather than discover it in a
 * support ticket. So it lives here, behind its own action, its own count, its
 * own proration choice and its own confirmation.
 *
 * ─── PRORATION IS THE CALLER'S CHOICE BECAUSE THERE IS NO SAFE DEFAULT ──────
 *
 *   create_prorations  bills (or credits) the difference for the remainder of
 *                      the current period immediately. Honest, and it takes
 *                      money today that the customer was not expecting today.
 *   none               the new amount applies from the next renewal. Gentler,
 *                      and it means the current period is billed at the old
 *                      rate even though the catalogue has moved.
 *
 * Either can be the right answer. Picking one here would spend somebody's
 * money on this module's opinion.
 */

type StripeSubscriptionItem = { id: string; price?: { id?: string } };
type StripeSubscription = {
  id: string;
  status: string;
  items?: { data?: StripeSubscriptionItem[] };
};

/** The plan's current mapping and displayed price for a period. */
async function planPricing(supabase: Client, planId: string, period: PricePeriod): Promise<{
  priceId: string | null; cents: number | null;
} | null> {
  const { data } = await supabase
    .from("subscription_plans")
    .select("price_cents, annual_price_cents, stripe_price_id_monthly, stripe_price_id_annual")
    .eq("id", planId).maybeSingle();
  if (!data) return null;
  return period === "annual"
    ? { priceId: data.stripe_price_id_annual, cents: data.annual_price_cents }
    : { priceId: data.stripe_price_id_monthly, cents: data.price_cents };
}

/**
 * How many live subscriptions are on a price that is NOT the current one.
 *
 * Read from `subscriptions`, whose `stripe_price_id` the webhook keeps in step
 * with every `customer.subscription.*` event — so this is GrovBase's own record
 * of what each customer is on, not a guess and not a Stripe round trip per row.
 */
export async function countSubscriptionsOnOldPrice(
  supabase: Client, planId: string, period: PricePeriod,
): Promise<{ count: number; oldCents: number | null; newCents: number | null }> {
  const pricing = await planPricing(supabase, planId, period);
  if (!pricing?.priceId) return { count: 0, oldCents: null, newCents: null };

  const { data } = await supabase
    .from("subscriptions")
    .select("id, stripe_price_id")
    .eq("plan_id", planId)
    .in("status", ["active", "trialing", "past_due"]);

  const stale = (data ?? []).filter((s) => s.stripe_price_id && s.stripe_price_id !== pricing.priceId);
  if (stale.length === 0) return { count: 0, oldCents: null, newCents: pricing.cents };

  // What the old Price actually charges, read from Stripe rather than
  // remembered — the whole point of this screen is to state two real numbers.
  let oldCents: number | null = null;
  try {
    const old = await stripeGet<{ unit_amount: number | null }>(
      `/prices/${stale[0].stripe_price_id}`, {},
    );
    oldCents = old.unit_amount;
  } catch { /* the count is still true without it */ }

  return { count: stale.length, oldCents, newCents: pricing.cents };
}

export type MigrationOutcome = { migrated: number; failed: number };

/**
 * Point every stale subscription at the current Price.
 *
 * ONE STRIPE CALL PER SUBSCRIPTION, and a failure on one does not stop the
 * rest: a partial migration is reported as a count, not swallowed. The caller
 * shows "migrated N, failed M" and the failures can be retried — which is
 * better than an all-or-nothing that leaves nobody knowing who moved.
 *
 * The local `subscriptions.stripe_price_id` is NOT written here. Stripe emits
 * `customer.subscription.updated` for each change and the existing webhook
 * records it, so the one writer of that column stays the one writer. Updating
 * it here as well would mean two sources for the same fact, and they would
 * disagree the first time a Stripe call succeeded and the local write did not.
 */
export async function migrateSubscriptionsToCurrentPrice(
  supabase: Client, planId: string, period: PricePeriod,
  proration: "create_prorations" | "none",
): Promise<MigrationOutcome> {
  const pricing = await planPricing(supabase, planId, period);
  if (!pricing?.priceId) return { migrated: 0, failed: 0 };
  const target = pricing.priceId;

  const { data } = await supabase
    .from("subscriptions")
    .select("provider_subscription_id, stripe_price_id")
    .eq("plan_id", planId)
    .in("status", ["active", "trialing", "past_due"]);

  const stale = (data ?? []).filter(
    (s) => s.provider_subscription_id && s.stripe_price_id && s.stripe_price_id !== target,
  );

  let migrated = 0;
  let failed = 0;

  for (const row of stale) {
    const subId = row.provider_subscription_id as string;
    try {
      // The ITEM id is required — Stripe updates a subscription's price by
      // replacing the item, not by setting a price on the subscription. Read
      // it fresh rather than storing it: an item id can change, and a stale one
      // would silently create a SECOND item and bill both.
      const sub = await stripeGet<StripeSubscription>(`/subscriptions/${subId}`, {});
      const item = sub.items?.data?.[0];
      if (!item?.id) { failed += 1; continue; }
      if (item.price?.id === target) { continue; }

      await stripePost<StripeSubscription>(`/subscriptions/${subId}`, {
        items: [{ id: item.id, price: target }],
        proration_behavior: proration,
      // Keyed on the subscription AND the target price, so a retry of this
      // exact migration is a no-op rather than a second item swap.
      }, `migrate:${subId}:${target}`);
      migrated += 1;
    } catch (e) {
      failed += 1;
      if (e instanceof StripeApiError) {
        console.error("billing.migrate", subId, e.status, e.code ?? "-", e.message);
      } else {
        console.error("billing.migrate", subId, e instanceof Error ? e.message : "unknown");
      }
    }
  }

  return { migrated, failed };
}
