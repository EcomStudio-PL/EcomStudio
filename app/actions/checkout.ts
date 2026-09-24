"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import {
  quoteCheckout, beginCheckout, checkoutStatus,
  type CheckoutRequest, type QuoteResult, type BeginResult, type StatusResult,
} from "@/lib/server/checkout";

/**
 * THE FOUR THINGS THE CHECKOUT PAGE MAY ASK THE SERVER FOR.
 *
 * Thin wrappers, like every other action in this app: auth context → service
 * call → result. What matters is what is NOT a parameter — there is no amount,
 * no currency, no price id, no workspace id and no Stripe customer id in any
 * signature below. Every one of those is resolved from the session and the
 * database, for the reasons written out in lib/server/checkout.ts.
 *
 * NONE OF THESE GRANT ANYTHING. `beginCheckoutAction` returns a client secret,
 * which is permission to attempt a payment, not a payment. `statusAction`
 * reads. The ledger moves on the signed webhook and nowhere else.
 */

const DENIED = { ok: false as const, reason: "no_customer" as const };

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  return { supabase, workspace, email: user.email ?? null };
}

/**
 * The request, rebuilt from primitives.
 *
 * A server action receives whatever the client serialises, so the object is
 * reconstructed field by field from a known shape rather than passed through.
 * An extra property a caller invents — `amountCents`, say — is dropped here and
 * never reaches the pricing code.
 */
function sanitise(input: unknown): CheckoutRequest | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  if (raw.kind === "credit_package") {
    return typeof raw.packageId === "string" && raw.packageId
      ? { kind: "credit_package", packageId: raw.packageId }
      : null;
  }
  if (raw.kind === "custom_credits") {
    // A number, not a numeric string. `validateCustomCredits` refuses strings
    // deliberately; keeping that strictness here means the refusal happens
    // before anything else looks at the value.
    return typeof raw.credits === "number" && Number.isFinite(raw.credits)
      ? { kind: "custom_credits", credits: raw.credits }
      : null;
  }
  if (raw.kind === "subscription") {
    if (typeof raw.planId !== "string" || !raw.planId) return null;
    return {
      kind: "subscription",
      planId: raw.planId,
      period: raw.period === "annual" ? "annual" : "monthly",
    };
  }
  return null;
}

/** Price the order for the summary panel. Creates nothing in Stripe. */
export async function quoteCheckoutAction(input: unknown): Promise<QuoteResult> {
  const req = sanitise(input);
  if (!req) return { ok: false, reason: "unknown_package" };
  const ctx = await context();
  if (!ctx) return { ok: false, reason: "no_server_key" };
  return quoteCheckout(ctx.supabase, ctx.workspace, req);
}

/**
 * Create the PaymentIntent or Subscription and hand back its client secret.
 *
 * The secret is scoped to one payment: it can confirm that payment and read
 * nothing else about the account. It is the only Stripe value that crosses to
 * the browser besides the publishable key.
 */
export async function beginCheckoutAction(input: unknown): Promise<BeginResult> {
  const req = sanitise(input);
  if (!req) return { ok: false, reason: "unknown_package" };
  const ctx = await context();
  if (!ctx) return DENIED;
  return beginCheckout(ctx.supabase, ctx.workspace, ctx.email, req);
}

/**
 * What actually happened — asked of Stripe and of the ledger, never of the URL.
 *
 * The status screen polls this. It is scoped to the caller's workspace inside
 * the service, so a reference belonging to somebody else's payment answers
 * "unknown" rather than somebody else's amount.
 */
export async function checkoutStatusAction(reference: unknown): Promise<StatusResult> {
  const ctx = await context();
  if (!ctx || typeof reference !== "string") {
    return { state: "unknown", amountCents: null, currency: null, credits: null, kind: null };
  }
  return checkoutStatus(ctx.supabase, ctx.workspace, reference);
}

/* ── invoice details ───────────────────────────────────────────────────────*/

export type InvoiceDetails = {
  company_name: string | null;
  vat_id: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  billing_email: string | null;
};

/**
 * Save the invoice details the customer typed at the till.
 *
 * WRITES THE SAME `billing_profiles` ROW THE SETTINGS SCREEN DOES. There is one
 * place a workspace's invoice data lives, and checkout joins it rather than
 * opening a second store that would immediately start disagreeing with the
 * first — the customer would update their address in Settings and the next
 * invoice would still carry the old one.
 *
 * `regon`, `contact_person` and `phone` are intentionally NOT touched: the
 * checkout form does not ask for them, and an upsert that wrote them as null
 * would silently erase what the settings screen collected.
 */
export async function saveCheckoutInvoiceAction(
  input: InvoiceDetails,
): Promise<{ ok: boolean }> {
  const ctx = await context();
  if (!ctx) return { ok: false };

  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const row = {
    workspace_id: ctx.workspace.id,
    company_name: clean(input.company_name),
    vat_id: clean(input.vat_id),
    address_line: clean(input.address_line),
    postal_code: clean(input.postal_code),
    city: clean(input.city),
    country: clean(input.country) ?? "PL",
    billing_email: clean(input.billing_email),
    updated_at: new Date().toISOString(),
  };

  // RLS enforces workspace membership on the upsert — the workspace id comes
  // from the session above, so a member can only ever write their own row.
  const { error } = await ctx.supabase
    .from("billing_profiles")
    .upsert(row, { onConflict: "workspace_id" });
  if (error) return { ok: false };

  revalidatePath("/settings");
  return { ok: true };
}

/** What we already know about this workspace, for prefilling the form. */
export async function loadCheckoutInvoiceAction(): Promise<InvoiceDetails | null> {
  const ctx = await context();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("billing_profiles")
    .select("company_name, vat_id, address_line, postal_code, city, country, billing_email")
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data ?? null;
}
