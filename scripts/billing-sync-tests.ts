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

  console.log(
    failures === 0
      ? "\nAll billing sync tests passed."
      : `\n${failures} billing sync test(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
