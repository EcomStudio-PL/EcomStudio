import type { Metadata } from "next";
import { PricingSurface } from "@/components/plan/pricing-surface";
import { checkoutNotice } from "@/lib/checkout-notice-param";

export const dynamic = "force-dynamic";

/** The cennik's one public address is /plany; this is the same page in-app. */
export const metadata: Metadata = { alternates: { canonical: "/plany" } };

/**
 * CENNIK, INSIDE THE APPLICATION — the same surface as /plany, in the app's
 * own shell (bar, navigation, login-security gate from app/(app)/layout.tsx).
 *
 * It stays at /plan because that is where every in-app link, the Stripe
 * product pages and both checkout return paths point: a plan checkout comes
 * back to /plan?checkout=success, and every refusal /checkout makes comes back
 * as /plan?checkout=<reason>. Before CheckoutNotice existed here, someone who
 * had just paid landed on a page byte-identical to the one they left, with
 * the same buy button live — and the obvious next move was a second
 * subscription. The notice is that page saying what happened.
 *
 * Every figure is a database row (subscription_plans, credit_packages) or a
 * price the checkout itself computed; see lib/server/pricing-page.ts.
 */
export default async function PlanPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PricingSurface scope="shell" notice={checkoutNotice(await searchParams)} />;
}
