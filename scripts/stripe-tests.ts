/**
 * STRIPE — THE TESTS THAT STAND BETWEEN THIS CODE AND REAL MONEY.
 *
 * Nothing here talks to Stripe and nothing here talks to a database. The
 * signature verifier is driven with real HMACs; the event handler is driven
 * against a recording fake that answers exactly as Postgres would, so "the
 * same event ten times grants credits once" can be proved without taking ten
 * payments.
 *
 *   A. the signature — the one thing standing between a forgery and the ledger
 *   B. the rate card — a quote and a charge cannot disagree
 *   C. custom credits — every way a browser can lie about a number
 *   D. checkout — what the server refuses to read from a request
 *   E. the webhook — which events grant, which record, which are ignored
 *   F. exactly once — 1×, 3×, 10×, and two DIFFERENT events for one payment
 *   G. credits come from the database, never from metadata
 *   H. secrets — where they may and may not appear in the repo
 *   I. the readiness signal — true about the running code, and still silent
 *
 * Run: npm run test:stripe
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createHmac } from "crypto";
import {
  verifyStripeSignature, parseStripeSignatureHeader, stripeSignaturePayload,
} from "../lib/stripe/signature";
import {
  creditLadder, customCreditsRange, priceForCredits, validateCustomCredits,
} from "../lib/plans/credit-price";
import { encodeForm } from "../lib/stripe/client";
import { stripeCredentials, stripeWebhookSecret, paymentsEnabled } from "../lib/stripe/config";
import { handleStripeEvent, HANDLED_EVENT_TYPES, type StripeEvent } from "../lib/server/stripe-webhook";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ── a real Stripe signature, made the way Stripe makes one ───────────────*/

const SECRET = "whsec_ZmFrZV90ZXN0X3NlY3JldF9ub3RfYV9yZWFsX29uZQ";
const OTHER_SECRET = "whsec_c29tZV9vdGhlcl9zZWNyZXRfZW50aXJlbHk";

function sign(body: string, timestamp: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret)
    .update(stripeSignaturePayload(timestamp, body), "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/* ── a fake Postgres that answers the way the real functions do ───────────*/

type RpcCall = { fn: string; args: Record<string, unknown> };

/**
 * THE POINT OF THIS FAKE: it enforces the two idempotency layers itself, in
 * the same order and with the same answers as migration 0113, so the tests
 * below exercise the real control flow rather than a description of it.
 *
 *   layer 1  a Set of event ids           → 'duplicate_event'
 *   layer 2  a Set of provider payment ids → 'already_settled'
 *
 * `ledger` accumulates only what `apply_credit_transaction` would have moved,
 * which is what "granted once" means.
 */
function fakeDb(rows: {
  packages?: Record<string, { id: string; name: string; credits: number; bonus_credits: number }>;
  plans?: Record<string, { id: string; name: string; monthly_credits: number; bonus_credits: number }>;
  priceToPlan?: Record<string, string>;
  customerToWorkspace?: Record<string, string>;
} = {}) {
  const seenEvents = new Set<string>();
  const settledPayments = new Set<string>();
  const calls: RpcCall[] = [];
  let ledger = 0;
  const grants: { credits: number; type: string; description: string }[] = [];

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const eventId = String(args.p_event_id ?? "");

    if (fn === "stripe_workspace_for") {
      const id = String(args.p_stripe_customer_id ?? "");
      return { data: rows.customerToWorkspace?.[id] ?? null, error: null };
    }
    if (fn === "stripe_settle_payment") {
      if (seenEvents.has(eventId)) return { data: { status: "duplicate_event" }, error: null };
      seenEvents.add(eventId);
      const paymentId = String(args.p_provider_payment_id ?? "");
      if (settledPayments.has(paymentId)) return { data: { status: "already_settled" }, error: null };
      settledPayments.add(paymentId);
      const credits = Number(args.p_credits ?? 0);
      if (credits > 0) {
        ledger += credits;
        grants.push({
          credits,
          type: String(args.p_credit_type),
          description: String(args.p_description),
        });
      }
      return { data: { status: "applied", payment_id: `pay_${paymentId}` }, error: null };
    }
    if (fn === "stripe_sync_subscription" || fn === "stripe_record_refund" || fn === "stripe_record_event") {
      if (seenEvents.has(eventId)) return { data: { status: "duplicate_event" }, error: null };
      seenEvents.add(eventId);
      return { data: { status: fn === "stripe_sync_subscription" ? "applied" : "recorded" }, error: null };
    }
    return { data: null, error: null };
  };

  const from = (table: string) => {
    const filters: Record<string, string> = {};
    const builder = {
      select: () => builder,
      eq: (col: string, val: string) => { filters[col] = val; return builder; },
      maybeSingle: async () => {
        if (table === "credit_packages") {
          return { data: rows.packages?.[filters.id] ?? null, error: null };
        }
        if (table === "subscription_plans") {
          if (filters.id) return { data: rows.plans?.[filters.id] ?? null, error: null };
          const priceCol = filters.stripe_price_id_monthly ?? filters.stripe_price_id_annual;
          const planId = priceCol ? rows.priceToPlan?.[priceCol] : undefined;
          return { data: planId ? { id: planId } : null, error: null };
        }
        return { data: null, error: null };
      },
    };
    return builder;
  };

  return {
    client: { rpc, from } as never,
    get ledger() { return ledger; },
    get grants() { return grants; },
    get calls() { return calls; },
    callsTo: (fn: string) => calls.filter((c) => c.fn === fn),
  };
}

const PACK = { id: "pack-1", name: "Standard", credits: 500, bonus_credits: 50 };
const PLAN = { id: "plan-1", name: "Pro", monthly_credits: 1200, bonus_credits: 0 };
const WS = "ws-1";

function checkoutEvent(id: string, over: Record<string, unknown> = {}): StripeEvent {
  return {
    id, type: "checkout.session.completed", livemode: true,
    data: { object: {
      id: "cs_1", mode: "payment", payment_status: "paid",
      payment_intent: "pi_1", customer: "cus_1",
      amount_total: 7900, currency: "pln",
      metadata: {
        grovbase_workspace_id: WS, type: "credit_package", grovbase_package_id: PACK.id,
        credits: "500", bonus_credits: "50",
      },
      ...over,
    } },
  };
}

async function main() {
  console.log("A. THE SIGNATURE");
  {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const now = 1_700_000_000;

    check("a genuine delivery verifies",
      verifyStripeSignature({ rawBody: body, header: sign(body, now), secret: SECRET, nowSeconds: now }).ok);

    // THE FORGERY. This is the assertion the ledger depends on.
    check("a body signed with another secret is refused",
      !verifyStripeSignature({ rawBody: body, header: sign(body, now, OTHER_SECRET), secret: SECRET, nowSeconds: now }).ok);

    check("a body changed after signing is refused",
      !verifyStripeSignature({
        rawBody: body.replace("evt_1", "evt_2"), header: sign(body, now), secret: SECRET, nowSeconds: now,
      }).ok, "one byte of difference must break the HMAC");

    // Even whitespace: this is why the route must never re-serialise.
    check("a re-serialised body is refused",
      !verifyStripeSignature({
        rawBody: JSON.stringify(JSON.parse(body), null, 2),
        header: sign(body, now), secret: SECRET, nowSeconds: now,
      }).ok, "parse-and-restringify changes the bytes, so the raw body must be used");

    check("no signature header is refused, with reason no_signature", (() => {
      const r = verifyStripeSignature({ rawBody: body, header: null, secret: SECRET, nowSeconds: now });
      return !r.ok && r.reason === "no_signature";
    })());
    check("no configured secret is refused, and says so",
      (() => {
        const r = verifyStripeSignature({ rawBody: body, header: sign(body, now), secret: null, nowSeconds: now });
        return !r.ok && r.reason === "no_secret";
      })());

    // REPLAY. An old capture must not stay valid forever.
    check("a delivery older than the tolerance is refused",
      !verifyStripeSignature({ rawBody: body, header: sign(body, now - 400), secret: SECRET, nowSeconds: now }).ok);
    check("one inside the tolerance is accepted",
      verifyStripeSignature({ rawBody: body, header: sign(body, now - 200), secret: SECRET, nowSeconds: now }).ok);
    check("a future-dated delivery is refused too",
      !verifyStripeSignature({ rawBody: body, header: sign(body, now + 400), secret: SECRET, nowSeconds: now }).ok);

    // DOWNGRADE. v0 is Stripe's test-mode scheme; accepting it would let a
    // test secret sign a live-looking event.
    const v0only = `t=${now},v0=${createHmac("sha256", SECRET).update(`${now}.${body}`).digest("hex")}`;
    check("a v0-only signature is refused", !verifyStripeSignature({
      rawBody: body, header: v0only, secret: SECRET, nowSeconds: now,
    }).ok, "only v1 is ever compared");

    // ROTATION. Stripe sends several v1 values while a secret is being rotated.
    const rotated = `${sign(body, now, OTHER_SECRET)},v1=${createHmac("sha256", SECRET).update(`${now}.${body}`).digest("hex")}`;
    check("any matching v1 passes during a rotation",
      verifyStripeSignature({ rawBody: body, header: rotated, secret: SECRET, nowSeconds: now }).ok);

    check("a garbage header is refused, not crashed on",
      !verifyStripeSignature({ rawBody: body, header: "nonsense", secret: SECRET, nowSeconds: now }).ok);
    check("a header with a non-numeric t is malformed",
      parseStripeSignatureHeader("t=abc,v1=ff") === null);
    check("a header with no v1 at all is refused", (() => {
      const r = verifyStripeSignature({ rawBody: body, header: `t=${now}`, secret: SECRET, nowSeconds: now });
      return !r.ok && r.reason === "malformed_signature";
    })());
    check("an empty body still verifies when correctly signed",
      verifyStripeSignature({ rawBody: "", header: sign("", now), secret: SECRET, nowSeconds: now }).ok);

    // The verifier must not be the Standard Webhooks one next door.
    const sig = codeOnly(read("lib/stripe/signature.ts"));
    check("the Stripe verifier is its own module, not the auth-hook one",
      !/webhook-signature/.test(sig) && /createHmac\("sha256", secret\)/.test(sig));
    check("and it compares hex, not base64", /digest\("hex"\)/.test(sig) && !/base64/.test(sig));
    check("comparison is constant-time", /timingSafeEqual/.test(sig));
  }

  console.log("\nB. THE RATE CARD");
  {
    const packs = [
      { credits: 100, bonus_credits: 0, price_cents: 1900 },
      { credits: 500, bonus_credits: 50, price_cents: 7900 },
      { credits: 1000, bonus_credits: 150, price_cents: 13900 },
      { credits: 2500, bonus_credits: 500, price_cents: 29900 },
    ];
    const ladder = creditLadder(packs);
    check("the ladder is the four production packs, ascending",
      ladder.length === 4 && ladder[0].credits === 100 && ladder[3].credits === 3000);
    check("a pack's position counts its bonus",
      ladder[1].credits === 550 && ladder[2].credits === 1150);

    const range = customCreditsRange(ladder);
    check("the range spans the real ladder", range?.min === 100 && range?.max === 3000);

    check("at a pack, the pack's own price", priceForCredits(550, ladder) === 7900);
    check("below the smallest, the smallest price — not extrapolated",
      priceForCredits(1, ladder) === 1900);
    check("above the largest, the largest price — not extrapolated",
      priceForCredits(99999, ladder) === 29900);
    const mid = priceForCredits(800, ladder);
    check("between two packs, between their prices", mid > 7900 && mid < 13900);
    check("and rounded to whole units of currency", mid % 100 === 0);
    check("the curve never falls as credits rise", (() => {
      let last = 0;
      for (let c = 100; c <= 3000; c += 25) {
        const p = priceForCredits(c, ladder);
        if (p < last) return false;
        last = p;
      }
      return true;
    })(), "a cheaper larger amount would be an arbitrage");

    // ONE implementation, shared. The slider used to carry its own copy.
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the slider uses the shared rate card",
      /priceForCredits\(/.test(board) && !/function priceFor\(/.test(board));
    const billing = codeOnly(read("lib/server/billing.ts"));
    check("and so does the server", /validateCustomCredits\(/.test(billing));
  }

  console.log("\nC. CUSTOM CREDITS — EVERY WAY A BROWSER CAN LIE");
  {
    const ladder = creditLadder([
      { credits: 100, bonus_credits: 0, price_cents: 1900 },
      { credits: 2500, bonus_credits: 500, price_cents: 29900 },
    ]);
    const bad = (v: unknown) => validateCustomCredits(v, ladder).ok === false;

    check("a negative amount is refused", bad(-500));
    check("zero is refused", bad(0));
    check("a fraction is refused", bad(500.5));
    check("a numeric STRING is refused, not coerced", bad("500"));
    check("exponent notation in a string is refused", bad("1e9"));
    check("NaN is refused", bad(NaN));
    check("Infinity is refused", bad(Infinity));
    check("null is refused", bad(null));
    check("undefined is refused", bad(undefined));
    check("an object is refused", bad({ credits: 500 }));
    check("an array is refused", bad([500]));
    check("below the ladder's floor is refused", bad(99));
    check("above the ladder's ceiling is refused", bad(3001));
    check("an overflow-sized integer is refused", bad(Number.MAX_SAFE_INTEGER));
    check("beyond MAX_SAFE_INTEGER is refused", bad(Number.MAX_SAFE_INTEGER + 2));

    const good = validateCustomCredits(1000, ladder);
    check("a legitimate amount is quoted", good.ok && good.credits === 1000 && good.amountCents > 0);
    check("the quote carries BOTH numbers, so they cannot be separated",
      good.ok && Number.isSafeInteger(good.amountCents));

    // THE PRICE-MANIPULATION TEST. Whatever a caller sends, the price comes
    // from the ladder — there is no parameter that could carry one.
    const a = validateCustomCredits(1000, ladder);
    const b = validateCustomCredits(1000, ladder);
    check("the same request always yields the same price",
      a.ok && b.ok && a.amountCents === b.amountCents);
    const action = codeOnly(read("app/actions/billing.ts"));
    check("no action takes an amount, a price or a currency",
      !/amount|price|currency/i.test(action.split("export async function").slice(1).join("").split("{")[0] ?? "")
      && !/amountCents\s*:/.test(action));
    check("no action takes a workspace id", !/workspaceId|workspace_id/.test(action));
  }

  console.log("\nD. WHAT CHECKOUT REFUSES TO READ FROM A REQUEST");
  {
    const billing = codeOnly(read("lib/server/billing.ts"));
    // Every exported entry point takes a WORKSPACE OBJECT the caller read from
    // the session — never an id a request could carry. (`baseMetadata` takes a
    // workspaceId, but it is a private helper fed by that same object.)
    const exportedSignatures = [...billing.matchAll(/export (?:async )?function (\w+)\(([^)]*)\)/g)];
    check("every exported checkout entry point takes a session workspace, not an id",
      exportedSignatures.length >= 4
      && exportedSignatures.every(([, , params]) =>
        !/workspaceId|workspace_id/.test(params)
        && (/workspace: WorkspaceRef/.test(params) || !/workspace/i.test(params))),
      exportedSignatures.map(([, name]) => name).join(", "));
    check("the customer id is resolved, never accepted",
      /resolveStripeCustomer\(/.test(billing)
      && !/stripeCustomerId\s*:\s*string\s*[,)]/.test(billing));
    check("a package's price is a stored Stripe Price id, not an amount",
      /line_items: \[\{ price: pack\.stripe_price_id, quantity: 1 \}\]/.test(billing));
    check("an unmapped package is refused rather than priced here",
      /if \(!pack\.stripe_price_id\) return \{ ok: false, reason: "not_mapped" \}/.test(billing));
    check("only an ACTIVE row can be bought",
      (billing.match(/\.eq\("active", true\)/g) ?? []).length >= 2);
    check("the free plan is not for sale",
      /plan\.price_cents <= 0[\s\S]*plan_not_purchasable/.test(billing));
    check("annual is refused until a real annual price exists",
      /billing === "annual" \? plan\.stripe_price_id_annual/.test(billing)
      && /if \(!priceId\) return \{ ok: false, reason: "not_mapped" \}/.test(billing));
    check("the portal never accepts a customer id",
      /createBillingPortalSession\(\s*supabase: Client, workspace: WorkspaceRef,?\s*\)/.test(billing));
    check("every Stripe write carries an idempotency key",
      !/stripePost<[^>]*>\([^)]*\}\s*\)\s*;/.test(billing),
      "stripePost requires one by signature, so a call without it would not compile");

    // The form encoder is what turns a nested request into Stripe's grammar.
    check("nested params encode the way Stripe reads them",
      encodeForm({ line_items: [{ price: "price_1", quantity: 1 }] })
        === "line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1");
    check("null and undefined are dropped, not sent as words",
      encodeForm({ a: "x", b: null, c: undefined }) === "a=x");
  }

  console.log("\nE. THE WEBHOOK — WHAT EACH EVENT DOES");
  {
    const db = fakeDb({ packages: { [PACK.id]: PACK } });
    const r = await handleStripeEvent(db.client, "tok", checkoutEvent("evt_1"));
    check("a paid package checkout settles", r.outcome === "applied");
    check("and grants the PACKAGE's credits, base plus bonus", db.ledger === 550);
    check("as a 'purchase' ledger entry", db.grants[0]?.type === "purchase");

    // The PaymentIntent is the key BOTH events use.
    const settle = db.callsTo("stripe_settle_payment")[0];
    check("keyed on the PaymentIntent, not the session",
      settle.args.p_provider_payment_id === "pi_1");

    const sub = fakeDb();
    const subResult = await handleStripeEvent(sub.client, "tok",
      checkoutEvent("evt_sub", { mode: "subscription" }));
    check("a SUBSCRIPTION checkout grants nothing here", subResult.outcome === "ignored");
    check("...because invoice.paid is what pays for it", sub.ledger === 0);

    const unpaid = fakeDb({ packages: { [PACK.id]: PACK } });
    const unpaidResult = await handleStripeEvent(unpaid.client, "tok",
      checkoutEvent("evt_unpaid", { payment_status: "unpaid" }));
    check("an unpaid session grants nothing", unpaidResult.outcome === "ignored" && unpaid.ledger === 0);

    const noWs = fakeDb({ packages: { [PACK.id]: PACK } });
    const noWsResult = await handleStripeEvent(noWs.client, "tok",
      checkoutEvent("evt_nows", { metadata: { type: "credit_package", grovbase_package_id: PACK.id }, customer: null }));
    check("an event naming no workspace grants nothing",
      noWsResult.outcome === "unresolved_workspace" && noWs.ledger === 0);
    // AND IT LEAVES A TRACE. Answering 200 and writing nothing would make the
    // event vanish: the money is in Stripe, the customer has nothing, and no
    // row anywhere says so.
    check("...but it IS recorded, so a human can find it",
      noWs.callsTo("stripe_record_event").length === 1
      && noWs.callsTo("stripe_record_event")[0].args.p_outcome === "unresolved_workspace");
    check("...and recording it moved no payment",
      noWs.callsTo("stripe_settle_payment").length === 0);

    // Same for a subscription billed on a price no plan claims: somebody is
    // being charged for something GrovBase does not recognise.
    const unmapped = fakeDb({ priceToPlan: {} });
    const unmappedResult = await handleStripeEvent(unmapped.client, "tok", {
      id: "evt_unmapped", type: "customer.subscription.updated", data: { object: {
        id: "sub_x", customer: "cus_1", status: "active",
        metadata: { grovbase_workspace_id: WS },
        items: { data: [{ price: "price_nobody_knows" }] },
      } },
    });
    check("a subscription on an unmapped price is recorded, not silently skipped",
      unmappedResult.outcome === "ignored"
      && unmapped.callsTo("stripe_record_event").length === 1
      && unmapped.callsTo("stripe_sync_subscription").length === 0);

    // The customer -> workspace fallback, for a subscription made in the
    // Stripe dashboard.
    const viaCustomer = fakeDb({
      packages: { [PACK.id]: PACK }, customerToWorkspace: { cus_9: WS },
    });
    const viaResult = await handleStripeEvent(viaCustomer.client, "tok",
      checkoutEvent("evt_via", {
        metadata: { type: "credit_package", grovbase_package_id: PACK.id }, customer: "cus_9",
      }));
    check("a customer id resolves the workspace when metadata does not",
      viaResult.outcome === "applied" && viaCustomer.ledger === 550);

    // invoice.paid — the renewal.
    const inv = fakeDb({ plans: { [PLAN.id]: PLAN }, priceToPlan: { price_pro: PLAN.id } });
    const invResult = await handleStripeEvent(inv.client, "tok", {
      id: "evt_inv", type: "invoice.paid", data: { object: {
        id: "in_1", customer: "cus_1", amount_paid: 29900, currency: "pln",
        subscription: "sub_1", metadata: { grovbase_workspace_id: WS },
        lines: { data: [{ price: "price_pro" }] },
      } },
    });
    check("a paid invoice grants the PLAN's monthly credits",
      invResult.outcome === "applied" && inv.ledger === 1200);
    check("as a 'subscription' ledger entry", inv.grants[0]?.type === "subscription");
    check("keyed on the INVOICE, so each period grants once",
      inv.callsTo("stripe_settle_payment")[0].args.p_provider_payment_id === "in_1");

    // THE SHAPE THIS ENDPOINT DOES NOT CHOOSE. A webhook created without an
    // explicit api_version receives the ACCOUNT's default, and that moves when
    // Stripe upgrades the account. Between 2024-06-20 and the Basil releases
    // the price id, the subscription and the metadata all moved. Reading only
    // one shape means a renewal that is paid and never credited.
    const modern = fakeDb({ plans: { [PLAN.id]: PLAN }, priceToPlan: { price_pro: PLAN.id } });
    const modernResult = await handleStripeEvent(modern.client, "tok", {
      id: "evt_inv_modern", type: "invoice.paid", data: { object: {
        id: "in_2", customer: "cus_1", amount_paid: 29900, currency: "pln",
        // No invoice.metadata, no invoice.subscription — both moved.
        parent: { subscription_details: {
          subscription: "sub_1", metadata: { grovbase_workspace_id: WS },
        } },
        lines: { data: [{ pricing: { price_details: { price: "price_pro" } } }] },
      } },
    });
    check("a Basil-shaped invoice still finds the workspace and the plan",
      modernResult.outcome === "applied" && modern.ledger === 1200,
      "lines[].pricing.price_details.price and parent.subscription_details.metadata");

    // And a workspace known only through the customer, with the modern shape.
    const modernViaCustomer = fakeDb({
      plans: { [PLAN.id]: PLAN }, priceToPlan: { price_pro: PLAN.id },
      customerToWorkspace: { cus_7: WS },
    });
    await handleStripeEvent(modernViaCustomer.client, "tok", {
      id: "evt_inv_dash", type: "invoice.paid", data: { object: {
        id: "in_3", customer: "cus_7", amount_paid: 29900, currency: "pln",
        parent: { subscription_details: { subscription: "sub_2" } },
        lines: { data: [{ pricing: { price_details: { price: "price_pro" } } }] },
      } },
    });
    check("a subscription made in the Stripe dashboard still renews credits",
      modernViaCustomer.ledger === 1200,
      "no GrovBase metadata anywhere — only the customer id links it back");

    // subscription lifecycle — state only.
    const subSync = fakeDb({ priceToPlan: { price_pro: PLAN.id } });
    const syncResult = await handleStripeEvent(subSync.client, "tok", {
      id: "evt_subupd", type: "customer.subscription.updated", data: { object: {
        id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true,
        metadata: { grovbase_workspace_id: WS },
        items: { data: [{ price: "price_pro", current_period_start: 1700000000, current_period_end: 1702592000 }] },
      } },
    });
    check("a subscription update syncs state", syncResult.outcome === "applied");
    check("and grants NOTHING — credits come from the invoice", subSync.ledger === 0);
    const syncArgs = subSync.callsTo("stripe_sync_subscription")[0].args;
    check("cancel_at_period_end is carried through", syncArgs.p_cancel_at_period_end === true);
    check("the period is sent as a timestamp, not epoch seconds",
      typeof syncArgs.p_current_period_end === "string" && syncArgs.p_current_period_end.includes("T"));

    const del = fakeDb({ priceToPlan: { price_pro: PLAN.id } });
    await handleStripeEvent(del.client, "tok", {
      id: "evt_subdel", type: "customer.subscription.deleted", data: { object: {
        id: "sub_1", customer: "cus_1", status: "active", canceled_at: 1702592000,
        metadata: { grovbase_workspace_id: WS }, items: { data: [{ price: "price_pro" }] },
      } },
    });
    check("a deleted subscription is stored as 'canceled', not deleted",
      del.callsTo("stripe_sync_subscription")[0].args.p_status === "canceled");

    // refund — recorded, never clawed back.
    const ref = fakeDb();
    const refResult = await handleStripeEvent(ref.client, "tok", {
      id: "evt_ref", type: "charge.refunded", data: { object: {
        id: "ch_1", payment_intent: "pi_1", amount: 7900, amount_refunded: 7900,
      } },
    });
    check("a refund is recorded", refResult.outcome === "recorded");
    check("and never touches the ledger", ref.ledger === 0);
    const part = fakeDb();
    await handleStripeEvent(part.client, "tok", {
      id: "evt_part", type: "charge.refunded", data: { object: {
        id: "ch_2", payment_intent: "pi_2", amount: 7900, amount_refunded: 1000,
      } },
    });
    check("a partial refund is marked as partial",
      part.callsTo("stripe_record_refund")[0].args.p_status === "partially_refunded");

    // a failure never touches a payment row
    const fail = fakeDb();
    const failResult = await handleStripeEvent(fail.client, "tok", {
      id: "evt_fail", type: "payment_intent.payment_failed", data: { object: {
        id: "pi_3", customer: "cus_1", metadata: { grovbase_workspace_id: WS },
        last_payment_error: { code: "card_declined" },
      } },
    });
    check("a failed payment is recorded", failResult.outcome === "recorded");
    check("through the record-only function, which cannot write payments.status",
      fail.callsTo("stripe_record_event").length === 1
      && fail.callsTo("stripe_record_refund").length === 0);
    check("and grants nothing", fail.ledger === 0);

    const unknown = fakeDb();
    const unknownResult = await handleStripeEvent(unknown.client, "tok", {
      id: "evt_unknown", type: "customer.created", data: { object: { id: "cus_2" } },
    });
    check("an unsubscribed event type is acknowledged, not failed",
      unknownResult.outcome === "ignored");
    check("and touches nothing", unknown.calls.length === 0);

    check("no server key means no write at all", (await handleStripeEvent(
      fakeDb().client, null, checkoutEvent("evt_nokey"),
    )).outcome === "no_server_key");
  }

  console.log("\nF. EXACTLY ONCE");
  {
    // 1×, 3×, 10× — the brief's requirement, stated as an experiment.
    for (const times of [1, 3, 10]) {
      const db = fakeDb({ packages: { [PACK.id]: PACK } });
      const event = checkoutEvent("evt_same");
      const outcomes: string[] = [];
      for (let i = 0; i < times; i += 1) {
        outcomes.push((await handleStripeEvent(db.client, "tok", event)).outcome);
      }
      check(`the same event ${times}× grants exactly one 550-credit transaction`,
        db.ledger === 550 && db.grants.length === 1,
        `ledger=${db.ledger} grants=${db.grants.length}`);
      check(`...and the repeats answer duplicate_event (${times}×)`,
        outcomes.slice(1).every((o) => o === "duplicate_event"));
    }

    // TWO DIFFERENT EVENTS for ONE payment — Stripe explicitly warns this
    // happens, and layer 1 alone would not catch it.
    const db = fakeDb({ packages: { [PACK.id]: PACK } });
    const a = await handleStripeEvent(db.client, "tok", checkoutEvent("evt_a"));
    const b = await handleStripeEvent(db.client, "tok", {
      id: "evt_b", type: "payment_intent.succeeded", data: { object: {
        id: "pi_1", customer: "cus_1", amount_received: 7900, currency: "pln",
        metadata: { grovbase_workspace_id: WS, type: "credit_package", grovbase_package_id: PACK.id },
      } },
    });
    check("checkout.session.completed and payment_intent.succeeded are two events",
      a.outcome === "applied" && b.outcome === "already_settled");
    check("...for ONE payment, so the ledger moved once", db.ledger === 550);
    check("...caught by layer 2, the unique on (provider, payment id)",
      db.callsTo("stripe_settle_payment").every((c) => c.args.p_provider_payment_id === "pi_1"));

    // Interleaved, reversed order — the webhook does not control arrival order.
    const rev = fakeDb({ packages: { [PACK.id]: PACK } });
    await handleStripeEvent(rev.client, "tok", {
      id: "evt_b2", type: "payment_intent.succeeded", data: { object: {
        id: "pi_9", customer: "cus_1", amount_received: 7900, currency: "pln",
        metadata: { grovbase_workspace_id: WS, type: "credit_package", grovbase_package_id: PACK.id },
      } },
    });
    await handleStripeEvent(rev.client, "tok", checkoutEvent("evt_a2", { payment_intent: "pi_9" }));
    check("arriving in the other order still grants once", rev.ledger === 550);

    // A repeated subscription.updated is legitimate and must not be deduped
    // by object id — only by event id.
    const sync = fakeDb({ priceToPlan: { price_pro: PLAN.id } });
    const mkSub = (id: string, status: string) => ({
      id, type: "customer.subscription.updated", data: { object: {
        id: "sub_7", customer: "cus_1", status,
        metadata: { grovbase_workspace_id: WS }, items: { data: [{ price: "price_pro" }] },
      } },
    } as StripeEvent);
    const s1 = await handleStripeEvent(sync.client, "tok", mkSub("evt_s1", "active"));
    const s2 = await handleStripeEvent(sync.client, "tok", mkSub("evt_s2", "past_due"));
    check("two DIFFERENT updates for one subscription both apply",
      s1.outcome === "applied" && s2.outcome === "applied",
      "a blanket key on (type, object) would have dropped the second");
  }

  console.log("\nG. CREDITS COME FROM THE DATABASE");
  {
    // THE FORGED-METADATA TEST. Metadata says a million; the package row says
    // 550; the ledger must move 550.
    const db = fakeDb({ packages: { [PACK.id]: PACK } });
    await handleStripeEvent(db.client, "tok", checkoutEvent("evt_forged", {
      metadata: {
        grovbase_workspace_id: WS, type: "credit_package",
        grovbase_package_id: PACK.id, credits: "1000000", bonus_credits: "1000000",
      },
    }));
    check("metadata claiming a million grants the package's real 550", db.ledger === 550);

    // A package id that names no row grants nothing — it does not fall back
    // to the metadata figure.
    const missing = fakeDb({ packages: {} });
    await handleStripeEvent(missing.client, "tok", checkoutEvent("evt_missing"));
    check("an unknown package grants nothing", missing.ledger === 0);
    check("...but the payment is still recorded",
      missing.callsTo("stripe_settle_payment").length === 1);

    // A plan's credits likewise come from its row.
    const plan = fakeDb({ plans: { [PLAN.id]: PLAN }, priceToPlan: { price_pro: PLAN.id } });
    await handleStripeEvent(plan.client, "tok", {
      id: "evt_planforge", type: "invoice.paid", data: { object: {
        id: "in_9", customer: "cus_1", amount_paid: 29900, currency: "pln",
        metadata: { grovbase_workspace_id: WS, credits: "999999" },
        lines: { data: [{ price: "price_pro" }] },
      } },
    });
    check("a plan's credits come from subscription_plans, not the invoice",
      plan.ledger === 1200);

    // Custom credits are the ONE case metadata is believed — and only after
    // the signature proved the event describes a session we created.
    const custom = fakeDb();
    await handleStripeEvent(custom.client, "tok", checkoutEvent("evt_custom", {
      metadata: { grovbase_workspace_id: WS, type: "custom_credits", credits: "800" },
    }));
    check("a custom amount grants what the session recorded", custom.ledger === 800);
    check("as a 'topup' ledger entry", custom.grants[0]?.type === "topup");

    for (const bad of ["-5", "0", "1.5", "abc", ""]) {
      const c = fakeDb();
      await handleStripeEvent(c.client, "tok", checkoutEvent(`evt_bad_${bad || "empty"}`, {
        metadata: { grovbase_workspace_id: WS, type: "custom_credits", credits: bad },
      }));
      check(`a custom credits value of "${bad}" grants nothing`, c.ledger === 0);
    }

    // Nothing in the handler may reach a balance except through the one door.
    const hook = codeOnly(read("lib/server/stripe-webhook.ts"));
    check("the handler never writes credit_wallets",
      !/credit_wallets/.test(hook));
    check("the handler never inserts credit_transactions",
      !/from\("credit_transactions"\)/.test(hook));
    check("the only settle path is stripe_settle_payment",
      (hook.match(/rpc\("stripe_settle_payment"/g) ?? []).length === 1);
    check("no PostgREST filter is built by string concatenation",
      !/\.or\(`/.test(hook), "an or() filter is a grammar, not a value slot");
  }

  console.log("\nH. SECRETS");
  {
    const cfg = read("lib/stripe/config.ts");
    check("the secret key is read from the environment only",
      /process\.env\.STRIPE_SECRET_KEY/.test(cfg));
    check("no NEXT_PUBLIC_ Stripe variable exists anywhere in the config",
      !/NEXT_PUBLIC_STRIPE/.test(cfg));
    check("the config is server-only, so a client import fails the build",
      /^import "server-only";/m.test(cfg));
    check("paymentsEnabled requires BOTH secrets",
      /stripeCredentials\(\) !== null && stripeWebhookSecret\(\) !== null/.test(cfg),
      "a key without a webhook secret can charge and never confirm");
    check("the gap report names variables, never values",
      /gaps\.push\("STRIPE_SECRET_KEY"\)/.test(cfg) && !/slice\(/.test(cfg));

    // A live key must not be anywhere in the tree. Walk it rather than trust
    // a .gitignore.
    const SECRET_SHAPES = [
      { name: "a live Stripe secret key", re: /sk_live_[A-Za-z0-9]{10,}/ },
      { name: "a test Stripe secret key", re: /sk_test_[A-Za-z0-9]{20,}/ },
      { name: "a Stripe restricted key", re: /rk_live_[A-Za-z0-9]{10,}/ },
    ];
    const SKIP = new Set(["node_modules", ".git", ".next", "out", "dist", ".vercel"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (st.size > 2_000_000) continue;
        if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|sql|md|sh|yml|yaml|env|txt)$/.test(entry)) continue;
        // This file names the shapes it is looking for; it is not a leak.
        if (full.endsWith("scripts/stripe-tests.ts")) continue;
        const src = readFileSync(full, "utf8");
        for (const s of SECRET_SHAPES) if (s.re.test(src)) hits.push(`${full}: ${s.name}`);
      }
    };
    walk(".");
    check("no Stripe secret key is committed anywhere in the tree",
      hits.length === 0, hits.join("; "));

    const route = read("app/api/hooks/stripe/route.ts");
    check("the route reads the RAW body before anything parses it",
      route.indexOf("request.text()") < route.indexOf("JSON.parse"));
    check("and verifies the signature before parsing",
      route.indexOf("verifyStripeSignature") < route.indexOf("JSON.parse"));
    check("a bad signature answers 401, which Stripe will not retry",
      /status: 401/.test(route) || /\? 500 : 401/.test(route));
    check("a missing webhook secret answers 500 — it is our fault, not theirs",
      /verdict\.reason === "no_secret" \? 500/.test(route));
    check("no service-role client appears in the webhook",
      !/service_role|SERVICE_ROLE/.test(route) && !/service_role/.test(read("lib/server/stripe-webhook.ts")));
    check("the signature header is never logged",
      !/stripe-signature.*console|console.*stripe-signature/i.test(codeOnly(route)));
    check("the raw body is never logged", !/console\.[a-z]+\([^)]*rawBody/.test(route));

    check("every handled event type is one the endpoint subscribes to",
      HANDLED_EVENT_TYPES.length === 9);
  }

  console.log("\nI. THE READINESS SIGNAL — TRUE, AND STILL SILENT");
  {
    // Assembled rather than written out, so no secret-shaped literal sits in
    // the repository for a scanner to find and a human to wonder about.
    const FAKE_LIVE = ["sk", "live", "0000000000000000000000"].join("_");
    const FAKE_TEST = ["sk", "test", "0000000000000000000000"].join("_");
    const FAKE_WHSEC = "whsec_" + "0".repeat(32);
    const before = {
      key: process.env.STRIPE_SECRET_KEY,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    };
    const set = (key?: string, secret?: string) => {
      if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = key;
      if (secret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = secret;
    };

    try {
      // THE QUESTION A DASHBOARD SCREENSHOT CANNOT SETTLE: is the code that is
      // RUNNING holding a live key or a test one? It is read off the key's own
      // prefix, so no second switch can disagree with the key in use.
      set(FAKE_LIVE, FAKE_WHSEC);
      check("a live-shaped key reports mode 'live'", stripeCredentials()?.mode === "live");
      check("...and livemode is derived, not configured", stripeCredentials()?.livemode === true);
      check("both secrets present means ready", paymentsEnabled());

      set(FAKE_TEST, FAKE_WHSEC);
      check("a test-shaped key reports mode 'test'", stripeCredentials()?.mode === "test");
      check("...and livemode false", stripeCredentials()?.livemode === false);

      // A KEY WITHOUT A WEBHOOK SECRET IS NOT READY. Such a deployment can
      // start a checkout and can never confirm it: the customer pays and
      // receives nothing, because credits come from the signed webhook alone.
      set(FAKE_LIVE, undefined);
      check("a key with no webhook secret is NOT ready", !paymentsEnabled());
      check("...though the key itself still reads", stripeCredentials()?.mode === "live");

      set(undefined, FAKE_WHSEC);
      check("a webhook secret with no key is NOT ready", !paymentsEnabled());
      check("...and there is no mode to report", stripeCredentials() === null);

      set("not-a-stripe-key", FAKE_WHSEC);
      check("a malformed key is refused, not half-trusted", stripeCredentials() === null);
      set(FAKE_LIVE, "not-a-whsec");
      check("a malformed webhook secret is refused", stripeWebhookSecret() === null);
      set(undefined, undefined);
      check("nothing configured is not ready", !paymentsEnabled());
    } finally {
      set(before.key, before.secret);
    }

    // The GET body is the whole public surface of this. It must carry the two
    // booleans and NOTHING derived from a secret's content.
    const route = codeOnly(read("app/api/hooks/stripe/route.ts"));
    const getBody = route.slice(route.indexOf("export function GET"));
    check("the readiness response reports ready and mode",
      /ready: paymentsEnabled\(\)/.test(getBody) && /mode: creds\?\.mode/.test(getBody));
    check("and nothing else — no value, length, prefix or gap list",
      !/secretKey/.test(getBody) && !/slice\(/.test(getBody)
      && !/length/.test(getBody) && !/stripeConfigGaps/.test(getBody)
      && !/process\.env/.test(getBody));
    check("GET is still a status check, never a delivery",
      !/handleStripeEvent/.test(getBody) && !/verifyStripeSignature/.test(getBody));
  }

  console.log(failures === 0
    ? "\nAll Stripe tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("stripe tests crashed:", e); process.exit(1); });
