import "server-only";
import type { Client } from "@/lib/services/workspace";
import type { Database } from "@/lib/database.types";

/**
 * WHAT A STRIPE EVENT DOES TO GROVBASE.
 *
 * This module is the whole decision. The route around it does three things
 * and no more: read the raw bytes, verify the signature, call `handleEvent`.
 * Keeping the decision here means it can be driven from a test with a real
 * event payload and a fake database, which is the only way to prove "the same
 * event ten times grants credits once" without taking ten payments.
 *
 * ─── THE RULES, ALL OF THEM ────────────────────────────────────────────────
 *
 * 1. A SIGNED WEBHOOK IS THE ONLY THING THAT GRANTS CREDITS. Not `success_url`
 *    — a customer can type that. Not a Checkout Session read back over the
 *    API. Not a client saying it paid.
 *
 * 2. THE LEDGER IS REACHED THROUGH ONE DOOR. `stripe_settle_payment` records
 *    the payment and calls `apply_credit_transaction`, which is the only
 *    function in this database that may change a balance. Nothing here writes
 *    `credit_wallets` or inserts a `credit_transactions` row.
 *
 * 3. HOW MANY CREDITS IS A DATABASE QUESTION. Never Stripe metadata, never the
 *    amount paid. A package's credits come from `credit_packages`; a plan's
 *    from `subscription_plans`. Metadata is a HINT used to find the row, and
 *    the row is what is believed. Anyone who can forge metadata would
 *    otherwise be able to order themselves a million credits.
 *
 *    The one exception is a CUSTOM amount, which by definition has no row.
 *    There the credits come from the session metadata GrovBase itself wrote —
 *    and the metadata is only trusted after the signature proved the event is
 *    Stripe's, reporting a session this deployment created.
 *
 * 4. EXACTLY ONCE, IN TWO LAYERS, IN THE DATABASE. `payment_events` keyed on
 *    the Stripe event id catches a retry of the same event;
 *    `payments (provider, provider_payment_id)` catches two DIFFERENT events
 *    describing one payment — which is why `checkout.session.completed` and
 *    `payment_intent.succeeded` both settle against the PaymentIntent id
 *    rather than their own ids.
 *
 * 5. ANSWER 200 TO ANYTHING UNDERSTOOD, INCLUDING "I already did this". A
 *    non-2xx makes Stripe retry, and retrying a duplicate forever is noise. A
 *    genuine failure — the database is down — answers 500 so the retry is the
 *    useful one.
 */

type Json = Database["public"]["Tables"]["payments"]["Row"]["metadata"];
type CreditTxType = Database["public"]["Enums"]["credit_tx_type"];

export type StripeEvent = {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
};

export type HandledOutcome =
  | "applied" | "duplicate_event" | "already_settled" | "settled_without_credits"
  | "recorded" | "ignored" | "unresolved_workspace" | "unknown_payment" | "no_server_key";

export type HandleResult = { outcome: HandledOutcome; detail?: string };

/** The events this endpoint is subscribed to and acts on. Anything else is
 *  acknowledged and ignored, so a broader subscription cannot break it. */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
] as const;

/* ── reading Stripe's loosely typed objects safely ─────────────────────────*/

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

/** Stripe expands some fields to objects; `{id}` and `"id"` both mean the id. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object") return str((v as { id?: unknown }).id);
  return null;
}

function metaOf(obj: Record<string, unknown>): Record<string, string> {
  const m = obj.metadata;
  if (!m || typeof m !== "object" || Array.isArray(m)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * THE INVOICE SHAPE CHANGED, AND THIS ENDPOINT DOES NOT CHOOSE WHICH IT GETS.
 *
 * A webhook endpoint created without an explicit `api_version` receives
 * payloads in the ACCOUNT's default version, and that version moves when
 * Stripe upgrades the account. Between 2024-06-20 and the Basil releases the
 * two fields this handler needs both moved:
 *
 *   price id       lines.data[].price          →  lines.data[].pricing.price_details.price
 *   subscription   invoice.subscription        →  invoice.parent.subscription_details.subscription
 *   metadata       invoice.metadata            →  …parent.subscription_details.metadata
 *
 * Reading only the old shape would mean a renewal that is paid and never
 * credited — silently, because the payment still records. Reading only the new
 * one breaks the moment an endpoint is pinned to an older version. So both are
 * read, newest first, and neither is assumed.
 */
function invoicePriceId(line: Record<string, unknown>): string | null {
  const modern = (line.pricing as Record<string, unknown> | undefined)?.price_details;
  if (modern && typeof modern === "object") {
    const id = str((modern as { price?: unknown }).price);
    if (id) return id;
  }
  return idOf(line.price);
}

/** The subscription an invoice belongs to, in either shape. */
function invoiceSubscription(invoice: Record<string, unknown>): string | null {
  const parent = invoice.parent as Record<string, unknown> | undefined;
  const details = parent?.subscription_details as Record<string, unknown> | undefined;
  return idOf(details?.subscription) ?? idOf(invoice.subscription);
}

/** Epoch seconds → ISO, or null. Stripe sends seconds; Postgres wants a stamp. */
function iso(v: unknown): string | null {
  const n = int(v);
  return n && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/* ── who is this payment for ───────────────────────────────────────────────*/

/**
 * The workspace, in order of how much the answer can be trusted:
 *
 *   1. metadata GrovBase itself wrote when it created the session — present on
 *      everything the app starts;
 *   2. the Customer id, resolved through `stripe_customers`, which is
 *      server-owned and was written when the customer was created.
 *
 * Both are server-produced. Neither is a value a customer could choose.
 */
async function resolveWorkspace(
  supabase: Client, token: string, obj: Record<string, unknown>,
): Promise<string | null> {
  const meta = metaOf(obj);
  const fromMeta = meta.grovbase_workspace_id ?? str(obj.client_reference_id);
  if (fromMeta) return fromMeta;

  // A modern invoice carries the SUBSCRIPTION's metadata here rather than on
  // the invoice itself, and that is where GrovBase wrote the workspace.
  const parent = obj.parent as Record<string, unknown> | undefined;
  const details = parent?.subscription_details as Record<string, unknown> | undefined;
  if (details) {
    const fromParent = metaOf(details).grovbase_workspace_id;
    if (fromParent) return fromParent;
  }

  const customer = idOf(obj.customer);
  if (!customer) return null;
  const { data } = await supabase.rpc("stripe_workspace_for", {
    p_token: token, p_stripe_customer_id: customer,
  });
  return typeof data === "string" && data ? data : null;
}

/* ── what was bought, and how many credits that is ─────────────────────────*/

type Purchase = {
  kind: "credit_pack" | "custom_credits" | "subscription";
  credits: number;
  creditType: CreditTxType;
  description: string;
  packageId: string | null;
  planId: string | null;
};

/**
 * The credits a one-off purchase is worth.
 *
 * A PACKAGE is looked up by id and its OWN columns are believed — so metadata
 * claiming 999999 credits against a 19 zł pack grants the pack's real amount.
 * A CUSTOM amount has no row to look up; its figure comes from the metadata
 * GrovBase wrote, bounded by a sanity check, because a session this deployment
 * did not create has no business granting anything.
 */
/**
 * THE CATALOGUE, READ THROUGH THE ONE DOOR.
 *
 * Not `supabase.from("credit_packages")`. The webhook holds the ANON key — it
 * has no user session — and the RLS policy on the catalogue tables calls
 * `is_admin()`, which anon may not execute. That does not hide rows; because
 * `is_admin()` takes no arguments the planner hoists it into an InitPlan and
 * evaluates it once, so the whole query raises
 * `permission denied for function is_admin`. See migration 0115.
 *
 * AND A FAILED READ MUST NEVER LOOK LIKE "NO SUCH PACKAGE". That was the shape
 * of the bug: the call site read only `data`, so the error arrived as null,
 * null meant no package, and no package meant ZERO CREDITS against a payment
 * that had already been taken — with a 200 back to Stripe, so no retry. A read
 * that fails now throws, the route answers 500, and Stripe retries until it
 * works.
 */
type CataloguePackage = { id: string; name: string; credits: number; bonus_credits: number };
type CataloguePlan = { id: string; name: string; monthly_credits: number; bonus_credits: number };

async function catalogue(
  supabase: Client, token: string,
  args: { packageId?: string | null; planId?: string | null; priceId?: string | null },
): Promise<{ package: CataloguePackage | null; plan: CataloguePlan | null }> {
  const { data, error } = await supabase.rpc("stripe_catalogue", {
    p_token: token,
    p_package_id: args.packageId ?? null,
    p_plan_id: args.planId ?? null,
    p_price_id: args.priceId ?? null,
  });
  if (error) throw new Error(`catalogue_failed:${error.code ?? "unknown"}`);
  const row = (data ?? {}) as { package?: CataloguePackage | null; plan?: CataloguePlan | null };
  return { package: row.package ?? null, plan: row.plan ?? null };
}

async function purchaseFromMetadata(
  supabase: Client, token: string, meta: Record<string, string>,
): Promise<Purchase | null> {
  const type = meta.type;

  if (type === "credit_package" && meta.grovbase_package_id) {
    const { package: pack } = await catalogue(supabase, token, { packageId: meta.grovbase_package_id });
    if (!pack) return null;
    return {
      kind: "credit_pack",
      credits: pack.credits + pack.bonus_credits,
      creditType: "purchase",
      description: `Pakiet kredytów: ${pack.name}`,
      packageId: pack.id,
      planId: null,
    };
  }

  if (type === "custom_credits") {
    const credits = Number(meta.credits);
    // A metadata value is a string from a JSON body. It must be a whole,
    // positive, sane number before it becomes a ledger entry.
    if (!Number.isSafeInteger(credits) || credits <= 0) return null;
    return {
      kind: "custom_credits",
      credits,
      creditType: "topup",
      description: `Doładowanie: ${credits} kredytów`,
      packageId: null,
      planId: null,
    };
  }

  return null;
}

/** The credits one billing period of a plan is worth — from the plan row. */
async function purchaseFromPlan(
  supabase: Client, token: string, planId: string,
): Promise<Purchase | null> {
  const { plan } = await catalogue(supabase, token, { planId });
  if (!plan) return null;
  return {
    kind: "subscription",
    credits: plan.monthly_credits + plan.bonus_credits,
    creditType: "subscription",
    description: `Abonament: ${plan.name}`,
    packageId: null,
    planId: plan.id,
  };
}

/**
 * Which plan a Stripe price belongs to. The mapping column is the authority,
 * and it is resolved through the same function for the same reason — and with
 * no filter string built by concatenation, which a PostgREST `.or()` would
 * have required.
 */
async function planForPrice(
  supabase: Client, token: string, priceId: string | null,
): Promise<string | null> {
  if (!priceId) return null;
  const { plan } = await catalogue(supabase, token, { priceId });
  return plan?.id ?? null;
}

/* ── the settlement call ───────────────────────────────────────────────────*/

async function settle(
  supabase: Client, token: string, args: {
    event: StripeEvent;
    workspaceId: string;
    paymentId: string;
    amountCents: number;
    currency: string;
    purchase: Purchase | null;
    stripeCustomerId: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<HandleResult> {
  const { data, error } = await supabase.rpc("stripe_settle_payment", {
    p_token: token,
    p_event_id: args.event.id,
    p_event_type: args.event.type,
    p_workspace_id: args.workspaceId,
    p_provider_payment_id: args.paymentId,
    p_amount_cents: args.amountCents,
    p_currency: args.currency,
    p_kind: args.purchase?.kind ?? "credit_pack",
    p_credits: args.purchase?.credits ?? 0,
    p_credit_type: args.purchase?.creditType ?? "purchase",
    p_description: args.purchase?.description ?? "Płatność Stripe",
    p_package_id: args.purchase?.packageId ?? null,
    p_plan_id: args.purchase?.planId ?? null,
    p_stripe_customer_id: args.stripeCustomerId,
    p_metadata: args.metadata as Json,
  });
  // A transport or policy failure must NOT look like a handled event: the
  // caller answers 500 so Stripe retries, which is the whole point of retries.
  if (error) throw new Error(`settle_failed:${error.code ?? "unknown"}`);
  const status = (data as { status?: string } | null)?.status;
  return { outcome: (status as HandledOutcome) ?? "applied" };
}

/**
 * AN EVENT WE COULD NOT ACT ON MUST STILL LEAVE A TRACE.
 *
 * There are exactly two of those: a payment whose workspace cannot be
 * resolved, and a subscription on a price no plan claims. Both mean money
 * moved in Stripe and nothing moved here, and both need a human. Answering
 * 200 and writing nothing would make them vanish — the money would be in
 * Stripe, the customer would have nothing, and there would be no row anywhere
 * saying so.
 *
 * `stripe_record_event` writes one payment_events row and cannot touch a
 * payment, so recording this is never itself a financial act.
 */
async function recordUnactionable(
  supabase: Client, token: string, event: StripeEvent,
  objectId: string | null, outcome: HandledOutcome, detail: Record<string, unknown> = {},
): Promise<HandleResult> {
  const { error } = await supabase.rpc("stripe_record_event", {
    p_token: token,
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: objectId ?? "",
    p_workspace_id: null,
    p_outcome: outcome,
    p_detail: detail as Json,
  });
  if (error) throw new Error(`record_failed:${error.code ?? "unknown"}`);
  return { outcome };
}

/* ── the handlers ──────────────────────────────────────────────────────────*/

async function onCheckoutCompleted(
  supabase: Client, token: string, event: StripeEvent,
): Promise<HandleResult> {
  const session = event.data.object;

  // A subscription checkout is NOT settled here. Its money arrives as
  // `invoice.paid`, keyed on the invoice, and its state as
  // `customer.subscription.created`. Granting credits here as well would pay
  // twice for one purchase — the classic double-grant in every Stripe
  // integration that treats the session as a payment.
  if (str(session.mode) === "subscription") return { outcome: "ignored", detail: "subscription_mode" };

  // An unpaid session (a delayed method still processing) is not a payment.
  if (str(session.payment_status) !== "paid") return { outcome: "ignored", detail: "unpaid" };

  const workspaceId = await resolveWorkspace(supabase, token, session);
  if (!workspaceId) {
    return recordUnactionable(supabase, token, event, str(session.id), "unresolved_workspace",
      { customer: idOf(session.customer), amount_total: int(session.amount_total) });
  }

  // THE SAME KEY BOTH EVENTS USE. `payment_intent.succeeded` will arrive for
  // this payment too; keying both on the PaymentIntent is what makes the
  // second one a no-op instead of a second grant.
  const paymentId = idOf(session.payment_intent);
  if (!paymentId) return { outcome: "ignored", detail: "no_payment_intent" };

  const purchase = await purchaseFromMetadata(supabase, token, metaOf(session));
  return settle(supabase, token, {
    event, workspaceId, paymentId,
    amountCents: int(session.amount_total) ?? 0,
    currency: (str(session.currency) ?? "pln").toUpperCase(),
    purchase,
    stripeCustomerId: idOf(session.customer),
    metadata: { source: "checkout.session", session_id: str(session.id) },
  });
}

async function onPaymentIntentSucceeded(
  supabase: Client, token: string, event: StripeEvent,
): Promise<HandleResult> {
  const pi = event.data.object;
  const paymentId = str(pi.id);
  if (!paymentId) return { outcome: "ignored", detail: "no_id" };

  // A subscription invoice's PaymentIntent is settled by `invoice.paid`, which
  // knows the plan and the period. Settling it here too would double-grant.
  if (metaOf(pi).type === "subscription") return { outcome: "ignored", detail: "subscription_invoice" };

  const workspaceId = await resolveWorkspace(supabase, token, pi);
  if (!workspaceId) {
    return recordUnactionable(supabase, token, event, paymentId, "unresolved_workspace",
      { customer: idOf(pi.customer), amount: int(pi.amount_received) ?? int(pi.amount) });
  }

  const purchase = await purchaseFromMetadata(supabase, token, metaOf(pi));
  return settle(supabase, token, {
    event, workspaceId, paymentId,
    amountCents: int(pi.amount_received) ?? int(pi.amount) ?? 0,
    currency: (str(pi.currency) ?? "pln").toUpperCase(),
    purchase,
    stripeCustomerId: idOf(pi.customer),
    metadata: { source: "payment_intent" },
  });
}

/**
 * A renewal, or the first invoice of a subscription.
 *
 * The plan is found from the invoice's LINE ITEM price, through the mapping
 * column — not from metadata, because an invoice Stripe generated on its own
 * schedule carries whatever metadata the subscription had, and the price is
 * the thing that was actually billed.
 */
async function onInvoicePaid(
  supabase: Client, token: string, event: StripeEvent,
): Promise<HandleResult> {
  const invoice = event.data.object;
  const invoiceId = str(invoice.id);
  if (!invoiceId) return { outcome: "ignored", detail: "no_id" };

  const workspaceId = await resolveWorkspace(supabase, token, invoice);
  if (!workspaceId) {
    return recordUnactionable(supabase, token, event, invoiceId, "unresolved_workspace",
      { customer: idOf(invoice.customer), amount_paid: int(invoice.amount_paid) });
  }

  const lines = (invoice.lines as { data?: unknown[] } | undefined)?.data ?? [];
  const firstLine = (lines[0] ?? {}) as Record<string, unknown>;
  const priceId = invoicePriceId(firstLine);

  const parentDetails = (invoice.parent as Record<string, unknown> | undefined)
    ?.subscription_details as Record<string, unknown> | undefined;
  const planId = await planForPrice(supabase, token, priceId)
    ?? metaOf(invoice).grovbase_plan_id
    ?? (parentDetails ? metaOf(parentDetails).grovbase_plan_id : undefined)
    ?? null;
  const purchase = planId ? await purchaseFromPlan(supabase, token, planId) : null;

  return settle(supabase, token, {
    event, workspaceId,
    // Keyed on the INVOICE. Each renewal is its own invoice, so every period
    // grants once and no period grants twice.
    paymentId: invoiceId,
    amountCents: int(invoice.amount_paid) ?? 0,
    currency: (str(invoice.currency) ?? "pln").toUpperCase(),
    purchase,
    stripeCustomerId: idOf(invoice.customer),
    metadata: { source: "invoice", subscription: invoiceSubscription(invoice) },
  });
}

/** State only. Credits for a renewal come from invoice.paid and nowhere else. */
async function onSubscriptionEvent(
  supabase: Client, token: string, event: StripeEvent,
): Promise<HandleResult> {
  const sub = event.data.object;
  const subscriptionId = str(sub.id);
  if (!subscriptionId) return { outcome: "ignored", detail: "no_id" };

  const workspaceId = await resolveWorkspace(supabase, token, sub);
  if (!workspaceId) {
    return recordUnactionable(supabase, token, event, subscriptionId, "unresolved_workspace",
      { customer: idOf(sub.customer) });
  }

  const items = (sub.items as { data?: unknown[] } | undefined)?.data ?? [];
  const firstItem = (items[0] ?? {}) as Record<string, unknown>;
  const priceId = idOf(firstItem.price);
  const planId = await planForPrice(supabase, token, priceId) ?? metaOf(sub).grovbase_plan_id ?? null;
  // Without a plan there is no row to write: `subscriptions.plan_id` is NOT
  // NULL, and inventing a plan would misreport what the customer is on. This
  // is a real operational problem — somebody is being billed for something
  // GrovBase does not recognise — so it is recorded, not merely skipped.
  if (!planId) {
    return recordUnactionable(supabase, token, event, subscriptionId, "ignored",
      { reason: "unmapped_price", price: priceId, workspace_id: workspaceId });
  }

  // `deleted` is a status, not a delete. The row stays so the history of what
  // was billed survives; `canceled` is what the app reads.
  const status = event.type === "customer.subscription.deleted"
    ? "canceled"
    : (str(sub.status) ?? "incomplete");

  const period = (firstItem.current_period_start || firstItem.current_period_end)
    ? firstItem
    : sub;

  const { data, error } = await supabase.rpc("stripe_sync_subscription", {
    p_token: token,
    p_event_id: event.id,
    p_event_type: event.type,
    p_workspace_id: workspaceId,
    p_provider_subscription_id: subscriptionId,
    p_plan_id: planId,
    p_status: status,
    p_current_period_start: iso(period.current_period_start),
    p_current_period_end: iso(period.current_period_end),
    p_cancel_at_period_end: sub.cancel_at_period_end === true,
    p_stripe_price_id: priceId,
    p_stripe_customer_id: idOf(sub.customer),
    p_metadata: { canceled_at: iso(sub.canceled_at), ended_at: iso(sub.ended_at) } as Json,
  });
  if (error) throw new Error(`sync_failed:${error.code ?? "unknown"}`);
  const s = (data as { status?: string } | null)?.status;
  return { outcome: s === "duplicate_event" ? "duplicate_event" : "applied" };
}

/**
 * A refund is RECORDED and FLAGGED, never clawed back.
 *
 * `credit_wallets` carries CHECK (balance >= 0), so a customer who already
 * spent what they bought cannot be debited — and who absorbs that cost is a
 * business decision nobody has made. The database raises `needs_review` and a
 * human decides. Inventing the policy here would be the most expensive kind of
 * guess.
 */
async function onRefund(
  supabase: Client, token: string, event: StripeEvent,
): Promise<HandleResult> {
  const charge = event.data.object;
  const paymentId = idOf(charge.payment_intent);
  if (!paymentId) return { outcome: "ignored", detail: "no_payment_intent" };

  const refunded = int(charge.amount_refunded) ?? 0;
  const total = int(charge.amount) ?? 0;
  const { data, error } = await supabase.rpc("stripe_record_refund", {
    p_token: token,
    p_event_id: event.id,
    p_event_type: event.type,
    p_provider_payment_id: paymentId,
    p_amount_cents: refunded,
    p_status: refunded > 0 && refunded < total ? "partially_refunded" : "refunded",
    p_metadata: { charge_id: str(charge.id) } as Json,
  });
  if (error) throw new Error(`refund_failed:${error.code ?? "unknown"}`);
  const s = (data as { status?: string } | null)?.status;
  return { outcome: (s as HandledOutcome) ?? "recorded" };
}

/**
 * A failure is recorded so the customer's history is complete and so a support
 * question has an answer.
 *
 * IT CANNOT TOUCH A PAYMENT. `stripe_record_event` writes one payment_events
 * row and nothing else — deliberately a separate function from the refund one,
 * which does write `payments.status`. A failure event naming an id that had
 * already succeeded must never be able to flip a settled payment to 'failed',
 * and a failure followed by a success on the same PaymentIntent must leave the
 * success free to settle.
 */
async function onFailure(
  supabase: Client, token: string, event: StripeEvent, objectId: string | null,
): Promise<HandleResult> {
  const workspaceId = await resolveWorkspace(supabase, token, event.data.object);
  const { data, error } = await supabase.rpc("stripe_record_event", {
    p_token: token,
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: objectId ?? "",
    p_workspace_id: workspaceId,
    p_outcome: "failed",
    p_detail: {
      failure_code: str(event.data.object.failure_code)
        ?? str((event.data.object.last_payment_error as Record<string, unknown> | undefined)?.code),
    } as Json,
  });
  if (error) throw new Error(`failure_record_failed:${error.code ?? "unknown"}`);
  const s = (data as { status?: string } | null)?.status;
  return { outcome: s === "duplicate_event" ? "duplicate_event" : "recorded" };
}

/* ── the one entry point ───────────────────────────────────────────────────*/

export async function handleStripeEvent(
  supabase: Client, token: string | null, event: StripeEvent,
): Promise<HandleResult> {
  if (!token) return { outcome: "no_server_key" };

  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(supabase, token, event);
    case "payment_intent.succeeded":
      return onPaymentIntentSucceeded(supabase, token, event);
    case "invoice.paid":
      return onInvoicePaid(supabase, token, event);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return onSubscriptionEvent(supabase, token, event);
    case "charge.refunded":
      return onRefund(supabase, token, event);
    case "payment_intent.payment_failed":
      return onFailure(supabase, token, event, str(event.data.object.id));
    case "invoice.payment_failed":
      return onFailure(supabase, token, event, str(event.data.object.id));
    default:
      // Acknowledged, not acted on. A subscription that grows beyond the list
      // above must not make this endpoint start failing.
      return { outcome: "ignored", detail: "unhandled_type" };
  }
}
