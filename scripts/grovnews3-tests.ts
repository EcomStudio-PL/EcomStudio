/**
 * GROVNEWS STAGE 3 — PAID SUBSCRIPTION, LAUNCH BONUS, DISCOUNT CODES.
 *
 * The TypeScript half. The SQL half (idempotency keys, the extend-only grant,
 * the one-claim constraint, the code bound to its owner, RLS) runs on a real
 * Postgres in scripts/grovnews3-sql-tests.sh. Here the real modules are driven
 * against a recording fake database and a fake Stripe over the real HTTP
 * client — no network, no card, no Supabase.
 *
 *   G. GrovNews: webhook branch, price sync, checkout guard, cancel/resume
 *   L. launch campaign: form rules, Warsaw time, the survey hook, the pages
 *   D. discount codes: what the browser may send, the quote, the subscription,
 *      redemption on a PAID invoice only
 *   S. separation: GrovNews never reaches credits; plans without a code are
 *      exactly what they were
 *
 * Run: npm run test:grovnews3
 */
import { readFileSync } from "fs";

process.env.STRIPE_SECRET_KEY ??= ["sk", "test", "0".repeat(28)].join("_");
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_ZmFrZV90ZXN0X3NlY3JldF9ub3RfYV9yZWFsX29uZQ";
process.env.GROVBASE_SERVER_KEY ??= "test-server-key-not-a-real-one-0123456789";

import { handleStripeEvent, type StripeEvent } from "../lib/server/stripe-webhook";
import {
  beginGrovNewsSubscription, setGrovNewsCancelAtPeriodEnd, setGrovNewsPrice, normaliseCode, LAUNCH_CODE_RE,
} from "../lib/server/grovnews-billing";
import { beginCheckout, quoteCheckout, type Quote } from "../lib/server/checkout";
import {
  parseLaunchCampaignInput, parsePriceZl, warsawLocalToIso, isoToWarsawLocal, discountedCents, parseGrovNewsState,
} from "../lib/grovnews-billing";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ── a recording fake database ──────────────────────────────────────────────*/

type Rpc = (args: Record<string, unknown>) => { data: unknown; error: { code: string } | null };
type Tables = Record<string, Record<string, unknown>[]>;

function fakeDb(rpcs: Record<string, Rpc> = {}, tables: Tables = {}, userId: string | null = "user-1") {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    const h = rpcs[fn];
    return h ? h(args) : { data: null, error: null };
  };
  const from = (table: string) => {
    reads.push(table);
    const rows = tables[table] ?? [];
    const result = { data: rows, error: null };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gt", "lte", "not", "or", "order", "limit", "is"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.single = async () => ({ data: rows[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return b;
  };
  const auth = { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) };
  return { client: { rpc, from, auth } as never, calls, reads, to: (fn: string) => calls.filter((c) => c.fn === fn) };
}

/* ── a fake Stripe, over the real HTTP client ──────────────────────────────*/

type SCall = { method: string; path: string; body: Record<string, string>; idem: string | null };

function fakeStripe(script: {
  echoAmount?: number;
  list?: Record<string, unknown>[];
  get?: Record<string, unknown>;
  subAmount?: (body: Record<string, string>) => number;
} = {}) {
  const calls: SCall[] = [];
  let seq = 0;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    const [pathOnly] = href.replace("https://api.stripe.com/v1", "").split("?");
    const method = init?.method ?? "GET";
    const body: Record<string, string> = {};
    if (typeof init?.body === "string") {
      for (const pair of init.body.split("&")) {
        if (!pair) continue;
        const [k, v] = pair.split("=");
        body[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
      }
    }
    const idem = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"] ?? null;
    calls.push({ method, path: pathOnly, body, idem });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (method === "POST" && pathOnly === "/products") return json({ id: "prod_gn" });
    if (method === "POST" && pathOnly === "/prices") {
      seq += 1;
      return json({ id: `price_gn_${seq}`, unit_amount: script.echoAmount ?? Number(body.unit_amount),
        currency: body.currency, recurring: body["recurring[interval]"] ? { interval: body["recurring[interval]"] } : null });
    }
    if (method === "POST" && /^\/prices\//.test(pathOnly)) return json({ id: pathOnly.split("/")[2], active: false });
    if (method === "GET" && pathOnly === "/subscriptions") return json({ data: script.list ?? [] });
    if (method === "GET" && /^\/subscriptions\//.test(pathOnly)) return json(script.get ?? {});
    if (method === "POST" && pathOnly === "/subscriptions") {
      seq += 1;
      const amount = script.subAmount ? script.subAmount(body) : 3900;
      return json({ id: `sub_new_${seq}`, status: "incomplete", metadata: {},
        latest_invoice: { id: `in_${seq}`, payment_intent: { id: `pi_${seq}`, client_secret: `pi_${seq}_secret_x`, amount, status: "requires_payment_method" } } });
    }
    if (method === "POST" && /^\/subscriptions\//.test(pathOnly)) {
      return json({ id: pathOnly.split("/")[2], status: "active", cancel_at_period_end: body.cancel_at_period_end === "true" });
    }
    return json({});
  }) as typeof fetch;
  return calls;
}

/* ── event builders ────────────────────────────────────────────────────────*/

const period = { start: 1_790_000_000, end: 1_792_592_000 };
function gnInvoice(id: string, over: Record<string, unknown> = {}): StripeEvent {
  return {
    id, type: "invoice.paid", created: 1_790_000_100,
    data: { object: {
      id: "in_gn_1", customer: "cus_1", amount_paid: 3900, currency: "pln",
      lines: { data: [{ price: { id: "price_gn_1" }, period }] },
      parent: { subscription_details: { subscription: "sub_gn_1",
        metadata: { type: "grovnews_subscription", grovbase_user_id: "user-1", grovbase_workspace_id: "ws-1" } } },
      ...over,
    } },
  };
}
function planInvoice(id: string, meta: Record<string, string> = {}): StripeEvent {
  return {
    id, type: "invoice.paid",
    data: { object: {
      id: "in_plan_1", customer: "cus_1", amount_paid: 7920, currency: "pln",
      lines: { data: [{ price: { id: "price_pro_m" }, period }] },
      parent: { subscription_details: { subscription: "sub_plan_1",
        metadata: { type: "subscription", grovbase_workspace_id: "ws-1", grovbase_plan_id: "plan-pro", ...meta } } },
    } },
  };
}
function gnSubEvent(id: string, type: string, sub: Record<string, unknown>, created = 1_790_000_200): StripeEvent {
  return {
    id, type, created,
    data: { object: {
      id: "sub_gn_1", customer: "cus_1", status: "active", cancel_at_period_end: false,
      metadata: { type: "grovnews_subscription", grovbase_user_id: "user-1", grovbase_workspace_id: "ws-1" },
      items: { data: [{ price: { id: "price_gn_1", unit_amount: 3900, currency: "pln" },
        current_period_start: period.start, current_period_end: period.end }] },
      ...sub,
    } },
  };
}

/** A fake that answers the GrovNews and plan webhook functions the way 0113/0123 do. */
function webhookDb(opts: { grovnewsPrices?: string[]; classifyFails?: boolean } = {}) {
  const seen = new Set<string>();
  const invoices = new Set<string>();
  const settled = new Set<string>();
  const redeemed = new Map<string, string>();
  let ledger = 0;
  const once = (args: Record<string, unknown>) => {
    const e = String(args.p_event_id);
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  };
  const db = fakeDb({
    grovnews_is_billing_object: (a) => opts.classifyFails
      ? { data: null, error: { code: "42501" } }
      : { data: (opts.grovnewsPrices ?? []).includes(String(a.p_price_id)), error: null },
    grovnews_invoice_paid: (a) => {
      if (!once(a)) return { data: { status: "duplicate_event" }, error: null };
      if (invoices.has(String(a.p_invoice_id))) return { data: { status: "already_settled" }, error: null };
      invoices.add(String(a.p_invoice_id));
      return { data: { status: "applied" }, error: null };
    },
    grovnews_sync_subscription: (a) => ({ data: { status: once(a) ? "applied" : "duplicate_event" }, error: null }),
    stripe_catalogue: (a) => ({ data: { package: null, plan: a.p_price_id === "price_pro_m" || a.p_plan_id === "plan-pro"
      ? { id: "plan-pro", name: "Pro", monthly_credits: 1000, bonus_credits: 0 } : null }, error: null }),
    stripe_settle_payment: (a) => {
      if (!once(a)) return { data: { status: "duplicate_event" }, error: null };
      if (settled.has(String(a.p_provider_payment_id))) return { data: { status: "already_settled" }, error: null };
      settled.add(String(a.p_provider_payment_id));
      ledger += Number(a.p_credits ?? 0);
      return { data: { status: "applied" }, error: null };
    },
    stripe_sync_subscription: (a) => ({ data: { status: once(a) ? "applied" : "duplicate_event" }, error: null }),
    grovnews_launch_code_redeem: (a) => {
      const prev = redeemed.get(String(a.p_code_id));
      if (!prev) { redeemed.set(String(a.p_code_id), String(a.p_subscription_id)); return { data: { status: "redeemed" }, error: null }; }
      return { data: { status: prev === a.p_subscription_id ? "already_redeemed" : "redeemed_elsewhere" }, error: null };
    },
    stripe_record_event: () => ({ data: { status: "recorded" }, error: null }),
  });
  return { ...db, get ledger() { return ledger; }, redeemed };
}

async function main() {
  /* ══ G ══════════════════════════════════════════════════════════════════ */
  section("G. GROVNEWS — webhook, price, checkout, cancel");

  {
    const db = webhookDb();
    const r = await handleStripeEvent(db.client, "tok", gnInvoice("evt_g1"));
    const call = db.to("grovnews_invoice_paid")[0]?.args ?? {};
    check("G1 a GrovNews invoice.paid goes to grovnews_invoice_paid with the user and the PAID period end",
      r.outcome === "applied" && call.p_user_id === "user-1" && call.p_subscription_id === "sub_gn_1"
      && call.p_period_end === new Date(period.end * 1000).toISOString() && call.p_amount_paid === 3900);
    check("G1b ...and never reaches the plan settlement, the credit ledger or the plan subscriptions table",
      db.to("stripe_settle_payment").length === 0 && db.to("stripe_sync_subscription").length === 0 && db.ledger === 0);
    check("G1c recognised from its own metadata — no lookup needed", db.to("grovnews_is_billing_object").length === 0);
    const outcomes = [];
    for (let i = 0; i < 10; i++) outcomes.push((await handleStripeEvent(db.client, "tok", gnInvoice("evt_g1"))).outcome);
    check("G2 the same event 10× → one effect (duplicate_event every time after the first)",
      outcomes.every((o) => o === "duplicate_event"));
    const other = await handleStripeEvent(db.client, "tok", gnInvoice("evt_g1_other"));
    check("G2b a different event for the same invoice → already_settled", other.outcome === "already_settled");
  }
  {
    const db = webhookDb({ grovnewsPrices: ["price_gn_1"] });
    const ev = gnInvoice("evt_g3", { parent: undefined, subscription: "sub_gn_1" });
    const r = await handleStripeEvent(db.client, "tok", ev);
    check("G3 no metadata (older payload / dashboard) → recognised by the stable Price id, still GrovNews",
      r.outcome === "applied" && db.to("grovnews_is_billing_object").length === 1 && db.to("stripe_settle_payment").length === 0);
  }
  {
    const db = webhookDb({ classifyFails: true });
    let threw = false;
    try { await handleStripeEvent(db.client, "tok", gnInvoice("evt_g4", { parent: undefined, subscription: "sub_x" })); }
    catch { threw = true; }
    check("G4 a failed GrovNews lookup throws (→ 500 → Stripe retries), it is never read as 'a plan'",
      threw && db.to("stripe_settle_payment").length === 0);
  }
  {
    const db = webhookDb();
    const r1 = await handleStripeEvent(db.client, "tok", gnSubEvent("evt_s1", "customer.subscription.updated", { cancel_at_period_end: true }));
    const a1 = db.to("grovnews_sync_subscription")[0]?.args ?? {};
    check("G5 subscription.updated (cancel at period end) → grovnews_sync_subscription, flag carried, event time for ordering",
      r1.outcome === "applied" && a1.p_cancel_at_period_end === true && a1.p_deleted === false
      && a1.p_event_created === new Date(1_790_000_200 * 1000).toISOString() && db.to("stripe_sync_subscription").length === 0);
    await handleStripeEvent(db.client, "tok", gnSubEvent("evt_s2", "customer.subscription.updated", { cancel_at: period.end }));
    check("G5b a Portal cancellation that arrives as cancel_at counts as 'will not renew'",
      db.to("grovnews_sync_subscription")[1]?.args.p_cancel_at_period_end === true);
    await handleStripeEvent(db.client, "tok", gnSubEvent("evt_s3", "customer.subscription.deleted", { status: "canceled", ended_at: period.end }));
    const a3 = db.to("grovnews_sync_subscription")[2]?.args ?? {};
    check("G5c subscription.deleted → p_deleted with the end moment (the database cuts paid_through there)",
      a3.p_deleted === true && a3.p_ended_at === new Date(period.end * 1000).toISOString() && a3.p_cancel_at_period_end === false);
    await handleStripeEvent(db.client, "tok", gnSubEvent("evt_s4", "customer.subscription.updated", { status: "past_due" }));
    check("G5d past_due is passed through as a status; access is never extended by a subscription event",
      db.to("grovnews_sync_subscription")[3]?.args.p_status === "past_due" && db.to("grovnews_invoice_paid").length === 0);
  }
  {
    const db = webhookDb();
    await handleStripeEvent(db.client, "tok", planInvoice("evt_p1"));
    check("G6 a PLAN invoice is untouched: settled with the plan's credits, no GrovNews call, no lookup",
      db.to("stripe_settle_payment").length === 1 && db.ledger === 1000
      && db.to("grovnews_invoice_paid").length === 0 && db.to("grovnews_is_billing_object").length === 0);
  }

  {
    const stripe = fakeStripe();
    const db = fakeDb({
      grovnews_billing_state: () => ({ data: { sales_enabled: false, price_cents: null, currency: "PLN", stripe_product_id: null,
        stripe_price_id: null, stripe_price_cents: null, sync_status: "unsynced", sync_error: null, price_changed_at: null }, error: null }),
      grovnews_billing_apply_price: () => ({ data: { status: "applied", previous_price_id: null }, error: null }),
    });
    const r = await setGrovNewsPrice(db.client, 2900, "admin-1");
    const product = stripe.find((c) => c.path === "/products");
    const price = stripe.find((c) => c.path === "/prices");
    const apply = db.to("grovnews_billing_apply_price")[0]?.args ?? {};
    check("G7 first price: ONE Product (stable idempotency key), a MONTHLY PLN Price in grosze",
      r.ok && product?.idem === "product:grovnews:v1" && price?.body.unit_amount === "2900"
      && price?.body.currency === "pln" && price?.body["recurring[interval]"] === "month");
    check("G7b the Product id is stored before the Price is made (no retry can create a second one)",
      db.to("grovnews_billing_mark").some((c) => c.args.p_product_id === "prod_gn"));
    check("G7c the Price key names what it replaces; the apply is a compare-and-swap on it",
      Boolean(price?.idem?.startsWith("price:grovnews:2900:none:")) && apply.p_expected_previous === null && apply.p_price_id === "price_gn_1");
  }
  {
    const stripe = fakeStripe({ echoAmount: 1 });
    const db = fakeDb({
      grovnews_billing_state: () => ({ data: { sales_enabled: true, price_cents: 2900, currency: "PLN", stripe_product_id: "prod_gn",
        stripe_price_id: "price_old", stripe_price_cents: 2900, sync_status: "synced" }, error: null }),
    });
    const r = await setGrovNewsPrice(db.client, 3900, "admin-1");
    check("G8 Stripe echoing a different amount → refused, the new Price archived, nothing applied, old price stays on sale",
      !r.ok && db.to("grovnews_billing_apply_price").length === 0
      && stripe.some((c) => c.path === "/prices/price_gn_1" && c.body.active === "false")
      && db.to("grovnews_billing_mark").at(-1)?.args.p_status === "synced");
  }
  {
    const stripe = fakeStripe();
    const db = fakeDb({
      grovnews_billing_state: () => ({ data: { sales_enabled: true, price_cents: 2900, currency: "PLN", stripe_product_id: "prod_gn",
        stripe_price_id: "price_old", stripe_price_cents: 2900, sync_status: "synced" }, error: null }),
      grovnews_billing_apply_price: () => ({ data: { status: "conflict" }, error: null }),
    });
    const r = await setGrovNewsPrice(db.client, 3900, "admin-1");
    const s9 = fakeStripe();
    let reads = 0;
    const live = fakeDb({
      grovnews_billing_state: () => {
        reads += 1;
        return { data: { sales_enabled: true, price_cents: 2900, currency: "PLN", stripe_product_id: "prod_gn",
          stripe_price_id: reads === 1 ? "price_old" : "price_gn_1", stripe_price_cents: 2900, sync_status: "synced" }, error: null };
      },
      grovnews_billing_apply_price: () => ({ data: { status: "conflict" }, error: null }),
    });
    await setGrovNewsPrice(live.client, 3900, "admin-1");
    check("G9e a 'conflict' whose Price turns out to be the LIVE one is never archived",
      !s9.some((c) => c.path === "/prices/price_gn_1" && c.body.active === "false"));
    check("G9 two admins at once: the loser gets 'conflict' and its new Price is archived",
      !r.ok && r.reason === "conflict" && stripe.some((c) => c.path === "/prices/price_gn_1" && c.body.active === "false"));
    const stripe2 = fakeStripe();
    const db2 = fakeDb({
      grovnews_billing_state: () => ({ data: { sales_enabled: true, price_cents: 2900, currency: "PLN", stripe_product_id: "prod_gn",
        stripe_price_id: "price_old", stripe_price_cents: 2900, sync_status: "synced" }, error: null }),
      grovnews_billing_apply_price: () => ({ data: { status: "applied", previous_price_id: "price_old" }, error: null }),
    });
    const ok = await setGrovNewsPrice(db2.client, 3900, "admin-1");
    check("G9b a real change: new Price, OLD one archived for new sales (subscribers are not migrated — no subscription call)",
      ok.ok && ok.changed && stripe2.some((c) => c.path === "/prices/price_old" && c.body.active === "false")
      && !stripe2.some((c) => c.path.startsWith("/subscriptions")) && !stripe2.some((c) => c.path === "/products"));
    const stripe3 = fakeStripe();
    const same = await setGrovNewsPrice(db2.client, 2900, "admin-1");
    check("G9c the same confirmed amount again → no Stripe call at all", same.ok && !same.changed && stripe3.length === 0);
    const bad = await Promise.all([199, 1_000_001, 12.5, -100].map((v) => setGrovNewsPrice(db2.client, v, "a")));
    check("G9d out-of-range or fractional amounts are refused before Stripe", bad.every((b) => !b.ok && b.reason === "invalid_amount"));
  }

  const beginArgs = { userId: "user-1", workspaceId: "ws-1", customer: "cus_1", priceId: "price_gn_1", amountCents: 3900, livemode: true };
  {
    const stripe = fakeStripe();
    const db = fakeDb({ grovnews_checkout_begin: () => ({ data: { status: "already_active" }, error: null }) });
    const r = await beginGrovNewsSubscription(db.client, beginArgs);
    check("G10 a person with a live GrovNews subscription cannot buy a second one (database)",
      !r.ok && r.reason === "already_subscribed" && stripe.length === 0);
  }
  {
    const stripe = fakeStripe({ list: [{ id: "sub_live", status: "active", metadata: { type: "grovnews_subscription", grovbase_user_id: "user-1" },
      items: { data: [{ price: { id: "price_gn_1" } }] }, latest_invoice: null }] });
    const db = fakeDb({ grovnews_checkout_begin: () => ({ data: { status: "locked" }, error: null }) });
    const r = await beginGrovNewsSubscription(db.client, beginArgs);
    check("G10b ...nor while the webhook is still on its way (Stripe itself says active) — and the lock is released",
      !r.ok && r.reason === "already_subscribed" && !stripe.some((c) => c.method === "POST")
      && db.to("grovnews_checkout_attach")[0]?.args.p_subscription_id === null);
  }
  {
    const stripe = fakeStripe({ get: { id: "sub_first", status: "incomplete",
      metadata: { type: "grovnews_subscription", grovbase_user_id: "user-1" },
      latest_invoice: { id: "in_1", payment_intent: { id: "pi_1", client_secret: "pi_1_secret_a", amount: 3900 } } } });
    const db = fakeDb({ grovnews_checkout_begin: () => ({ data: { status: "in_progress", stripe_subscription_id: "sub_first" }, error: null }) });
    const r = await beginGrovNewsSubscription(db.client, beginArgs);
    check("G11 a double click / parallel request is handed the SAME subscription, never a second one",
      r.ok && r.reference === "sub_first" && !stripe.some((c) => c.method === "POST" && c.path === "/subscriptions"));
    const stripe2 = fakeStripe({ get: { id: "sub_other", status: "incomplete", metadata: { type: "grovnews_subscription", grovbase_user_id: "user-2" },
      latest_invoice: { id: "in_1", payment_intent: { id: "pi_1", client_secret: "x", amount: 3900 } } } });
    const r2 = await beginGrovNewsSubscription(db.client, beginArgs);
    check("G11b ...and never someone else's (a subscription for another user is not resumed)",
      !r2.ok && r2.reason === "in_progress" && !stripe2.some((c) => c.method === "POST"));
  }
  {
    const stripe = fakeStripe();
    const db = fakeDb({ grovnews_checkout_begin: () => ({ data: { status: "locked" }, error: null }) });
    const r = await beginGrovNewsSubscription(db.client, beginArgs);
    const post = stripe.find((c) => c.method === "POST" && c.path === "/subscriptions");
    check("G12 a new subscription: the admin-set Price, default_incomplete, metadata type grovnews_subscription + THIS user",
      r.ok && post?.body["items[0][price]"] === "price_gn_1" && post?.body.payment_behavior === "default_incomplete"
      && post?.body["metadata[type]"] === "grovnews_subscription" && post?.body["metadata[grovbase_user_id]"] === "user-1"
      && !("metadata[grovbase_plan_id]" in (post?.body ?? {})) && Boolean(post?.idem?.startsWith("grovnews-sub:user-1:")));
    check("G12b the lock remembers which subscription it started", r.ok && db.to("grovnews_checkout_attach")[0]?.args.p_subscription_id === r.reference);
    fakeStripe({ subAmount: () => 100 });
    const bad = await beginGrovNewsSubscription(db.client, beginArgs);
    check("G12c Stripe charging anything but the displayed price → refused", !bad.ok && bad.reason === "stripe_error");
    const s3 = fakeStripe({ list: [{ id: "sub_inc", status: "incomplete", metadata: { type: "grovnews_subscription", grovbase_user_id: "user-1" },
      items: { data: [{ price: { id: "price_gn_1" } }] },
      latest_invoice: { id: "in_9", payment_intent: { id: "pi_9", client_secret: "pi_9_secret", amount: 3900 } } }] });
    const resumed = await beginGrovNewsSubscription(db.client, beginArgs);
    check("G12d an earlier incomplete attempt is resumed, not stacked", resumed.ok && resumed.reference === "sub_inc"
      && !s3.some((c) => c.method === "POST"));
  }
  {
    const stripe = fakeStripe();
    const db = fakeDb({ grovnews_subscription_for: (a) => ({ data: a.p_user_id === "user-1"
      ? { stripe_subscription_id: "sub_gn_1", live: true } : null, error: null }) });
    const r = await setGrovNewsCancelAtPeriodEnd(db.client, "user-1", true);
    const post = stripe.find((c) => c.method === "POST");
    check("G13 cancel = cancel_at_period_end on the SESSION user's own subscription (no id is taken from a caller)",
      r.ok && r.cancelAtPeriodEnd && post?.path === "/subscriptions/sub_gn_1" && post.body.cancel_at_period_end === "true"
      && db.to("grovnews_subscription_for")[0]?.args.p_user_id === "user-1");
    fakeStripe();
    const other = await setGrovNewsCancelAtPeriodEnd(db.client, "user-2", true);
    check("G13b a user with no subscription of their own reaches nothing", !other.ok && other.reason === "no_subscription");
  }
  {
    const billing = { sales_enabled: true, price_cents: 3900, currency: "PLN", stripe_product_id: "prod_gn",
      stripe_price_id: "price_gn_1", stripe_price_cents: 3900, sync_status: "synced" };
    const on = fakeDb({ grovnews_billing_state: () => ({ data: billing, error: null }), grovnews_subscription_for: () => ({ data: null, error: null }) });
    const q = await quoteCheckout(on.client, { id: "ws-1" }, { kind: "grovnews" });
    check("G14 the GrovNews quote is the admin-set, Stripe-confirmed price; no credits",
      q.ok && q.quote.kind === "grovnews" && q.quote.amountCents === 3900 && q.quote.credits === 0 && q.quote.period === "monthly");
    const off = fakeDb({ grovnews_billing_state: () => ({ data: { ...billing, sales_enabled: false }, error: null }) });
    const q2 = await quoteCheckout(off.client, { id: "ws-1" }, { kind: "grovnews" });
    const drift = fakeDb({ grovnews_billing_state: () => ({ data: { ...billing, stripe_price_cents: 3800 }, error: null }) });
    const q3 = await quoteCheckout(drift.client, { id: "ws-1" }, { kind: "grovnews" });
    const live = fakeDb({ grovnews_billing_state: () => ({ data: billing, error: null }),
      grovnews_subscription_for: () => ({ data: { live: true }, error: null }) });
    const q4 = await quoteCheckout(live.client, { id: "ws-1" }, { kind: "grovnews" });
    check("G14b sales OFF, a drifted Price, or a live subscription → no sale",
      !q2.ok && q2.reason === "grovnews_unavailable" && !q3.ok && q3.reason === "grovnews_unavailable"
      && !q4.ok && q4.reason === "already_subscribed");
  }

  /* ══ L ══════════════════════════════════════════════════════════════════ */
  section("L. LAUNCH CAMPAIGN");
  {
    const base = { name: "Premiera", window_start: "2026-10-01T08:00:00.000Z", window_end: "2026-10-03T08:00:00.000Z",
      access_mode: "DAYS", access_days: 30, discount_enabled: true, discount_type: "PERCENT", discount_value: 20,
      discount_duration: "REPEATING", discount_months: 3, eligible_plan_ids: ["11111111-1111-4111-8111-111111111111"], code_valid_days: 30 };
    const ok = parseLaunchCampaignInput(base);
    check("L1 a full campaign parses into the database's shape", ok.ok && ok.value.access_days === 30 && ok.value.discount_months === 3);
    const cases: [string, Record<string, unknown>, string][] = [
      ["window end before start", { window_end: "2026-09-30T08:00:00.000Z" }, "window"],
      ["no name", { name: "  " }, "name"],
      ["0 days", { access_days: 0 }, "access"],
      ["UNTIL without a date", { access_mode: "UNTIL", access_days: null }, "access"],
      ["91 %", { discount_value: 91 }, "discount"],
      ["13 months", { discount_months: 13 }, "months"],
      ["no plans", { eligible_plan_ids: [] }, "plans"],
      ["a plan id that is not a uuid", { eligible_plan_ids: ["1 or 1=1"] }, "plans"],
      ["validity 0", { code_valid_days: 0 }, "validity"],
    ];
    for (const [name, patch, err] of cases) {
      const r = parseLaunchCampaignInput({ ...base, ...patch });
      check(`L2 refused: ${name}`, !r.ok && r.error === err, JSON.stringify(r));
    }
    const noDisc = parseLaunchCampaignInput({ ...base, discount_enabled: false, access_mode: "FOREVER" });
    check("L3 without a discount every discount field is cleared; FOREVER carries no days",
      noDisc.ok && noDisc.value.discount_type === null && noDisc.value.eligible_plan_ids.length === 0 && noDisc.value.access_days === null);
    check("L4 Warsaw time → UTC, summer and winter", warsawLocalToIso("2026-07-01T10:00") === "2026-07-01T08:00:00.000Z"
      && warsawLocalToIso("2026-12-01T10:00") === "2026-12-01T09:00:00.000Z");
    check("L4b ...and back, for the form", isoToWarsawLocal("2026-07-01T08:00:00.000Z") === "2026-07-01T10:00");
    const wb = code(read("app/actions/welcome-bonus.ts"));
    check("L5 the survey claim asks for the launch bonus on success AND on 'already claimed', after the credit RPC",
      (wb.match(/launchAfterSurvey\(supabase\)/g) ?? []).length === 2
      && wb.indexOf('rpc("claim_welcome_bonus"') < wb.indexOf("launchAfterSurvey(supabase)"));
    check("L5b the existing credit bonus call is unchanged (same RPC, same single argument)",
      /supabase\.rpc\("claim_welcome_bonus", \{\s*p_answers: checked\.clean,\s*\}\)/.test(wb));
    for (const f of ["app/(app)/grovnews/page.tsx", "app/(app)/grovnews/[slug]/page.tsx", "app/(app)/settings/page.tsx"]) {
      const src = code(read(f));
      check(`L6 ${f}: a due launch claim lands before access is read`,
        src.includes("await ensureLaunchBonus(supabase)") && src.indexOf("await ensureLaunchBonus(supabase)") < Math.max(
          src.indexOf("hasActiveGrovNewsAccess(supabase)"), src.indexOf('rpc("grovnews_my_state")')));
    }
    const mig = read("supabase/migrations/0123_grovnews_monetization.sql");
    check("L7 eligibility is decided in the database from auth.users.created_at + the completed survey + an ACTIVE campaign",
      /u\.created_at >= c\.window_start/.test(mig) && /u\.created_at <= c\.window_end/.test(mig)
      && /w\.claimed_at is not null/.test(mig) && /c\.status = 'ACTIVE'/.test(mig));
    check("L8 the claim takes no user id argument (auth.uid() only)", /create function public\.grovnews_launch_ensure\(\)/.test(mig)
      && /v_user\s+uuid := auth\.uid\(\)/.test(mig));
    check("L9 one claim per (campaign, user) is a constraint", /constraint grovnews_launch_one_claim unique \(campaign_id, user_id\)/.test(mig));
    check("L10 source is LAUNCH_BONUS, extend-only, never reviving an admin REVOKE",
      /'LAUNCH_BONUS', 'ACTIVE'/.test(mig) && /greatest\(grovnews_entitlements\.expires_at, excluded\.expires_at\)/.test(mig)
      && /where grovnews_entitlements\.status <> 'REVOKED'/.test(mig));
    const state = parseGrovNewsState({ access: true, sources: ["LAUNCH_BONUS"], offer: { available: true, price_cents: 3900, currency: "PLN" },
      paid: null, launch: { access_granted: true, access_expires_at: null, forever: true, code: "GROV-ABCD-EFGH", plans: ["Pro"] } });
    check("L11 the customer's state is read defensively into one typed shape",
      state?.launch?.forever === true && state.launch.code === "GROV-ABCD-EFGH" && state.offer.priceCents === 3900 && state.paid === null
      && parseGrovNewsState(null) === null);
  }

  /* ══ D ══════════════════════════════════════════════════════════════════ */
  section("D. DISCOUNT CODES");
  {
    check("D1 the code shape: GROV-XXXX-XXXX from 32 unambiguous characters",
      LAUNCH_CODE_RE.test("GROV-AB2C-9XYZ") && !LAUNCH_CODE_RE.test("GROV-AB0C-9XYZ") && !LAUNCH_CODE_RE.test("GROV-ABIC-9XYZ")
      && !LAUNCH_CODE_RE.test("grov-ab2c-9xyz"));
    check("D2 input is trimmed and upper-cased; anything else (objects, numbers, huge strings) is dropped",
      normaliseCode("  grov-ab2c-9xyz ") === "GROV-AB2C-9XYZ" && normaliseCode({ coupon: "x" }) === null
      && normaliseCode(100) === null && normaliseCode("x".repeat(40)) === null);
    const act = code(read("app/actions/checkout.ts"));
    const sanitise = act.slice(act.indexOf("function sanitise"), act.indexOf("export async function quoteCheckoutAction"));
    check("D3 the server action passes ONLY a normalised code string — no coupon, percentage or amount field is read",
      /const code = normaliseCode\(raw\.code\)/.test(sanitise)
      && !/raw\.(coupon|discount|percent|amount|amountCents|coupon_id|discount_percent)/.test(sanitise));
    const page = code(read("app/(app)/checkout/page.tsx"));
    check("D3b the URL too: only `code`, normalised", /normaliseCode\(one\("code"\)\)/.test(page) && !/one\("(coupon|discount|amount)"\)/.test(page));

    const plan = { id: "plan-pro", name: "Pro", description: null, price_cents: 9900, annual_price_cents: 0, currency: "PLN",
      monthly_credits: 1000, bonus_credits: 0, features: {}, stripe_price_id_monthly: "price_pro_m", stripe_price_id_annual: null,
      stripe_price_monthly_cents: 9900, stripe_price_annual_cents: null, stripe_sync_status: "synced" };
    const resolve: Rpc = (a) => a.p_code === "GROV-AB2C-9XYZ" && a.p_user_id === "user-1"
      ? { data: { ok: true, code_id: "code-1", coupon_id: "coupon_launch", discount_type: "PERCENT", discount_value: 20,
          discount_duration: "REPEATING", discount_months: 3, first_charge_cents: 7920 }, error: null }
      : { data: { ok: false, reason: "code_invalid" }, error: null };
    const tables = { subscription_plans: [plan], subscriptions: [] };
    const plain = fakeDb({ grovnews_launch_code_resolve: resolve }, tables);
    const q0 = await quoteCheckout(plain.client, { id: "ws-1" }, { kind: "subscription", planId: "plan-pro", period: "monthly" });
    check("D4 WITHOUT a code the quote is exactly the old one — no code lookup, no discount field, no refusal field",
      q0.ok && q0.quote.amountCents === 9900 && !("discount" in q0.quote) && !("codeRefusal" in q0.quote)
      && plain.to("grovnews_launch_code_resolve").length === 0);
    const withCode = fakeDb({ grovnews_launch_code_resolve: resolve }, tables);
    const q1 = await quoteCheckout(withCode.client, { id: "ws-1" }, { kind: "subscription", planId: "plan-pro", period: "monthly", code: "GROV-AB2C-9XYZ" });
    check("D5 a valid code: the discount comes from the server (the campaign), resolved for the SESSION user",
      q1.ok && q1.quote.discount?.firstChargeCents === 7920 && q1.quote.amountCents === 9900
      && withCode.to("grovnews_launch_code_resolve")[0]?.args.p_user_id === "user-1");
    check("D5b the coupon id never leaves the server (not in the quote the browser receives)",
      q1.ok && !JSON.stringify(q1.quote).includes("coupon_launch"));
    const wrong = fakeDb({ grovnews_launch_code_resolve: resolve }, tables, "user-2");
    const q2 = await quoteCheckout(wrong.client, { id: "ws-1" }, { kind: "subscription", planId: "plan-pro", period: "monthly", code: "GROV-AB2C-9XYZ" });
    check("D6 another user's code: refused, and the order is priced as without a code",
      q2.ok && q2.quote.codeRefusal === "code_invalid" && !q2.quote.discount && q2.quote.amountCents === 9900);

    const s0 = fakeStripe({ subAmount: () => 9900 });
    const b0 = fakeDb({ stripe_customer_for: () => ({ data: "cus_1", error: null }), grovnews_launch_code_resolve: resolve }, tables);
    const r0 = await beginCheckout(b0.client, { id: "ws-1" }, "a@b.pl", { kind: "subscription", planId: "plan-pro", period: "monthly" });
    const p0 = s0.find((c) => c.method === "POST" && c.path === "/subscriptions")?.body ?? {};
    check("D7 without a code the subscription is created exactly as before: no discounts, no code metadata",
      r0.ok && !Object.keys(p0).some((k) => k.startsWith("discounts")) && !("metadata[grovbase_launch_code_id]" in p0)
      && p0["metadata[type]"] === "subscription");
    const s1 = fakeStripe({ subAmount: (body) => (body["discounts[0][coupon]"] ? 7920 : 9900) });
    const b1 = fakeDb({ stripe_customer_for: () => ({ data: "cus_1", error: null }), grovnews_launch_code_resolve: resolve }, tables);
    const r1 = await beginCheckout(b1.client, { id: "ws-1" }, "a@b.pl", { kind: "subscription", planId: "plan-pro", period: "monthly", code: "GROV-AB2C-9XYZ" });
    const p1 = s1.find((c) => c.method === "POST" && c.path === "/subscriptions")?.body ?? {};
    check("D8 with a valid code: ONE coupon — the campaign's — and the code id for the webhook (no stacking)",
      r1.ok && p1["discounts[0][coupon]"] === "coupon_launch" && !("discounts[1][coupon]" in p1)
      && p1["metadata[grovbase_launch_code_id]"] === "code-1" && (r1 as { quote: Quote }).quote.discount?.firstChargeCents === 7920);
    fakeStripe({ list: [{ id: "sub_old", status: "incomplete", metadata: {}, items: { data: [{ price: { id: "price_pro_m" } }] },
      latest_invoice: { id: "in_o", payment_intent: { id: "pi_o", client_secret: "pi_o_secret", amount: 9900 } } }],
      subAmount: () => 7920 });
    const r2 = await beginCheckout(b1.client, { id: "ws-1" }, "a@b.pl", { kind: "subscription", planId: "plan-pro", period: "monthly", code: "GROV-AB2C-9XYZ" });
    check("D9 an earlier attempt WITHOUT the code is not resumed for a discounted order (the discount would be lost)",
      r2.ok && r2.reference !== "sub_old");
    fakeStripe({ list: [{ id: "sub_old", status: "incomplete", metadata: {}, items: { data: [{ price: { id: "price_pro_m" } }] },
      latest_invoice: { id: "in_o", payment_intent: { id: "pi_o", client_secret: "pi_o_secret", amount: 9900 } } }] });
    const r3 = await beginCheckout(b0.client, { id: "ws-1" }, "a@b.pl", { kind: "subscription", planId: "plan-pro", period: "monthly" });
    check("D9b ...while an order without a code resumes it exactly as before", r3.ok && r3.reference === "sub_old");

    const db = webhookDb();
    await handleStripeEvent(db.client, "tok", planInvoice("evt_c1", { grovbase_launch_code_id: "code-1" }));
    check("D10 the code is marked used on the plan's PAID invoice — after settlement, keyed on the subscription",
      db.to("grovnews_launch_code_redeem")[0]?.args.p_code_id === "code-1"
      && db.to("grovnews_launch_code_redeem")[0]?.args.p_subscription_id === "sub_plan_1"
      && db.calls.findIndex((c) => c.fn === "stripe_settle_payment") < db.calls.findIndex((c) => c.fn === "grovnews_launch_code_redeem"));
    for (let i = 0; i < 3; i++) await handleStripeEvent(db.client, "tok", planInvoice("evt_c1", { grovbase_launch_code_id: "code-1" }));
    check("D11 retries (3×) settle nothing twice and leave the code used once, by the same subscription",
      db.ledger === 1000 && db.redeemed.size === 1 && db.redeemed.get("code-1") === "sub_plan_1");
    const gone = fakeDb({ stripe_customer_for: () => ({ data: "cus_1", error: null }),
      grovnews_launch_code_resolve: () => ({ data: { ok: false, reason: "code_used" }, error: null }) }, tables);
    const s14 = fakeStripe();
    const r14 = await beginCheckout(gone.client, { id: "ws-1" }, "a@b.pl", { kind: "subscription", planId: "plan-pro", period: "monthly", code: "GROV-AB2C-9XYZ" });
    check("D14 a code that stopped applying between the page and the payment is REFUSED — never a silent full-price charge",
      !r14.ok && r14.reason === "code_used" && !s14.some((c) => c.method === "POST"));
    const plainDb = webhookDb();
    await handleStripeEvent(plainDb.client, "tok", planInvoice("evt_c2"));
    check("D12 a plan invoice without a code touches no code", plainDb.to("grovnews_launch_code_redeem").length === 0);
    const hook = code(read("lib/server/stripe-webhook.ts"));
    check("D13 only invoice.paid redeems (never checkout creation, never subscription.created)",
      (hook.match(/redeemLaunchCode\(supabase/g) ?? []).length === 1
      && hook.indexOf("redeemLaunchCode(supabase") > hook.indexOf("async function onInvoicePaid"));
    check("D13b discounted amounts never fall under the 2 zł first charge (display arithmetic = database arithmetic)",
      discountedCents(9900, "PERCENT", 20) === 7920 && discountedCents(4900, "AMOUNT", 1000) === 3900);
  }

  /* ══ S ══════════════════════════════════════════════════════════════════ */
  section("S. SEPARATION AND SECURITY");
  {
    const files = ["lib/server/grovnews-billing.ts", "app/actions/grovnews-billing.ts", "lib/services/grovnews-billing.ts",
      "components/grovnews/billing-card.tsx", "components/admin/grovnews/monetization.tsx", "lib/grovnews-billing.ts"];
    for (const f of files) {
      const src = code(read(f));
      check(`S1 ${f}: never touches credits, the plan subscriptions table or payments`,
        !/apply_credit_transaction|stripe_settle_payment|credit_wallets|credit_transactions|from\("subscriptions"\)|from\("payments"\)/.test(src));
    }
    const mig = code(read("supabase/migrations/0123_grovnews_monetization.sql")).replace(/--.*$/gm, "");
    check("S2 migration 0123 writes no credit, payment or plan-subscription row",
      !/insert into public\.(payments|subscriptions|credit_)/.test(mig) && !/apply_credit_transaction/.test(mig)
      && !/update public\.(payments|subscriptions|credit_)/.test(mig));
    check("S3 PAID cannot be a hand-written entitlement", /check \(source <> 'PAID'\)/.test(mig));
    check("S4 no service-role anywhere in the new code", files.every((f) => !/service_role|SERVICE_ROLE/.test(read(f))));
    const acts = code(read("app/actions/grovnews-billing.ts"));
    const admin = acts.split("export async function ").slice(1).filter((c) => !c.startsWith("setGrovNewsRenewalAction"));
    const late = admin.filter((c) => {
      const gate = c.indexOf("await requireAdmin()");
      const first = Math.min(...["supabase.from(", "supabase.rpc(", "setGrovNewsPrice(", "activateLaunchCampaign("]
        .map((k) => c.indexOf(k)).filter((i) => i >= 0));
      return gate < 0 || gate > first;
    });
    check("S5 every admin action checks the role before anything else", admin.length === 5 && late.length === 0,
      late.map((c) => c.slice(0, 30)).join(", "));
    check("S6 the customer's cancel takes no subscription id — only true/false",
      /export async function setGrovNewsRenewalAction\(cancel: boolean\)/.test(acts));
    const reader = read("components/grovnews/reader.tsx");
    check("S7 the locked screen shows a price only when the server passes one, and links to the in-app checkout",
      /offer \? \(/.test(reader) && /\/checkout\?kind=grovnews/.test(reader));
    const hook = code(read("lib/server/stripe-webhook.ts"));
    check("S8 the webhook tries GrovNews FIRST in both invoice.paid and subscription events",
      hook.indexOf("isGrovNews(supabase, token, subscriptionMeta") < hook.indexOf("resolveWorkspace(supabase, token, invoice);\n  if (!workspaceId)")
      && hook.indexOf("isGrovNews(supabase, token, metaOf(sub)") < hook.indexOf("stripe_sync_subscription"));
    const route = read("app/api/hooks/stripe/route.ts");
    check("S9 still ONE webhook endpoint, signature-verified on the raw body", /verifyStripeSignature/.test(route) && /request\.text\(\)|req\.text\(\)/.test(route));
  }

  console.log(failures === 0 ? "\nAll GrovNews Stage 3 tests passed." : `\n${failures} GrovNews Stage 3 test(s) failed.`);
  if (failures > 0) process.exit(1);
}

void main();
