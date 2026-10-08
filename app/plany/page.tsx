import { PricingSurface, pricingMetadata } from "@/components/plan/pricing-surface";

export const dynamic = "force-dynamic";

/**
 * /plany — THE PUBLIC CENNIK, at its one canonical address.
 *
 * Open to everybody: a visitor sees the plans, the comparison, the top-ups
 * (locked until they have a plan) and the FAQ, and nothing about any account.
 * A signed-in customer sees the same page with their own plan marked. Buying
 * starts from here and runs through the existing sign-in dialog and checkout;
 * nothing on this route creates a payment. /cennik answers 308 to here
 * (next.config.mjs), and the in-app /plan renders the same surface.
 *
 * No `?checkout=` banner here: every Stripe return and every checkout refusal
 * lands on /plan, behind the login. A crafted /plany?checkout=success must not
 * show a stranger a payment confirmation.
 */
export const generateMetadata = pricingMetadata;

export default function PlanyPage() {
  return <PricingSurface scope="page" />;
}
