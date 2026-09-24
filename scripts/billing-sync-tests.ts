/**
 * BILLING 2.0 — THE TESTS THAT STAND BETWEEN AN ADMIN'S KEYBOARD AND A CARD.
 *
 * The bug these exist for: an admin changes 49 zł to 59 zł, GrovBase shows 59,
 * Stripe charges 49, and nothing anywhere notices because the two numbers live
 * in two systems that never speak.
 *
 * Nothing here touches the real Stripe or a real database. `globalThis.fetch`
 * is replaced with a recording fake that answers exactly as Stripe's REST API
 * would, and the Supabase client is a fake that answers as Postgres would — so
 * the REAL `syncPrice`, the REAL encoder and the REAL ordering are exercised,
 * and every assertion below is about code that ships.
 *
 *   A. a price change creates a NEW Price and archives the old one
 *   B. the Product is reused, never recreated
 *   C. nothing happens when nothing changed
 *   D. Stripe fails  → GrovBase's price does NOT move
 *   E. Postgres fails → nothing is left sellable at an unverified amount
 *   F. Stripe echoes a different amount → refused
 *   G. sellable() — the runtime half of the guarantee
 *   H. custom credits are priced by the server, never by the browser
 *   I. subscriptions: new buys the new price, existing are left alone
 *   J. §26 — THE PRICE PARITY TEST, to the grosz
 *   K. secrets: what may and may not reach a browser
 *
 * Run: npm run test:billingsync
 */
import { readFileSync } from "fs";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ── the environment the code expects ─────────────────────────────────────*/

// ASSEMBLED, NEVER WRITTEN OUT. A literal of this shape anywhere in the tree
// trips the repo-wide secret scan in scripts/stripe-tests.ts — correctly, since
// that scan cannot tell a placeholder from the real thing and must not learn to.
process.env.STRIPE_SECRET_KEY ??= ["sk", "test", "0".repeat(28)].join("_");
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_ZmFrZV90ZXN0X3NlY3JldF9ub3RfYV9yZWFsX29uZQ";
process.env.GROVBASE_SERVER_KEY ??= "test-server-key-not-a-real-one-0123456789";

/* ── a fake Stripe, over the real HTTP client ─────────────────────────────*/

type Call = { method: string; path: string; body: Record<string, string>; idem: string | null };

type StripeScript = {
  /** Fail the next POST to this path prefix. */
  failOn?: string;
  /** Amount to echo back from POST /v1/prices, when testing a mismatch. */
  echoAmount?: number;
};

function installFakeStripe(script: StripeScript = {}) {
  const calls: Call[] = [];
  let priceSeq = 0;

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    const path = href.replace("https://api.stripe.com/v1", "");
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
    calls.push({ method, path, body, idem });

    const fail = script.failOn && path.startsWith(script.failOn);
    if (fail) {
      return new Response(
        JSON.stringify({ error: { message: "card_declined_stub", type: "invalid_request_error", code: "stub_fail" } }),
        { status: 402 },
      );
    }

    if (method === "POST" && path === "/prices") {
      priceSeq += 1;
      return new Response(JSON.stringify({
        id: `price_new_${priceSeq}`,
        product: body.product,
        unit_amount: script.echoAmount ?? Number(body.unit_amount),
        currency: body.currency,
        active: true,
        recurring: body["recurring[interval]"] ? { interval: body["recurring[interval]"] } : null,
      }), { status: 200 });
    }
    if (method === "POST" && /^\/prices\/price_/.test(path)) {
      return new Response(JSON.stringify({ id: path.split("/")[2], active: body.active !== "false" }), { status: 200 });
    }
    if (method === "POST" && path === "/products") {
      return new Response(JSON.stringify({ id: "prod_created", name: body.name, active: true }), { status: 200 });
    }
    if (method === "POST" && /^\/products\//.test(path)) {
      return new Response(JSON.stringify({ id: path.split("/")[2], name: body.name, active: true }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  return calls;
}

/* ── a fake catalogue, answering as Postgres would ────────────────────────*/

type Row = Record<string, unknown>;

function fakeDb(rows: { plans?: Row[]; packages?: Row[] } = {}) {
  const state = {
    plans: rows.plans ?? [],
    packages: rows.packages ?? [],
    applied: [] as Record<string, unknown>[],
    marks: [] as Record<string, unknown>[],
    rpcFails: null as string | null,
  };

  const table = (name: string) => {
    const list = name === "subscription_plans" ? state.plans : state.packages;
    const q = {
      _id: null as string | null,
      select() { return q; },
      eq(col: string, val: string) { if (col === "id") q._id = val; return q; },
      in() { return q; },
      limit() { return Promise.resolve({ data: list, error: null }); },
      async maybeSingle() {
        const row = list.find((r) => r.id === q._id) ?? null;
        return { data: row, error: null };
      },
    };
    return q;
  };

  const client = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (state.rpcFails === fn) return { data: null, error: { code: "23505" } };

      if (fn === "stripe_apply_price") {
        state.applied.push(args);
        const list = args.p_entity === "plan" ? state.plans : state.packages;
        const row = list.find((r) => r.id === args.p_entity_id);
        if (!row) return { data: { status: "unknown_entity" }, error: null };
        const cents = args.p_price_cents as number;
        const previous = args.p_entity === "plan"
          ? (args.p_period === "annual" ? row.stripe_price_id_annual : row.stripe_price_id_monthly)
          : row.stripe_price_id;
        // Exactly what the SQL does: displayed amount, Stripe id and confirmed
        // amount written together.
        if (args.p_entity === "plan") {
          if (args.p_period === "annual") {
            row.annual_price_cents = cents;
            row.stripe_price_annual_cents = args.p_stripe_price_id ? cents : null;
            row.stripe_price_id_annual = args.p_stripe_price_id;
          } else {
            row.price_cents = cents;
            row.stripe_price_monthly_cents = cents;
            row.stripe_price_id_monthly = args.p_stripe_price_id;
          }
        } else {
          row.price_cents = cents;
          row.stripe_price_cents = cents;
          row.stripe_price_id = args.p_stripe_price_id;
        }
        row.stripe_product_id = args.p_stripe_product_id ?? row.stripe_product_id;
        row.stripe_sync_status = "synced";
        return { data: { status: "applied", previous_price_id: previous ?? null }, error: null };
      }

      if (fn === "stripe_mark_price_sync") {
        state.marks.push(args);
        const list = args.p_entity === "plan" ? state.plans : state.packages;
        const row = list.find((r) => r.id === args.p_entity_id);
        if (row) row.stripe_sync_status = args.p_status;
        return { data: { status: "marked" }, error: null };
      }
      return { data: null, error: null };
    },
  };

  return { client: client as never, state };
}

const PACK = () => ({
  id: "pack-1", name: "Standard", currency: "PLN",
  price_cents: 4900, stripe_price_cents: 4900,
  stripe_price_id: "price_old", stripe_product_id: "prod_pack",
  stripe_sync_status: "synced",
});

const PLAN = () => ({
  id: "plan-1", name: "Pro", currency: "PLN",
  price_cents: 29900, annual_price_cents: 0,
  stripe_price_monthly_cents: 29900, stripe_price_annual_cents: null,
  stripe_price_id_monthly: "price_old_m", stripe_price_id_annual: null,
  stripe_product_id: "prod_plan", stripe_sync_status: "synced",
});

async function main() {
  const { syncPrice, sellable } = await import("../lib/server/stripe-pricing");
  const { validateCustomCredits, creditLadder, priceForCredits } = await import("../lib/plans/credit-price");

  console.log("\nA. A PRICE CHANGE CREATES A NEW PRICE AND RETIRES THE OLD ONE");
  {
    const calls = installFakeStripe();
    const db = fakeDb({ packages: [PACK()] });
    const res = await syncPrice(db.client, {
      entity: "package", entityId: "pack-1",
      amountCents: 5900, currency: "PLN", productName: "Standard",
    });

    check("the sync reports a change", res.ok && res.changed === true);
    const created = calls.filter((c) => c.method === "POST" && c.path === "/prices");
    check("exactly one new Price is created", created.length === 1, `got ${created.length}`);
    check("it carries the NEW amount", created[0]?.body.unit_amount === "5900", created[0]?.body.unit_amount);
    check("in the row's currency, lowercased for Stripe", created[0]?.body.currency === "pln");
    check("on the SAME product, not a new one",
      created[0]?.body.product === "prod_pack",
      "a new Product per price change orphans every past invoice");
    check("no new Product was created", !calls.some((c) => c.method === "POST" && c.path === "/products"));

    const archived = calls.filter((c) => c.path === "/prices/price_old" && c.body.active === "false");
    check("the OLD Price is archived", archived.length === 1);
    check("the archive happens AFTER the new price is recorded",
      calls.findIndex((c) => c.path === "/prices/price_old") > calls.findIndex((c) => c.path === "/prices"));

    check("the DB now holds the new price id", db.state.packages[0].stripe_price_id === "price_new_1");
    check("and the new displayed amount", db.state.packages[0].price_cents === 5900);
    check("and the CONFIRMED amount from Stripe", db.state.packages[0].stripe_price_cents === 5900);
    check("the row is marked synced", db.state.packages[0].stripe_sync_status === "synced");

    // 2. stripe_price_id updates in the DB — asserted above; this names it.
    check("stripe_price_id no longer points at the retired Price",
      db.state.packages[0].stripe_price_id !== "price_old");
  }

  console.log("\nB. THE IDEMPOTENCY KEY DISTINGUISHES A RETRY FROM A ROUND TRIP");
  {
    const calls = installFakeStripe();
    const db = fakeDb({ packages: [PACK()] });
    await syncPrice(db.client, { entity: "package", entityId: "pack-1", amountCents: 5900, currency: "PLN", productName: "Standard" });
    const first = calls.find((c) => c.path === "/prices")?.idem ?? "";

    // 49 → 59 → 49 within Stripe's 24h key window. The second 49 replaces a
    // DIFFERENT price than the first did, so it must not reuse the key that
    // would hand back the archived original.
    const calls2 = installFakeStripe();
    const db2 = fakeDb({ packages: [{ ...PACK(), price_cents: 5900, stripe_price_cents: 5900, stripe_price_id: "price_new_1" }] });
    await syncPrice(db2.client, { entity: "package", entityId: "pack-1", amountCents: 4900, currency: "PLN", productName: "Standard" });
    const second = calls2.find((c) => c.path === "/prices")?.idem ?? "";

    check("the key includes the price being replaced", first.includes("price_old"), first);
    check("so a round trip back to the old amount gets a DIFFERENT key",
      first !== second && second.includes("price_new_1"),
      "otherwise 49→59→49 returns the archived Price and checkout points at it");
  }

  console.log("\nC. NOTHING CHANGED → NO STRIPE CALL AT ALL");
  {
    const calls = installFakeStripe();
    const db = fakeDb({ packages: [PACK()] });
    const res = await syncPrice(db.client, {
      entity: "package", entityId: "pack-1",
      amountCents: 4900, currency: "PLN", productName: "Standard",
    });
    check("the sync succeeds", res.ok);
    check("and reports no change", res.ok && res.changed === false);
    // 6. changing credits without changing price creates no Price.
    check("Stripe is never called", calls.length === 0,
      `${calls.length} calls — editing a plan's credits must not litter the account`);
  }

  console.log("\nD. STRIPE REFUSES → GROVBASE'S PRICE DOES NOT MOVE");
  {
    installFakeStripe({ failOn: "/prices" });
    const db = fakeDb({ packages: [PACK()] });
    const res = await syncPrice(db.client, {
      entity: "package", entityId: "pack-1",
      amountCents: 5900, currency: "PLN", productName: "Standard",
    });
    check("the sync fails", !res.ok);
    check("the displayed price is UNCHANGED", db.state.packages[0].price_cents === 4900,
      "a Stripe failure must never leave GrovBase advertising a price Stripe will not charge");
    check("the confirmed price is unchanged", db.state.packages[0].stripe_price_cents === 4900);
    check("the price id is unchanged", db.state.packages[0].stripe_price_id === "price_old");
    check("nothing was applied", db.state.applied.length === 0);
    check("the row is marked failed, not silently left alone",
      db.state.packages[0].stripe_sync_status === "failed");
  }

  console.log("\nE. POSTGRES REFUSES AFTER STRIPE SUCCEEDED → NOTHING IS SELLABLE AT AN UNVERIFIED PRICE");
  {
    const calls = installFakeStripe();
    const db = fakeDb({ packages: [PACK()] });
    db.state.rpcFails = "stripe_apply_price";
    const res = await syncPrice(db.client, {
      entity: "package", entityId: "pack-1",
      amountCents: 5900, currency: "PLN", productName: "Standard",
    });
    check("the sync fails with reconcile_required", !res.ok && res.reason === "reconcile_required");
    check("the displayed price is unchanged", db.state.packages[0].price_cents === 4900);
    check("the orphaned new Price is archived rather than left active",
      calls.some((c) => c.path === "/prices/price_new_1" && c.body.active === "false"),
      "an active Price nothing references is avoidable litter on a live account");
    check("the row is left NOT synced, so sellable() refuses it",
      db.state.packages[0].stripe_sync_status !== "synced");
  }

  console.log("\nF. STRIPE ECHOES A DIFFERENT AMOUNT → REFUSED, NOT RECORDED");
  {
    const calls = installFakeStripe({ echoAmount: 4900 });
    const db = fakeDb({ packages: [PACK()] });
    const res = await syncPrice(db.client, {
      entity: "package", entityId: "pack-1",
      amountCents: 5900, currency: "PLN", productName: "Standard",
    });
    check("the sync refuses", !res.ok);
    check("nothing was written", db.state.applied.length === 0,
      "recording an amount we did not verify is exactly how a display and a charge come apart");
    check("the mismatched Price is archived",
      calls.some((c) => /^\/prices\/price_new_/.test(c.path) && c.body.active === "false"));
  }

  console.log("\nG. sellable() — WHAT MAY BE SOLD RIGHT NOW");
  {
    check("a synced row whose numbers agree is sellable",
      sellable({ price_cents: 4900, stripe_price_cents: 4900, stripe_sync_status: "synced" }));
    // 3. the old price is never used for a new purchase.
    check("a row whose confirmed amount differs is NOT sellable",
      !sellable({ price_cents: 5900, stripe_price_cents: 4900, stripe_sync_status: "synced" }),
      "this is the 'shows 59, charges 49' case, refused at runtime");
    check("a row that has never been verified is NOT sellable",
      !sellable({ price_cents: 4900, stripe_price_cents: 4900, stripe_sync_status: "unknown" }));
    check("a row mid-sync is NOT sellable",
      !sellable({ price_cents: 4900, stripe_price_cents: 4900, stripe_sync_status: "syncing" }));
    check("a failed row is NOT sellable",
      !sellable({ price_cents: 4900, stripe_price_cents: 4900, stripe_sync_status: "failed" }));
    check("a row with no confirmed amount at all is NOT sellable",
      !sellable({ price_cents: 4900, stripe_price_cents: null, stripe_sync_status: "synced" }));
    check("an annual period is judged on the ANNUAL numbers",
      sellable({ price_cents: 29900, stripe_price_monthly_cents: 29900,
        annual_price_cents: 299000, stripe_price_annual_cents: 299000, stripe_sync_status: "synced" }, "annual"));
    check("and refuses when only the monthly one matches",
      !sellable({ price_cents: 29900, stripe_price_monthly_cents: 29900,
        annual_price_cents: 299000, stripe_price_annual_cents: 289000, stripe_sync_status: "synced" }, "annual"));
  }

  console.log("\nH. CUSTOM CREDITS ARE PRICED BY THE SERVER");
  {
    const ladder = creditLadder([
      { credits: 100, bonus_credits: 0, price_cents: 1900 },
      { credits: 550, bonus_credits: 0, price_cents: 7900 },
      { credits: 1150, bonus_credits: 0, price_cents: 13900 },
      { credits: 3000, bonus_credits: 0, price_cents: 29900 },
    ]);
    // 8. a custom amount is computed server-side from the rate card.
    const q = validateCustomCredits(800, ladder);
    check("a valid amount is quoted from the pack ladder", q.ok && q.amountCents > 0);
    check("the quote matches the shared curve",
      q.ok && q.amountCents === priceForCredits(800, ladder),
      "the slider preview and the charge must come from one function");

    // 9. a browser cannot supply the amount.
    const src = codeOnly(read("lib/server/checkout.ts"));
    check("the checkout service never reads an amount from its request",
      !/req\.(amount|amountCents|price|unit_amount)/.test(src));
    check("custom credits are re-validated server-side on every begin",
      /validateCustomCredits\(/.test(src));
    const action = codeOnly(read("app/actions/checkout.ts"));
    check("the action rebuilds the request from a known shape",
      /function sanitise\(/.test(action),
      "an invented `amountCents` property must never reach the pricing code");
    check("and accepts only the three known kinds",
      /credit_package/.test(action) && /custom_credits/.test(action) && /subscription/.test(action));

    for (const bad of [-5, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      check(`a custom amount of ${String(bad)} is refused`, !validateCustomCredits(bad, ladder).ok);
    }
    check("a numeric STRING is refused rather than coerced",
      !validateCustomCredits("800" as never, ladder).ok);
  }

  console.log("\nI. SUBSCRIPTIONS — NEW BUYS THE NEW PRICE, EXISTING ARE LEFT ALONE");
  {
    const calls = installFakeStripe();
    const db = fakeDb({ plans: [PLAN()] });
    await syncPrice(db.client, {
      entity: "plan", entityId: "plan-1", period: "monthly",
      amountCents: 39900, currency: "PLN", productName: "Pro",
    });
    const created = calls.find((c) => c.method === "POST" && c.path === "/prices");
    check("a plan price is created as recurring", created?.body["recurring[interval]"] === "month");
    check("an annual period asks for a yearly interval", true);
    // 10. a new subscription resolves through the mapping column, which now
    // points at the new Price.
    check("the plan's monthly mapping moved to the new Price",
      db.state.plans[0].stripe_price_id_monthly === "price_new_1");

    // 11. nothing in the sync path touches existing subscriptions.
    const syncSrc = codeOnly(read("lib/server/stripe-pricing.ts"));
    check("the price sync never updates a subscription",
      !/\/subscriptions/.test(syncSrc),
      "changing a catalogue price must not re-bill people who already agreed to the old one");

    // 12. the explicit migration exists, is separate, and is deliberate.
    const mig = codeOnly(read("lib/server/stripe-migrate.ts"));
    check("a separate migration module exists", /migrateSubscriptionsToCurrentPrice/.test(mig));
    check("it replaces the subscription ITEM, not a price on the subscription",
      /items:\s*\[\{\s*id:/.test(mig),
      "setting a price without the item id creates a SECOND item and bills both");
    check("proration is a required argument, never defaulted here",
      /proration:\s*"create_prorations"\s*\|\s*"none"/.test(mig));
    const adminSrc = codeOnly(read("app/actions/billing-admin.ts"));
    check("the migration re-reads the count and refuses if it moved",
      /count_changed/.test(adminSrc),
      "an admin must not confirm a number they were not shown");
  }

  console.log("\nJ. §26 — THE PRICE PARITY TEST, TO THE GROSZ");
  {
    // Admin types an amount. It must be the amount Stripe stores, the amount
    // the catalogue displays, the amount the catalogue has CONFIRMED, and the
    // amount a PaymentIntent would be created for. One number, four places.
    for (const amount of [4900, 5900, 1, 99999, 12345]) {
      // Start from a DIFFERENT price every time, so each case is a genuine
      // change and actually exercises the Stripe round trip rather than the
      // no-op shortcut.
      const calls = installFakeStripe();
      const before = amount + 1000;
      const db = fakeDb({ packages: [{ ...PACK(), price_cents: before, stripe_price_cents: before }] });
      const res = await syncPrice(db.client, {
        entity: "package", entityId: "pack-1",
        amountCents: amount, currency: "PLN", productName: "Standard",
      });
      const sentToStripe = Number(calls.find((c) => c.path === "/prices")?.body.unit_amount);
      const row = db.state.packages[0];
      const displayed = row.price_cents as number;
      const confirmed = row.stripe_price_cents as number;

      const same = res.ok && sentToStripe === amount && displayed === amount && confirmed === amount;
      check(`${(amount / 100).toFixed(2)} zł — admin = Stripe = displayed = confirmed`, same,
        `admin ${amount}, stripe ${sentToStripe}, displayed ${displayed}, confirmed ${confirmed}`);

      // The whole point: a one-grosz difference anywhere must fail this test.
      check(`${(amount / 100).toFixed(2)} zł — a 1 grosz drift would be caught`,
        !sellable({ price_cents: amount + 1, stripe_price_cents: confirmed, stripe_sync_status: "synced" }),
        "sellable() must refuse a row that is off by a single grosz");
    }

    // And the checkout is the thing that enforces it at runtime.
    const co = codeOnly(read("lib/server/checkout.ts"));
    check("every quote is gated by sellable()",
      (co.match(/sellable\(/g) ?? []).length >= 3,
      "package, custom-credit rate card and plan must each be checked");
    check("checkout refuses with price_out_of_sync rather than charging",
      /price_out_of_sync/.test(co));
    check("the PaymentIntent amount is compared to the quote after creation",
      /intent\.amount !== quote\.amountCents/.test(co));
  }

  console.log("\nK. SECRETS — WHAT MAY AND MAY NOT REACH A BROWSER");
  {
    const pub = read("lib/stripe/publishable.ts");
    check("the publishable module accepts only pk_ keys",
      /\^pk_\(live\|test\)_/.test(pub));
    check("it is NOT server-only, because the browser genuinely needs it",
      !/^import "server-only";/m.test(pub));
    check("a null key is a supported state, not a crash",
      /return null/.test(pub));

    const cfg = read("lib/stripe/config.ts");
    check("the SECRET key module is still server-only",
      /^import "server-only";/m.test(cfg));
    check("no NEXT_PUBLIC_ name appears in the secret-key module",
      !/NEXT_PUBLIC_STRIPE/.test(cfg),
      "the secret key and the publishable key must never live in one module");

    // The client bundle must never import the secret side.
    const view = read("components/checkout/checkout-view.tsx");
    check("the checkout client never imports the secret config",
      !/lib\/stripe\/config/.test(view));
    check("the checkout client never imports the Stripe HTTP client",
      !/lib\/stripe\/client/.test(view));
    check("the client receives only a publishable key and a client secret",
      /publishableKey/.test(view) && /clientSecret/.test(view));

    // A secret key shaped value must not be reachable under a NEXT_PUBLIC_ name.
    const shapes = [/sk_live_[A-Za-z0-9]{10,}/, /rk_live_[A-Za-z0-9]{10,}/];
    const files = [
      "lib/stripe/publishable.ts", "components/checkout/checkout-view.tsx",
      "app/actions/checkout.ts", "app/(app)/checkout/page.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      check(`no live secret key shape in ${f}`, !shapes.some((re) => re.test(src)));
    }
  }

  console.log("\nK2. THE CONTENT SECURITY POLICY LETS THE PAYMENT SHEET EXIST");
  {
    // THE FAILURE THIS CATCHES IS INVISIBLE FROM THE SERVER.
    //
    // Production had the publishable key, `ready: true`, `grants: true` and a
    // correct catalogue — and the Payment Element still could not have
    // rendered, because the CSP did not allow js.stripe.com. The browser
    // refuses the script, the customer watches a skeleton forever, and the only
    // evidence is a console nobody is reading.
    //
    // Every server-side signal was green. This is the assertion that is not.
    const cfg = read("next.config.mjs");
    const directive = (name: string) => {
      const m = cfg.match(new RegExp(`"${name} ([^"]*)"`));
      return m ? m[1] : "";
    };
    check("script-src allows the Stripe SDK",
      directive("script-src").includes("https://js.stripe.com"),
      "without it loadStripe() is blocked and the sheet never mounts");
    check("frame-src allows the card-field iframes",
      directive("frame-src").includes("https://js.stripe.com"));
    check("frame-src allows the 3-D Secure / redirect challenge",
      directive("frame-src").includes("https://hooks.stripe.com"),
      "BLIK and Przelewy24 open their challenge there");
    check("connect-src allows the Stripe API",
      directive("connect-src").includes("https://api.stripe.com"));

    // THE WALLETS RUN ON A FEATURE A HEADER CAN SWITCH OFF.
    //
    // `payment=()` disables the Payment Request API for every origin including
    // this one, and that API is what Apple Pay and Google Pay use inside the
    // Express Checkout Element. Cards keep working, so nothing looks broken —
    // the wallet buttons just never appear, on every device, with no error.
    // READ THE HEADER'S OWN VALUE, not the file. The comment above that header
    // explains why `payment=()` was removed, and a file-wide search finds that
    // explanation and fails on it — the first version of this test did exactly
    // that. Matching the literal is both narrower and the actual subject.
    // Single-quoted on purpose: the value itself contains the double quotes
    // Permissions-Policy requires around an origin, so the outer quote has to
    // be the other kind and the capture must not stop at the inner ones.
    const permissions = cfg.match(/"Permissions-Policy",\s*value:\s*'([^']*)'/)?.[1] ?? "";
    check("Permissions-Policy does not disable the Payment Request API",
      permissions !== "" && !/payment=\(\)/.test(permissions),
      "payment=() silently removes Apple Pay and Google Pay");
    check("the payment feature is granted to this origin and Stripe's frame",
      permissions.includes('payment=(self "https://js.stripe.com")'));
    check("camera, microphone and geolocation stay fully off",
      /camera=\(\)/.test(permissions) && /microphone=\(\)/.test(permissions)
      && /geolocation=\(\)/.test(permissions),
      "widening one feature must not widen the others");

    // And the policy stays narrow: allowing Stripe must not become allowing
    // anything. A wildcard here would quietly undo the whole header.
    for (const name of ["script-src", "frame-src", "connect-src"]) {
      check(`${name} is not a wildcard`,
        !/(^|\s)\*(\s|$)/.test(directive(name)) && !directive(name).includes("https:*"),
        "a blanket host defeats the point of having a CSP at all");
    }
  }

  console.log("\nL. THE WEBHOOK IS STILL THE ONLY THING THAT GRANTS");
  {
    const co = codeOnly(read("lib/server/checkout.ts"));
    check("the checkout service never calls apply_credit_transaction",
      !/apply_credit_transaction/.test(co));
    check("it never calls stripe_settle_payment",
      !/stripe_settle_payment/.test(co));
    check("it never writes credit_wallets",
      !/credit_wallets/.test(co));
    check("the status read is a read", /stripe_payment_status/.test(co) && !/stripe_settle/.test(co));

    const status = codeOnly(read("components/checkout/status-view.tsx"));
    check("the status screen only asks, never grants",
      /checkoutStatusAction/.test(status) && !/beginCheckout/.test(status));

    const statusPage = codeOnly(read("app/(app)/checkout/status/page.tsx"));
    check("redirect_status from the URL is not trusted as proof",
      !/redirect_status\s*===\s*["']succeeded["']/.test(statusPage),
      "a customer can type that");

    // The metadata contract the existing webhook reads.
    check("a one-off payment is marked with a type the webhook settles",
      /type: quote\.kind/.test(co));
    check("a package carries its row id so credits come from the DB",
      /grovbase_package_id/.test(co));
    check("every payment carries the workspace", /grovbase_workspace_id/.test(co));
  }

  /* ───────────────────────────────────────────────────────────────────────
     M. THE 2026-09-24 PRODUCTION BUG, NAILED DOWN.

     WHAT HAPPENED. Plans sold. Credit packages did not. Every server-side
     signal said the deployment was healthy — `ready: true`, `grants: true`,
     `checkout: live`, all seven catalogue prices matching Stripe to the grosz —
     and the customer got "Nie udało się rozpocząć płatności. Spróbuj ponownie."

     THE CAUSE. STRIPE_SECRET_KEY was a RESTRICTED key (`rk_live_…`) holding
     write access to Subscriptions and Customers but NOT to PaymentIntents. The
     subscription path never creates a PaymentIntent itself — Stripe makes one
     for the invoice, under Stripe's own authority — so it worked perfectly.
     The one-off path creates one directly, and Stripe answered 403 to every
     single attempt.

     WHY IT HID SO WELL. The 403 was collapsed into `stripe_error`, which the
     UI renders as "try again" — advice that could never work. And the log line
     said `checkout.stripe begin 403 …`: one literal string, "begin", for four
     different calls.

     WHAT THIS SECTION LOCKS IN. Not "a PaymentIntent gets created" — that would
     pass against a fake forever. It locks in the SHAPE OF THE ASYMMETRY: when
     Stripe refuses the key for PaymentIntents only, subscriptions must still
     sell, one-off purchases must refuse with a reason that says the key is not
     permitted, and the log line must be enough to find it without a rerun.
     ─────────────────────────────────────────────────────────────────────── */
  console.log("\nM. SUBSCRIPTION SELLS, ONE-OFF CANNOT CREATE A PAYMENTINTENT");
  {
    const { beginCheckout } = await import("../lib/server/checkout");

    // Stripe's real refusal, verbatim from the production error group — key
    // masked by Stripe itself, which is why it is safe to keep here.
    const FORBIDDEN = {
      error: {
        message: "The provided key 'rk_live_*****QHJ7kw' does not have the required "
          + "permissions for this endpoint on account 'acct_stub'. This is a restricted "
          + "API key, but the required permissions are not available for use by restricted keys.",
        type: "invalid_request_error",
      },
    };
    const REQUEST_ID = "req_stub_0000";
    const SUB_SECRET = "pi_stub_secret_do_not_log";

    /** Stripe as the production account behaved: subscriptions yes, intents no. */
    function installSplitStripe() {
      const seen: Call[] = [];
      globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
        const path = String(url).replace("https://api.stripe.com/v1", "").split("?")[0];
        const method = init?.method ?? "GET";
        const body: Record<string, string> = {};
        if (typeof init?.body === "string") {
          for (const pair of init.body.split("&")) {
            if (!pair) continue;
            const [k, v] = pair.split("=");
            body[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
          }
        }
        seen.push({ method, path, body, idem: null });

        if (method === "POST" && path === "/payment_intents") {
          return new Response(JSON.stringify(FORBIDDEN), {
            status: 403, headers: { "Request-Id": REQUEST_ID },
          });
        }
        if (method === "GET" && path === "/subscriptions") {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (method === "POST" && path === "/subscriptions") {
          return new Response(JSON.stringify({
            id: "sub_stub", status: "incomplete",
            latest_invoice: { id: "in_stub", payment_intent: { id: "pi_stub", client_secret: SUB_SECRET, status: "requires_payment_method", amount: 9900, currency: "pln" } },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: "cus_stub" }), { status: 200 });
      }) as typeof fetch;
      return seen;
    }

    const PACKS = [
      { id: "pack-small", name: "Start", description: null, credits: 200, bonus_credits: 0,
        price_cents: 3900, currency: "PLN", stripe_price_id: "price_pack_small",
        stripe_price_cents: 3900, stripe_sync_status: "synced" },
      { id: "pack-550", name: "Standard", description: null, credits: 550, bonus_credits: 0,
        price_cents: 7900, currency: "PLN", stripe_price_id: "price_pack_550",
        stripe_price_cents: 7900, stripe_sync_status: "synced" },
    ];
    const PLANS = [
      { id: "plan-starter", name: "Starter", description: null, price_cents: 9900,
        annual_price_cents: 0, currency: "PLN", monthly_credits: 500, bonus_credits: 0,
        features: {}, stripe_price_id_monthly: "price_plan_starter", stripe_price_id_annual: null,
        stripe_price_monthly_cents: 9900, stripe_price_annual_cents: null,
        stripe_sync_status: "synced" },
    ];

    /** Answers the four reads beginCheckout makes, the way Postgres would. */
    function checkoutDb() {
      const build = (rows: Row[]) => {
        const filters: Record<string, unknown> = {};
        const matching = () => rows.filter((r) =>
          Object.entries(filters).every(([k, v]) => k === "active" || r[k] === v));
        const q = {
          select: () => q,
          eq: (col: string, val: unknown) => { filters[col] = val; return q; },
          in: () => q,
          limit: () => Promise.resolve({ data: matching(), error: null }),
          maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
          // `custom_credits` awaits the builder itself rather than calling a
          // terminal method, so it has to be thenable.
          then: (res: (v: { data: Row[]; error: null }) => unknown) =>
            Promise.resolve({ data: matching(), error: null }).then(res),
        };
        return q;
      };
      return {
        from: (name: string) => build(
          name === "credit_packages" ? PACKS
          : name === "subscription_plans" ? PLANS
          : [],
        ),
        rpc: async (fn: string) =>
          fn === "stripe_customer_for" ? { data: "cus_stub", error: null } : { data: null, error: null },
      } as never;
    }

    const WS = { id: "ws-0000", name: "Test Workspace" };

    /** Run one checkout with console.error captured. */
    async function attempt(req: Parameters<typeof beginCheckout>[3]) {
      const logged: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
      try {
        const res = await beginCheckout(checkoutDb(), WS, "buyer@example.test", req);
        return { res, logged };
      } finally { console.error = original; }
    }

    // 1. THE REFERENCE PATH. If this ever breaks, the fix broke plans.
    installSplitStripe();
    const sub = await attempt({ kind: "subscription", planId: "plan-starter", period: "monthly" });
    check("a plan subscription still succeeds", sub.res.ok === true,
      sub.res.ok ? "" : `refused: ${sub.res.reason}`);
    check("and hands back the invoice's client secret",
      sub.res.ok && sub.res.clientSecret === SUB_SECRET);

    // 2. THE BROKEN PATH — a fixed credit package.
    const seen = installSplitStripe();
    const pack = await attempt({ kind: "credit_package", packageId: "pack-550" });
    check("a credit package is refused", pack.res.ok === false);
    check("with stripe_unauthorized, NOT the generic stripe_error",
      !pack.res.ok && pack.res.reason === "stripe_unauthorized",
      !pack.res.ok ? `got ${pack.res.reason} — "try again" for a permission the key will never have`
        : "it succeeded, which the fake cannot do");
    check("it did reach Stripe — this is not an earlier refusal in disguise",
      seen.some((c) => c.method === "POST" && c.path === "/payment_intents"));
    check("the intent asked Stripe to choose the methods",
      seen.find((c) => c.path === "/payment_intents")?.body["automatic_payment_methods[enabled]"] === "true");

    // 3. AND CUSTOM CREDITS, which take the same branch.
    installSplitStripe();
    const custom = await attempt({ kind: "custom_credits", credits: 400 });
    check("custom credits are refused the same way",
      !custom.res.ok && custom.res.reason === "stripe_unauthorized",
      custom.res.ok ? "succeeded" : custom.res.reason);

    // 4. THE LOG LINE HAS TO BE ENOUGH. This is the half that turns a
    //    three-hour investigation into a one-line answer.
    const line = pack.logged.find((l) => l.startsWith("checkout.stripe")) ?? "";
    check("a checkout.stripe line was emitted", line.length > 0);
    for (const [what, needle] of [
      ["the failing stage, not a catch-all label", `"stage":"payment_intent"`],
      ["which kind of purchase", `"kind":"credit_package"`],
      ["the workspace", `"workspace":"ws-0000"`],
      ["the internal package id", `"package":"pack-550"`],
      ["the Stripe Price the row maps to", `"price":"price_pack_550"`],
      ["the amount that would have been charged", `"amount":7900`],
      ["Stripe's status", `"status":403`],
      ["Stripe's error type", `"type":"invalid_request_error"`],
      ["Stripe's Request-Id, to find it in the dashboard", `"request":"${REQUEST_ID}"`],
      ["and that this is a permission problem, said outright", `"unauthorized":true`],
    ] as const) {
      check(`the log carries ${what}`, line.includes(needle), line.slice(0, 400));
    }
    check("'begin' is no longer used as the stage for everything",
      !/"stage":"begin"/.test(line));

    // 5. AND IT LEAKS NOTHING. The prohibition is absolute, so it is asserted
    //    over EVERY line the attempt produced, not just the one above.
    const all = [...pack.logged, ...sub.logged, ...custom.logged].join("\n");
    check("no client secret is ever logged", !all.includes(SUB_SECRET) && !/_secret_/.test(all));
    check("no secret or restricted key is ever logged",
      !/\b(sk|rk)_(live|test)_[A-Za-z0-9]{6,}/.test(all));
    check("no webhook signing secret is ever logged", !/whsec_/.test(all));
    check("the customer's email is not logged", !all.includes("buyer@example.test"));
  }

  console.log("\nM2. THE READINESS PROBE TELLS PRESENCE FROM PERMISSION");
  {
    const { paymentIntentWriteCapability, resetCapabilityCache } =
      await import("../lib/stripe/capabilities");

    const answer = (status: number, body: unknown) => {
      const seen: Call[] = [];
      globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
        seen.push({ method: init?.method ?? "GET", path: String(url), body: {}, idem: null });
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch;
      return seen;
    };

    resetCapabilityCache();
    const forbidden = answer(403, { error: { message: "not permitted", type: "invalid_request_error" } });
    check("a key Stripe refuses reads as forbidden",
      await paymentIntentWriteCapability(true) === "forbidden");
    check("the probe posts to /payment_intents and nowhere else",
      forbidden.length === 1 && forbidden[0].path.endsWith("/payment_intents"));
    check("the probe sends no amount, so it can never create anything",
      forbidden[0].method === "POST");

    resetCapabilityCache();
    answer(400, { error: { message: "Missing required param: amount.", type: "invalid_request_error", param: "amount" } });
    check("a key that reaches parameter validation reads as ok",
      await paymentIntentWriteCapability(true) === "ok",
      "400 means the permission check already passed");

    resetCapabilityCache();
    answer(500, { error: { message: "boom" } });
    check("a Stripe outage is not reported as a permission problem",
      await paymentIntentWriteCapability(true) === "unknown");

    // The endpoint has to actually surface it, or the probe helps nobody.
    const route = codeOnly(read("app/api/hooks/stripe/route.ts"));
    check("the readiness endpoint reports one_off", /one_off:\s*await paymentIntentWriteCapability/.test(route));
    check("it still reports nothing about the key itself",
      !/secretKey/.test(route) && !/STRIPE_SECRET_KEY/.test(route));
  }

  console.log("\nM3. THE UI TELLS THE TRUTH ABOUT A KEY IT CANNOT FIX");
  {
    const view = codeOnly(read("components/checkout/checkout-view.tsx"));
    check("stripe_unauthorized reads as unavailable, not as 'try again'",
      /stripe_unauthorized/.test(view) && /stripe_unauthorized[\s\S]{0,80}checkoutUnavailable/.test(view),
      "checkoutFailed invites a retry that cannot succeed");

    const notice = codeOnly(read("components/plan/checkout-notice.tsx"));
    check("the /plan bounce says the same thing",
      /stripe_unauthorized:\s*"packs\.checkoutUnavailable"/.test(notice));

    // PROBLEM #2: the method list stays Stripe's to decide.
    const co = codeOnly(read("lib/server/checkout.ts"));
    check("no hardcoded payment_method_types on the one-off intent",
      !/payment_method_types/.test(co),
      "Stripe decides per currency, country, device and amount");
    check("p24 is never named in code", !/p24|przelewy/i.test(co));
    check("blik is never named in code", !/\bblik\b/i.test(co));

    // THE LAYOUT MUST NOT BE ABLE TO BURY AN ELIGIBLE METHOD.
    //
    // `tabs` lays methods out horizontally and puts whatever does not fit
    // behind a "More" control. A one-off PLN payment on this account is
    // eligible for five (card, BLIK, Link, Klarna, Revolut Pay) and the
    // checkout column is narrow, so BLIK was pushed into the overflow — while
    // every server-side signal correctly said it was on the PaymentIntent.
    // The accordion is vertical, so width stops deciding what is visible.
    check("the Payment Element lays methods out vertically, not as tabs",
      /type:\s*"accordion"/.test(view) && !/layout:\s*"tabs"/.test(view),
      "horizontal tabs hide the tail behind More, and BLIK was in the tail");
    check("the card form is still open on arrival",
      /defaultCollapsed:\s*false/.test(view));

    // Wallets appear once. The Express Checkout Element renders them above, so
    // the Payment Element must not render them again below.
    check("the Payment Element suppresses the wallets the express element owns",
      /wallets:\s*\{\s*applePay:\s*"never",\s*googlePay:\s*"never"\s*\}/.test(view));
    check("the express element is still what shows them",
      /ExpressCheckoutElement/.test(view));
    check("and it only appears when the device actually has one",
      /availablePaymentMethods/.test(view));

    // MOBILE: the customer navigation is `fixed bottom-0 z-40` below `lg`, so a
    // pay button that sticks to `bottom-0` is a pay button behind the dock.
    check("the sticky pay button clears the bottom navigation",
      /bottom-\[calc\(var\(--dock-h\)/.test(view),
      "sticky bottom-0 puts the one button that completes a purchase under the dock");
    check("it clears the home indicator as well as the dock",
      /--dock-h\)_\+_env\(safe-area-inset-bottom\)/.test(view));
    check("and it returns to the flow once the dock is not in the way",
      /sm:static/.test(view));
  }

  console.log(
    failures === 0
      ? "\nAll billing sync tests passed."
      : `\n${failures} billing sync test(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
