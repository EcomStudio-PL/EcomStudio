"use server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import {
  createPackageCheckout, createCustomCreditsCheckout, createPlanCheckout,
  createBillingPortalSession, type CheckoutResult,
} from "@/lib/server/billing";

/**
 * THE FOUR THINGS A SIGNED-IN CUSTOMER MAY START.
 *
 * Each one is a thin wrapper, exactly as every other action in this app: auth
 * context → service call → result. The interesting part is what is NOT a
 * parameter.
 *
 *   There is no `workspaceId`. It is read from the session, so a customer can
 *   only ever top up their own workspace and can never put someone else's on
 *   an invoice.
 *
 *   There is no `amount`, no `price`, no `currency`, no `priceId`. Money is
 *   read from the database — `credit_packages`, `subscription_plans`, and the
 *   rate card those two make — and a figure that arrived from a browser is
 *   never part of it.
 *
 *   There is no `credits` on the package path. A package's id names a row, and
 *   the row says how many credits it is worth.
 *
 * WHAT THESE RETURN IS A REDIRECT URL, NOT A PURCHASE. Nothing here grants a
 * credit. Reaching the success page grants nothing either — a customer can
 * type that address. The ledger moves only when the signed webhook arrives.
 */

const DENIED: CheckoutResult = { ok: false, reason: "no_customer" };

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  return { supabase, workspace, email: user.email ?? null };
}

/** Buy a fixed credit package. The client sends a package id and nothing else. */
export async function startPackageCheckoutAction(packageId: string): Promise<CheckoutResult> {
  if (typeof packageId !== "string" || !packageId) return { ok: false, reason: "unknown_package" };
  const ctx = await context();
  if (!ctx) return DENIED;
  return createPackageCheckout(ctx.supabase, ctx.workspace, ctx.email, packageId);
}

/**
 * Buy an arbitrary number of credits. The client sends `credits` — a number,
 * validated on the server against the rate card — and the server decides the
 * price. A `credits` value outside the ladder, fractional, negative or absurd
 * is refused rather than clamped, because a silently clamped purchase charges
 * for something the customer did not choose.
 */
export async function startCustomCreditsCheckoutAction(credits: number): Promise<CheckoutResult> {
  const ctx = await context();
  if (!ctx) return DENIED;
  return createCustomCreditsCheckout(ctx.supabase, ctx.workspace, ctx.email, credits);
}

/** Subscribe to a plan. `billing` is refused for annual until a real annual
 *  price exists — the service answers `not_mapped` rather than charging the
 *  monthly price for a year. */
export async function startPlanCheckoutAction(
  planId: string, billing: "monthly" | "annual" = "monthly",
): Promise<CheckoutResult> {
  if (typeof planId !== "string" || !planId) return { ok: false, reason: "unknown_plan" };
  const period = billing === "annual" ? "annual" : "monthly";
  const ctx = await context();
  if (!ctx) return DENIED;
  return createPlanCheckout(ctx.supabase, ctx.workspace, ctx.email, planId, period);
}

/** Open Stripe's own billing screen — cards, invoices, cancelling. The customer
 *  id is resolved server-side; it is never accepted from the caller. */
export async function openBillingPortalAction(): Promise<CheckoutResult> {
  const ctx = await context();
  if (!ctx) return DENIED;
  return createBillingPortalSession(ctx.supabase, ctx.workspace);
}
