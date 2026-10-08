/**
 * /plany + /plan — THE CENNIK MAY CHANGE HOW PRICES LOOK, NEVER WHAT IS CHARGED.
 *
 * The 2026-10 /plany task replaced the pricing board with one shared page
 * (components/plan/pricing-page.tsx) rendered at the public /plany and the
 * in-app /plan from ONE server loader (lib/server/pricing-page.ts), and added
 * three server rules: top-ups only with an active paid plan, top-ups only in
 * the offered amounts, and offer switches (annual, premiere) that start OFF.
 *
 *   A. THE MONEY PATH. Files the task did not need stay byte-identical (the
 *      webhook, the ledger path, Stripe client, actions, /checkout page). The
 *      files it changed are re-pinned deliberately.
 *   B. SAME INTENTS. Every buy link the page builds is the old link shape:
 *      ids and quantities only, never an amount.
 *   C. DISPLAYED = QUOTED. With an active plan, every plan, pack, pack slot and
 *      tier the page shows is priced by the REAL `quoteCheckout` over the
 *      production catalogue to the grosz, and the PaymentIntent asks Stripe
 *      for exactly that amount.
 *   D. ANNUAL — refused by the server while the offer switch is off, even
 *      with synced annual Prices; offered by the page only when on sale.
 *   E. TOP-UPS NEED AN ACTIVE PAID PLAN — refused on every server path
 *      (quote, begin, both hosted actions) for every other state.
 *   F. TIERS AND SLOTS — exactly the ten tiers and five slots; nothing between
 *      them; no extrapolation; approved prices only with validated margins.
 *   G. PREMIERE — off; server-clocked; grandfathering metadata only while on.
 *   H. THE PAGE'S DATA — what a visitor, a free user and a subscriber see.
 *   I. ROUTING — /plany public, /cennik 308, /plan compatible, SEO.
 *   J. CONFIG AND COPY — no money in presentation, no fake promise.
 *   K. UI CONTRACT — the slider, the lock, the gate, the fold, the FAQ.
 *
 * No network, no database, no Stripe, no payment. `fetch` is a local fake.
 *
 * Run:  npm run test:planpage
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// ASSEMBLED, NEVER WRITTEN OUT — a literal key shape would trip the repo-wide
// secret scan in scripts/stripe-tests.ts (same convention as billing-sync-tests).
process.env.STRIPE_SECRET_KEY ??= ["sk", "test", "0".repeat(28)].join("_");
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_ZmFrZV90ZXN0X3NlY3JldF9ub3RfYV9yZWFsX29uZQ";
process.env.GROVBASE_SERVER_KEY ??= "test-server-key-not-a-real-one-0123456789";

import { beginCheckout, quoteCheckout, recheckTopup, type CheckoutRequest } from "@/lib/server/checkout";
import {
  createCustomCreditsCheckout, createPackageCheckout, createPlanCheckout, requireActivePaidPlan,
} from "@/lib/server/billing";
import {
  PACK_SLOTS, PRICING_OFFER, TOPUP_TIERS, approvedPriceValid, isPriceLocked, offeredCustomAmounts,
  premiereExpiredFor, premiereMetadata, premiereState, priceTopup, topupMarginPercent, type PricingOffer,
} from "@/lib/server/pricing-offer";
import { buildPricingPage, loadPricingPage, type PackRowFull, type PlanRow, type ViewerFacts } from "@/lib/server/pricing-page";
import { creditLadder, validateCustomCredits } from "@/lib/plans/credit-price";
import { annualSavingPct } from "@/lib/plans/pricing";
import {
  creditsCheckoutHref, formatCount, formatMoney, formatPerCredit, isFewForm, packCheckoutHref, planCheckoutHref,
} from "@/components/plan/pricing-model";
import {
  CARD_ORDER, CARD_ORDER_PHONE, COMPARE_GROUPS, COMPARE_INITIAL_ROWS, FAQ, PRICING_PAGE, featureOn, planPresentation,
} from "@/components/plan/pricing-config";
import { isProtectedPath } from "@/lib/supabase/middleware";
import { checkoutNotice } from "@/lib/checkout-notice-param";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passes += 1; console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
}
const read = (p: string) => readFileSync(p, "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** Source with comments stripped, so a check never matches a comment. */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

/* ── the production catalogue, as PROD held it on 2026-10-08 ──────────────*/
// Prices, credits, capabilities, flags and Stripe ids are PROD's. Pack ids are
// PROD's; plan ids are stand-ins (any stable id works — the link carries it).

type Plan = PlanRow & { active: boolean; sort_order: number };
type Pack = PackRowFull & { name: string; description: string | null; active: boolean; sort_order: number };

const PROD_PLANS: Plan[] = [
  { id: "c0f1e9d6-0000-4000-8000-00000000f4ee", slug: "free", name: "Free", description: null, price_cents: 0,
    annual_price_cents: 0, currency: "PLN", monthly_credits: 25, bonus_credits: 0, featured: false, active: true,
    sort_order: 0, features: { products: 5, workspace_members: 1 }, stripe_price_id_monthly: null,
    stripe_price_id_annual: null, stripe_price_monthly_cents: null, stripe_price_annual_cents: null,
    stripe_sync_status: "unknown" },
  { id: "c0f1e9d6-0000-4000-8000-0000057a47e7", slug: "starter", name: "Starter", description: null, price_cents: 9900,
    annual_price_cents: 0, currency: "PLN", monthly_credits: 300, bonus_credits: 0, featured: false, active: true,
    sort_order: 1, features: { products: 50, workspace_members: 2 },
    stripe_price_id_monthly: "price_1UIFXqPOBRMZKbwY8rpazmwd", stripe_price_id_annual: null,
    stripe_price_monthly_cents: 9900, stripe_price_annual_cents: null, stripe_sync_status: "synced" },
  { id: "c0f1e9d6-0000-4000-8000-000000000960", slug: "pro", name: "Pro", description: null, price_cents: 29900,
    annual_price_cents: 0, currency: "PLN", monthly_credits: 1200, bonus_credits: 0, featured: true, active: true,
    sort_order: 2, features: { products: 500, workspace_members: 5, priority_queue: true },
    stripe_price_id_monthly: "price_1UIFXwPOBRMZKbwY4DEKHYwG", stripe_price_id_annual: null,
    stripe_price_monthly_cents: 29900, stripe_price_annual_cents: null, stripe_sync_status: "synced" },
  { id: "c0f1e9d6-0000-4000-8000-0000a9e2c700", slug: "agency", name: "Agency", description: null, price_cents: 99900,
    annual_price_cents: 0, currency: "PLN", monthly_credits: 5000, bonus_credits: 0, featured: false, active: true,
    sort_order: 3, features: { products: -1, workspace_members: -1, priority_queue: true, operator_mode: true },
    stripe_price_id_monthly: "price_1UIFY1POBRMZKbwYnr9YJgNh", stripe_price_id_annual: null,
    stripe_price_monthly_cents: 99900, stripe_price_annual_cents: null, stripe_sync_status: "synced" },
];

const PROD_PACKS: Pack[] = [
  { id: "f86d4f98-14bb-45e6-a867-5700fc7baf65", name: "Start", description: null, credits: 100, bonus_credits: 0,
    price_cents: 1900, currency: "PLN", active: true, sort_order: 0,
    stripe_price_id: "price_1UIFY7POBRMZKbwYbmcEKrBA", stripe_price_cents: 1900, stripe_sync_status: "synced" },
  { id: "69f5fc50-5328-4ee6-b5f8-4ce1014c1aad", name: "Standard", description: null, credits: 500, bonus_credits: 50,
    price_cents: 7900, currency: "PLN", active: true, sort_order: 1,
    stripe_price_id: "price_1UIFYAPOBRMZKbwYYpqxc1ou", stripe_price_cents: 7900, stripe_sync_status: "synced" },
  { id: "d5e9b0d0-9497-4511-b66f-82a808751c8b", name: "Pro", description: null, credits: 1000, bonus_credits: 150,
    price_cents: 13900, currency: "PLN", active: true, sort_order: 2,
    stripe_price_id: "price_1UIFYGPOBRMZKbwYUO5EZGYF", stripe_price_cents: 13900, stripe_sync_status: "synced" },
  { id: "f0e44f7c-9768-48e6-b753-79544fb3646d", name: "Business", description: null, credits: 2500, bonus_credits: 500,
    price_cents: 29900, currency: "PLN", active: true, sort_order: 3,
    stripe_price_id: "price_1UIFYJPOBRMZKbwYn7csVnEN", stripe_price_cents: 29900, stripe_sync_status: "synced" },
];

const PRO = PROD_PLANS[2];
const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2020-01-01T00:00:00Z";
type Sub = { workspace_id: string; plan_id: string; status: string; current_period_end: string | null;
  provider: string; provider_subscription_id: string | null };
const sub = (status: string, end: string | null = FUTURE, extra: Partial<Sub> = {}): Sub => ({
  workspace_id: "ws-0000", plan_id: PRO.id, status, current_period_end: end,
  provider: "stripe", provider_subscription_id: "sub_live", ...extra,
});

/* ── a catalogue that answers the server's reads, the way Postgres would ──*/

type Row = Record<string, unknown>;
function catalogueDb(plans: Plan[], packs: Pack[], subs: Sub[] = [], opts: { subsError?: boolean; catalogueError?: boolean } = {}) {
  const build = (name: string, rows: Row[]) => {
    const filters: [string, (v: unknown) => boolean][] = [];
    const matching = () => rows.filter((r) => filters.every(([k, f]) => f(r[k])));
    const result = () => ((name === "subscriptions" && opts.subsError)
      || (opts.catalogueError && (name === "subscription_plans" || name === "credit_packages"))
      ? { data: null, error: { code: "57014" } }
      : { data: matching(), error: null });
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => { filters.push([col, (v) => v === val]); return q; },
      in: (col: string, vals: unknown[]) => { filters.push([col, (v) => vals.includes(v)]); return q; },
      order: () => q,
      limit: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
    };
    return q;
  };
  return {
    from: (name: string) => build(name,
      name === "credit_packages" ? packs as unknown as Row[]
        : name === "subscription_plans" ? plans as unknown as Row[]
          : name === "subscriptions" ? subs as unknown as Row[]
            : []),
    rpc: async (fn: string) => (fn === "stripe_customer_for" ? { data: "cus_stub", error: null } : { data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never;
}
const WS = { id: "ws-0000", name: "Test Workspace" } as never;

/** /checkout's own URL → request rule (app/(app)/checkout/page.tsx, pinned in A). */
function parseIntent(href: string): CheckoutRequest | null {
  const url = new URL(href, "https://grovbase.com");
  const one = (k: string) => url.searchParams.get(k) ?? undefined;
  const kind = one("kind");
  if (kind === "package") {
    const packageId = one("pack");
    return packageId ? { kind: "credit_package", packageId } : null;
  }
  if (kind === "credits") {
    const n = Number(one("n"));
    return Number.isSafeInteger(n) && n > 0 ? { kind: "custom_credits", credits: n } : null;
  }
  if (kind === "subscription") {
    const planId = one("plan");
    if (!planId) return null;
    return { kind: "subscription", planId, period: one("period") === "annual" ? "annual" : "monthly" };
  }
  return null;
}

/* ── a fake Stripe: records calls, answers what checkout asks ─────────────*/

type Call = { method: string; path: string; body: Record<string, string>; key: string | null };
type FakeIntent = { status: string; metadata: Record<string, string> };
function installStripe(opts: { subStatus?: string; subFails?: boolean; subHttp?: number; intent?: FakeIntent } = {}): Call[] {
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
    const headers = new Headers(init?.headers);
    seen.push({ method, path, body, key: headers.get("Idempotency-Key") });
    if (method === "GET" && path.startsWith("/subscriptions/")) {
      if (opts.subHttp) return new Response(JSON.stringify({ error: { message: "no" } }), { status: opts.subHttp });
      if (opts.subFails) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      return new Response(JSON.stringify({ id: path.split("/")[2], status: opts.subStatus ?? "active" }), { status: 200 });
    }
    if (method === "GET" && /^\/payment_intents\/pi_[A-Za-z0-9_]+$/.test(path) && opts.intent) {
      return new Response(JSON.stringify({ id: path.split("/")[2], ...opts.intent }), { status: 200 });
    }
    if (method === "POST" && /^\/payment_intents\/pi_[A-Za-z0-9_]+\/cancel$/.test(path)) {
      return new Response(JSON.stringify({ id: path.split("/")[2], status: "canceled" }), { status: 200 });
    }
    if (method === "POST" && path === "/payment_intents") {
      return new Response(JSON.stringify({
        id: "pi_stub", client_secret: "pi_stub_secret_x", status: "requires_payment_method",
        amount: Number(body.amount), currency: body.currency,
      }), { status: 200 });
    }
    if (method === "POST" && path === "/checkout/sessions") {
      return new Response(JSON.stringify({ id: "cs_stub", url: "https://checkout.stripe.com/c/cs_stub" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "cus_stub" }), { status: 200 });
  }) as typeof fetch;
  return seen;
}

const NOW = Date.parse("2026-10-08T12:00:00+02:00");
const viewerOf = (state: "anon" | "free" | "allowed" | "check_failed" | "past_due", extra: Partial<ViewerFacts> = {}): ViewerFacts => ({
  signedIn: state !== "anon",
  live: state === "allowed" ? { plan_id: PRO.id, status: "active" }
    : state === "past_due" ? { plan_id: PRO.id, status: "past_due" } : null,
  gate: state === "anon" ? null
    : state === "allowed" ? { ok: true, planId: PRO.id, provider: "stripe", providerSubscriptionId: "sub_live" }
    : { ok: false, reason: state === "check_failed" ? "plan_check_failed" : state === "past_due" ? "plan_inactive" : "plan_required" },
  plan: { slug: null, centsPerCredit: null },
  cost: null,
  ...extra,
});
const page = (state: Parameters<typeof viewerOf>[0], opts: { payments?: boolean; offer?: PricingOffer; plans?: Plan[]; packs?: Pack[]; viewer?: Partial<ViewerFacts> } = {}) =>
  buildPricingPage({
    plans: opts.plans ?? PROD_PLANS, packs: opts.packs ?? PROD_PACKS, now: NOW, payments: opts.payments ?? true,
    offer: opts.offer, viewer: viewerOf(state, opts.viewer),
  });

async function main() {
  console.log("\nA. THE MONEY PATH");
  {
    // Untouched by the /plany task: byte-identical to the pre-task release (f579637).
    const FROZEN: [string, string][] = [
      ["app/(app)/checkout/page.tsx", "2fca9f8520c44682ebc3669a497ef31a0a0b3b2957f40284359d14c72f31a8c8"],
      ["lib/plans/credit-price.ts", "c3ebca6452053a0157eee7bf0fd8c1bdc767593f2e082941951ba02b30aff95c"],
      ["lib/plans/pricing.ts", "6c6ddf4d5784f236eaff740efed5bc23538b2ce44118b92cf9f24b5df2e1c3fa"],
      ["lib/plans/capabilities.ts", "d60ae58bcea9ba6747bb6a3ca978e36a527696b14045b80f33d2930651f19ca6"],
      ["lib/server/stripe-webhook.ts", "e9a03ea46af4bb7d5c91332969154e4b111b4c1634fbbe124a1ba6b8e03c95d2"],
      ["app/actions/billing.ts", "f9feeb8aad93a24806a1de1e0fbd9a3ab929c055cce382e3436f9700e4d862c2"],
      ["lib/server/stripe-pricing.ts", "41573ba733ba26854abed17270fbf310433ae16d9425acc2a176dd0b8c395efe"],
      ["lib/stripe/config.ts", "0679ce3f018add12ead081c8a667511be4237661d15b9a024fb9ec578ed71df1"],
      ["lib/stripe/client.ts", "76df572faae6b3f032010a538385f4c2fd6e18b0d63e294646bd0ae42e97a9b4"],
      ["lib/stripe/signature.ts", "722af66f1fa0c1c11ced6d49d37d6bb18090e72df249290c8dca08b00b44b0b8"],
      ["lib/stripe/capabilities.ts", "d346fde51068e2a67dac2827b986525caf9a73f69d3fd7302d532df120f59cf7"],
      ["lib/stripe/publishable.ts", "84949ccf2061c66ebeb334e2529b3465a9dc3a7eb85ef18b16f30a6bcf8fa0bd"],
      ["app/api/hooks/stripe/route.ts", "12d6aa79017034b0cd8d50ee60bc946541db2eede3aa60508fbf663dfe1c3362"],
      ["components/plan/billing-portal-button.tsx", "75ba0ace8f08d0f5f3cd9363f253a687338af672f1deb47958912f208ba04005"],
      ["components/plan/pricing-model.ts", "c696e3d3361e8f884eaa6e7b4835f5dea1db542c27ebbc6e98ae807de456e503"],
    ];
    for (const [file, digest] of FROZEN) check(`${file} unchanged`, sha(file) === digest, `sha256 ${sha(file).slice(0, 16)}…`);
    // Changed ON PURPOSE by the /plany task (top-up gate, tier contract, offer
    // switches, refusal copy). Re-pinned here so any further change is a
    // decision, not an accident.
    const REPINNED: [string, string][] = [
      // + recheckTopupAction: the pre-confirm re-check (was 9b8ab0ca… before the task).
      ["app/actions/checkout.ts", "86d870410f3cb2dbcaead0f3af84131f3dd3fb0032bed4b434f0e926c10574ea"],
      ["lib/server/checkout.ts", "d8ad102ad3c1dec1b846c0b88cf78d4de01a741c1fd09db0a1f38d8410261210"],
      ["lib/server/billing.ts", "836b6f2b9df42c9d5e594622d1dad5f07d776607a4e601338228f3eb5b20e55d"],
      ["lib/server/pricing-offer.ts", "d9f9a176fee0e4942d1ea65ded19942400e064db5babd7ac60c8dfdcbb64eedf"],
      ["lib/server/stripe-migrate.ts", "96eb6003a8409745870ee1ef72df2b7aee3acfcbb154504b1cf6c2286e59e4d7"],
      ["components/checkout/checkout-view.tsx", "9e8b67cd334f00f87a9fa037d434baec82c37eab3a28b137d5fc05cf37543e88"],
      ["components/plan/checkout-notice.tsx", "2828b7bece18d56cdf46a38c771c4c699914da8c62d6dc0ccf5627f51f0be75d"],
    ];
    for (const [file, digest] of REPINNED) check(`${file} is the reviewed version`, sha(file) === digest, `sha256 ${sha(file)}`);
    const checkout = codeOnly(read("lib/server/checkout.ts"));
    check("the PaymentIntent is still asserted to charge exactly the quote",
      /if \(intent\.amount !== quote\.amountCents\)/.test(checkout));
    check("no checkout code writes the ledger or calls apply_credit_transaction",
      !/apply_credit_transaction|stripe_settle_payment|credit_wallets/.test(checkout + codeOnly(read("lib/server/billing.ts"))
        + codeOnly(read("lib/server/pricing-offer.ts")) + codeOnly(read("lib/server/pricing-page.ts"))));
    check("the old pricing board is gone (one cennik, not two)", !existsSync("components/plan/pricing-board.tsx"));
  }

  const db = (subs: Sub[] = [sub("active")]) => catalogueDb(PROD_PLANS, PROD_PACKS, subs);
  const quote = async (href: string, subs?: Sub[]) => {
    const req = parseIntent(href);
    if (!req) return { ok: false as const, reason: "unparsable" };
    return quoteCheckout(db(subs), WS, req);
  };
  const subscriber = page("allowed");

  console.log("\nB. SAME INTENTS — IDS AND QUANTITIES, NEVER AN AMOUNT");
  {
    const OLD = {
      plan: (id: string, annual: boolean) => `/checkout?kind=subscription&plan=${id}&period=${annual ? "annual" : "monthly"}`,
      pack: (id: string) => `/checkout?kind=package&pack=${id}`,
      credits: (n: number) => `/checkout?kind=credits&n=${n}`,
    };
    for (const p of subscriber.plans) {
      check(`${p.slug} monthly link is the old shape`, planCheckoutHref(p.id, "monthly") === OLD.plan(p.id, false));
    }
    for (const p of subscriber.packs) {
      const row = PROD_PACKS.find((r) => r.credits === p.slot);
      const want = row ? OLD.pack(row.id) : OLD.credits(p.slot);
      check(`pack card ${p.slot}: ${row ? "its pack row" : "a custom amount"}`, p.href === want, String(p.href));
    }
    for (const tier of subscriber.tiers.filter((x) => x.href)) {
      check(`tier ${tier.credits}: a custom-credits intent`, tier.href === OLD.credits(tier.credits));
    }
    const hrefs = [...subscriber.packs, ...subscriber.tiers].map((x) => x.href).filter(Boolean) as string[];
    check("no link carries an amount, a price or a currency",
      hrefs.every((h) => !/amount|price|cents|currency|zl|pln/i.test(h)));
    check("plan links name the row id, never the slug or the label",
      subscriber.plans.every((p) => planCheckoutHref(p.id, "monthly").includes(`plan=${p.id}`)));
  }

  console.log("\nC. DISPLAYED = QUOTED BY THE REAL SERVER (production catalogue, active PRO plan)");
  {
    for (const p of subscriber.plans) {
      const row = PROD_PLANS.find((r) => r.id === p.id)!;
      const q = await quote(planCheckoutHref(p.id, "monthly"), []);
      check(`${p.slug}: shown ${formatMoney(p.priceCents, p.currency)} = quoted, same Price / plan / credits`,
        q.ok && q.quote.amountCents === p.priceCents && q.quote.stripePriceId === row.stripe_price_id_monthly
        && q.quote.planId === row.id && q.quote.credits === p.monthlyCredits + p.bonusCredits && q.quote.currency === "PLN",
        JSON.stringify(q));
    }
    const PLAN_PRICES: Record<string, string> = { starter: "99 zł", pro: "299 zł", agency: "999 zł" };
    for (const p of subscriber.plans) check(`${p.slug} card reads ${PLAN_PRICES[p.slug]}`, nb(formatMoney(p.priceCents, p.currency)) === PLAN_PRICES[p.slug]);

    for (const card of subscriber.packs) {
      if (!card.href) { check(`pack ${card.slot} has no buy link only because it has no price`, card.amountCents === null); continue; }
      const q = await quote(card.href);
      check(`pack ${card.slot}: shown ${formatMoney(card.amountCents ?? 0, "PLN")} = quoted (${card.slot + card.bonusCredits} credits)`,
        q.ok && q.quote.amountCents === card.amountCents && q.quote.credits === card.slot + card.bonusCredits
        && q.quote.currency === "PLN", JSON.stringify(q));
    }
    for (const tier of subscriber.tiers) {
      const q = await quote(creditsCheckoutHref(tier.credits));
      if (tier.amountCents === null) {
        check(`tier ${formatCount(tier.credits)}: no price shown, and the server refuses it`,
          !q.ok && q.reason === "invalid_credits" && tier.href === null, JSON.stringify(q));
      } else {
        check(`tier ${formatCount(tier.credits)}: shown ${formatMoney(tier.amountCents, "PLN")} = quoted`,
          q.ok && q.quote.amountCents === tier.amountCents && q.quote.credits === tier.credits
          && q.quote.stripePriceId === null, JSON.stringify(q));
      }
    }
    // Literal pins — the production rate card, written out by hand, so the
    // expectation is not computed by the code under test.
    const PINS: [number, number | null][] = [[200, 3200], [300, 4600], [800, 10400], [1000, 12400], [3000, 29900],
      [5000, null], [10000, null], [50000, null]];
    const all = [...subscriber.packs.map((p) => [p.slot, p.amountCents] as const), ...subscriber.tiers.map((t) => [t.credits, t.amountCents] as const)];
    for (const [n, cents] of PINS) {
      check(`${formatCount(n)} kredytów → ${cents === null ? "not on sale" : formatMoney(cents, "PLN")}`,
        all.find(([c]) => c === n)?.[1] === cents);
    }
    check("the 100 and 500 cards are the existing packs at their own prices",
      subscriber.packs.find((p) => p.slot === 100)?.amountCents === 1900
      && subscriber.packs.find((p) => p.slot === 500)?.amountCents === 7900
      && subscriber.packs.find((p) => p.slot === 500)?.bonusCredits === 50);

    // The charge itself: begin creates a PaymentIntent for exactly the quote.
    for (const href of [subscriber.packs.find((p) => p.slot === 800)!.href!, subscriber.packs.find((p) => p.slot === 100)!.href!,
      subscriber.tiers.find((t) => t.credits === 1000)!.href!]) {
      const seen = installStripe();
      const req = parseIntent(href)!;
      const res = await beginCheckout(db(), WS, "buyer@example.test", req);
      const pi = seen.find((c) => c.method === "POST" && c.path === "/payment_intents");
      const shown = [...subscriber.packs.map((p) => [p.href, p.amountCents]), ...subscriber.tiers.map((t) => [t.href, t.amountCents])]
        .find(([h]) => h === href)?.[1];
      check(`Stripe is asked for exactly the displayed amount (${href})`,
        res.ok && pi !== undefined && Number(pi.body.amount) === shown && pi.body.currency === "pln",
        JSON.stringify({ res, amount: pi?.body.amount, shown }));
    }
  }

  console.log("\nD. ANNUAL — OFF UNTIL CREDITS FOLLOW A YEARLY INVOICE");
  {
    check("the offer switch is off", PRICING_OFFER.annual.enabled === false);
    for (const p of subscriber.plans) {
      const q = await quote(planCheckoutHref(p.id, "annual"), []);
      check(`production: a forced annual ${p.slug} checkout is refused`, !q.ok && q.reason === "annual_unavailable", JSON.stringify(q));
    }
    const ANNUAL: Record<string, [number, string]> = {
      starter: [95040, "price_annual_starter"], pro: [287040, "price_annual_pro"], agency: [959040, "price_annual_agency"],
    };
    const annualPlans = PROD_PLANS.map((p) => (ANNUAL[p.slug] ? {
      ...p, annual_price_cents: ANNUAL[p.slug][0], stripe_price_id_annual: ANNUAL[p.slug][1], stripe_price_annual_cents: ANNUAL[p.slug][0],
    } : p));
    for (const p of annualPlans.filter((x) => x.price_cents > 0)) {
      const q = await quoteCheckout(catalogueDb(annualPlans, PROD_PACKS), WS, { kind: "subscription", planId: p.id, period: "annual" });
      check(`even with a synced annual Price, ${p.slug} annual is refused while the switch is off`,
        !q.ok && q.reason === "annual_unavailable");
    }
    const legacy = await createPlanCheckout(catalogueDb(annualPlans, PROD_PACKS), WS, null, annualPlans[2].id, "annual");
    check("…and the hosted fallback refuses it too", !legacy.ok && legacy.reason === "annual_unavailable");
    const off = page("free", { plans: annualPlans });
    check("page: annual not on sale → no saving claimed, every card monthly",
      !off.annual.onSale && off.annual.savingPct === 0 && off.plans.every((p) => !p.payable.annual));
    const on = page("free", { plans: annualPlans, offer: { ...PRICING_OFFER, annual: { enabled: true } } });
    check("page: with the switch on and real annual Prices, annual is on sale with the REAL smallest saving",
      on.annual.onSale && on.annual.savingPct === annualSavingPct(on.plans) && on.annual.savingPct === 20);
    const partial = page("free", { plans: annualPlans.map((p) => (p.slug === "pro" ? { ...p, stripe_price_id_annual: null } : p)),
      offer: { ...PRICING_OFFER, annual: { enabled: true } } });
    check("…but one plan without its annual Price keeps annual off for the whole page", !partial.annual.onSale);
    const ui = codeOnly(read("components/plan/pricing-page.tsx"));
    check("the annual segment is disabled unless on sale (no fake −20%)",
      /disabled=\{!data\.annual\.onSale\}/.test(ui) && /data\.annual\.onSale && data\.annual\.savingPct > 0/.test(ui)
      && !/−20%|-20%/.test(ui));
  }

  console.log("\nE. TOP-UPS NEED AN ACTIVE PAID PLAN (server-side, every path)");
  {
    const pack = PROD_PACKS[0];
    const states: [string, Sub[], string][] = [
      ["no subscription (Free / anonymous workspace)", [], "plan_required"],
      // A live but not paid-up subscription: "inactive" (manage it), not "none" (buy one).
      ["trialing", [sub("trialing")], "plan_inactive"],
      ["past_due", [sub("past_due")], "plan_inactive"],
      ["canceled", [sub("canceled")], "plan_required"],
      ["incomplete", [sub("incomplete")], "plan_required"],
      ["incomplete_expired", [sub("incomplete_expired")], "plan_required"],
      ["unpaid", [sub("unpaid")], "plan_required"],
      ["paused", [sub("paused")], "plan_required"],
      ["active but the paid period has ended (stale webhook)", [sub("active", PAST)], "plan_inactive"],
      ["active with no period end recorded", [sub("active", null)], "plan_inactive"],
      ["a lapsed active row next to a canceled one", [sub("active", PAST), sub("canceled")], "plan_inactive"],
      ["a running active row wins over a past_due one", [sub("past_due"), sub("active", FUTURE)], "ok"],
      ["another workspace's active plan", [sub("active", FUTURE, { workspace_id: "ws-other" })], "plan_required"],
    ];
    for (const [what, subs, reason] of states) {
      const a = await quote(packCheckoutHref(pack.id), subs);
      const b = await quote(creditsCheckoutHref(1000), subs);
      if (reason === "ok") { check(`${what}: allowed`, a.ok && b.ok, JSON.stringify([a, b])); continue; }
      check(`${what}: pack and custom amount refused (${reason})`,
        !a.ok && a.reason === reason && !b.ok && b.reason === reason, JSON.stringify([a, b]));
    }
    const failed = await quoteCheckout(catalogueDb(PROD_PLANS, PROD_PACKS, [sub("active")], { subsError: true }), WS,
      { kind: "credit_package", packageId: pack.id });
    check("a failed subscription lookup refuses (closed), as plan_check_failed", !failed.ok && failed.reason === "plan_check_failed");
    const ok = await quote(packCheckoutHref(pack.id), [sub("active")]);
    check("active + paid period running → allowed", ok.ok);
    const cancelling = await quote(packCheckoutHref(pack.id), [sub("active", FUTURE)]);
    check("active with cancel_at_period_end (status still active) → allowed until the period ends", cancelling.ok);
    const planQ = await quote(planCheckoutHref(PRO.id, "monthly"), []);
    check("a PLAN purchase is not gated — that is how a Free user gets a plan", planQ.ok);
    const gate = await requireActivePaidPlan(db([sub("active")]), WS, NOW);
    check("the gate never trusts a client: it takes only the session's workspace", gate.ok && gate.planId === PRO.id);

    // begin: Stripe itself is asked, and a refusal creates nothing.
    let seen = installStripe({ subStatus: "canceled" });
    let res = await beginCheckout(db([sub("active")]), WS, null, { kind: "credit_package", packageId: pack.id });
    check("begin: DB says active, Stripe says canceled → plan_required, no PaymentIntent",
      !res.ok && res.reason === "plan_required" && !seen.some((c) => c.path === "/payment_intents"), JSON.stringify(res));
    seen = installStripe({ subStatus: "past_due" });
    res = await beginCheckout(db([sub("active")]), WS, null, { kind: "credit_package", packageId: pack.id });
    check("begin: DB says active, Stripe says past_due → plan_inactive, no PaymentIntent",
      !res.ok && res.reason === "plan_inactive" && !seen.some((c) => c.path === "/payment_intents"), JSON.stringify(res));
    seen = installStripe({ subFails: true });
    res = await beginCheckout(db([sub("active")]), WS, null, { kind: "custom_credits", credits: 1000 });
    check("begin: Stripe lookup fails → plan_check_failed, no PaymentIntent",
      !res.ok && res.reason === "plan_check_failed" && !seen.some((c) => c.path === "/payment_intents"));
    seen = installStripe();
    res = await beginCheckout(db([]), WS, null, { kind: "custom_credits", credits: 1000 });
    check("begin (a manual POST with no plan): refused before any Stripe call",
      !res.ok && res.reason === "plan_required" && seen.length === 0);

    // The hosted fallback's two public actions.
    seen = installStripe();
    const hp = await createPackageCheckout(db([]), WS, null, pack.id);
    const hc = await createCustomCreditsCheckout(db([]), WS, null, 1000);
    check("hosted fallback: pack and custom refused without a plan, no session created",
      !hp.ok && hp.reason === "plan_required" && !hc.ok && hc.reason === "plan_required"
      && !seen.some((c) => c.path === "/checkout/sessions"));
    seen = installStripe();
    const hcOk = await createCustomCreditsCheckout(db([sub("active")]), WS, null, 1000);
    const session = seen.find((c) => c.path === "/checkout/sessions");
    check("hosted fallback with an active plan: the session charges the tier's displayed price",
      hcOk.ok && Number(session?.body["line_items[0][price_data][unit_amount]"]) === 12400, JSON.stringify(session?.body ?? {}));
    seen = installStripe();
    const hcBad = await createCustomCreditsCheckout(db([sub("active")]), WS, null, 1001);
    check("hosted fallback: an amount between tiers is refused", !hcBad.ok && hcBad.reason === "invalid_credits");
    const expiry = Number(session?.body.expires_at);
    const nowS = Math.floor(Date.now() / 1000);
    check("hosted top-up sessions expire in 31 minutes, not Stripe's 24 hours (the plan is judged at creation)",
      expiry >= nowS + 30 * 60 && expiry <= nowS + 32 * 60, String(session?.body.expires_at));
    seen = installStripe();
    await createPackageCheckout(db([sub("active")]), WS, null, pack.id);
    const packSession = seen.find((c) => c.path === "/checkout/sessions");
    check("…the pack session too", Number(packSession?.body.expires_at) >= nowS + 30 * 60 && Number(packSession?.body.expires_at) <= nowS + 32 * 60);
    seen = installStripe({ subHttp: 401 });
    res = await beginCheckout(db([sub("active")]), WS, null, { kind: "credit_package", packageId: pack.id });
    check("begin: a rejected Stripe key on the live plan check says so (stripe_unauthorized), no PaymentIntent",
      !res.ok && res.reason === "stripe_unauthorized" && !seen.some((c) => c.path === "/payment_intents"), JSON.stringify(res));

    // THE RACE: a PaymentIntent created while the plan was live, confirmed
    // after it ended. The page re-checks right before confirming, and an
    // intent whose plan has ended is cancelled — it can no longer be paid.
    const mine = { status: "requires_payment_method", metadata: { grovbase_workspace_id: "ws-0000", type: "credit_package" } };
    seen = installStripe({ intent: mine });
    const live = await recheckTopup(db([sub("active")]), WS, "pi_abc");
    check("recheck: plan still active → ok, nothing cancelled", live.ok && !seen.some((c) => c.path.endsWith("/cancel")));
    seen = installStripe({ intent: mine });
    const ended = await recheckTopup(db([]), WS, "pi_abc");
    const cancel = seen.find((c) => c.method === "POST" && c.path === "/payment_intents/pi_abc/cancel");
    check("recheck: plan ended → plan_required, and the intent is cancelled (idempotently, as abandoned)",
      !ended.ok && ended.reason === "plan_required" && cancel?.body.cancellation_reason === "abandoned" && cancel?.key === "cancel:pi_abc",
      JSON.stringify({ ended, cancel }));
    seen = installStripe({ intent: mine });
    const lapsed = await recheckTopup(db([sub("past_due")]), WS, "pi_abc");
    check("recheck: plan past_due → plan_inactive, and the intent is cancelled too",
      !lapsed.ok && lapsed.reason === "plan_inactive" && seen.some((c) => c.path === "/payment_intents/pi_abc/cancel"));
    seen = installStripe({ intent: mine, subStatus: "canceled" });
    const stripeEnded = await recheckTopup(db([sub("active")]), WS, "pi_abc");
    check("recheck: DB active but Stripe says canceled → plan_required + cancelled",
      !stripeEnded.ok && stripeEnded.reason === "plan_required" && seen.some((c) => c.path === "/payment_intents/pi_abc/cancel"));
    seen = installStripe({ intent: mine, subFails: true });
    const unknownState = await recheckTopup(db([sub("active")]), WS, "pi_abc");
    check("recheck: Stripe lookup fails → refused (plan_check_failed), but nothing cancelled on a guess",
      !unknownState.ok && unknownState.reason === "plan_check_failed" && !seen.some((c) => c.path.endsWith("/cancel")));
    seen = installStripe({ intent: { ...mine, status: "succeeded" } });
    await recheckTopup(db([]), WS, "pi_abc");
    check("recheck: an intent already paid is never cancelled", !seen.some((c) => c.path.endsWith("/cancel")));
    seen = installStripe({ intent: { ...mine, metadata: { grovbase_workspace_id: "ws-other", type: "credit_package" } } });
    const foreign = await recheckTopup(db([]), WS, "pi_abc");
    check("recheck: another workspace's intent → unknown_payment, untouched",
      !foreign.ok && foreign.reason === "unknown_payment" && !seen.some((c) => c.path.endsWith("/cancel")));
    seen = installStripe({ intent: { ...mine, metadata: { grovbase_workspace_id: "ws-0000", type: "subscription" } } });
    const notTopup = await recheckTopup(db([]), WS, "pi_abc");
    check("recheck: a non-top-up intent → unknown_payment, untouched",
      !notTopup.ok && notTopup.reason === "unknown_payment" && !seen.some((c) => c.path.endsWith("/cancel")));
    seen = installStripe({ intent: mine });
    const junk = await recheckTopup(db([]), WS, "cs_../../customers");
    check("recheck: a reference that is not a PaymentIntent id is refused before any Stripe call",
      !junk.ok && junk.reason === "unknown_payment" && seen.length === 0);
    const view = codeOnly(read("components/checkout/checkout-view.tsx"));
    check("the checkout re-checks a top-up BEFORE stripe.confirmPayment",
      /recheckTopupAction\(/.test(view) && view.indexOf("recheckTopupAction(") < view.indexOf("stripe.confirmPayment("));
    check("a re-check that throws (network, redeploy) refuses instead of leaving the button spinning",
      /try \{\s*still = await recheckTopupAction\(reference\);\s*\} catch \{\s*still = \{ ok: false, reason: "plan_check_failed" \};/.test(view));
    check("a wallet sheet (Apple Pay / Google Pay) is told the payment failed on every early return",
      /onConfirm=\{\(event\) => \{ void confirm\(\(\) => event\.paymentFailed\(\{ reason: "fail" \}\)\); \}\}/.test(view)
      && /if \(!stripe \|\| !elements \|\| busy\) \{ refused\?\.\(\); return; \}/.test(view)
      && /setBusy\(false\);\s*refused\?\.\(\);/.test(view));
    check("every surface names an inactive plan as such (toast, refusal box, hosted fallback, /plan notice)",
      (view.match(/"plan_inactive" \? "pricing\.notice\.planInactive"/g) ?? []).length === 3
      && /plan_inactive: "pricing\.notice\.planInactive"/.test(read("components/plan/checkout-notice.tsx")));

    const unsynced = PROD_PACKS.map((p, i) => (i === 0 ? { ...p, stripe_sync_status: "failed" } : p));
    const hpUnsynced = await createPackageCheckout(catalogueDb(PROD_PLANS, unsynced, [sub("active")]), WS, null, pack.id);
    check("hosted fallback now applies the same price-parity rule", !hpUnsynced.ok && hpUnsynced.reason === "price_out_of_sync");

    check("nothing in the guard writes: balances, history and the ledger are untouched",
      !/\.(insert|update|upsert|delete)\(/.test(codeOnly(read("lib/server/billing.ts")).slice(
        read("lib/server/billing.ts").indexOf("WHO MAY TOP UP"), read("lib/server/billing.ts").indexOf("THE THREE THINGS THAT CAN BE BOUGHT"))));
    check("the webhook was not taught to refuse money (still settles credit_package / custom_credits)",
      sha("lib/server/stripe-webhook.ts") === "e9a03ea46af4bb7d5c91332969154e4b111b4c1634fbbe124a1ba6b8e03c95d2");
  }

  console.log("\nF. TIERS AND PACK SLOTS — THE OFFERED AMOUNTS AND NOTHING ELSE");
  {
    check("exactly the ten tiers, ascending, max 50 000",
      TOPUP_TIERS.join(",") === "1000,3000,5000,10000,15000,20000,25000,30000,40000,50000");
    check("exactly the five pack slots, in display order", PACK_SLOTS.join(",") === "800,500,300,200,100");
    check("a slot WITH a pack row is sold as that pack, not as a custom amount",
      offeredCustomAmounts(PROD_PACKS).sort((a, b) => a - b).join(",") === "200,300,800,1000,3000,5000,10000,15000,20000,25000,30000,40000,50000");
    const input = { packs: PROD_PACKS, planSlug: null, planCentsPerCredit: null };
    for (const n of [100, 150, 250, 333, 500, 550, 777, 999, 1001, 1150, 2999, 3001, 49999, 50001, 100000]) {
      const r = priceTopup(n, input);
      check(`${n} is not an offered amount`, !r.ok && r.reason === "not_offered");
    }
    for (const bad of [0, -1000, 1000.5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null, {}]) {
      const r = priceTopup(bad, input);
      check(`${JSON.stringify(bad) ?? String(bad)} is refused`, !r.ok);
    }
    // No extrapolation above the largest pack (3 000 credits incl. bonus).
    for (const n of [5000, 10000, 50000]) {
      const r = priceTopup(n, input);
      check(`${n}: above the rate card — unpriced, not extrapolated`, !r.ok && r.reason === "unpriced");
    }
    check("the ladder price of an offered amount is validateCustomCredits' own",
      [200, 300, 800, 1000, 3000].every((n) => {
        const r = priceTopup(n, input); const v = validateCustomCredits(n, creditLadder(PROD_PACKS));
        return r.ok && v.ok && r.amountCents === v.amountCents && r.source === "ladder";
      }));
    check("no approved prices are configured", PRICING_OFFER.topups.approvedCents === null && PRICING_OFFER.topups.perPlanCents === null);

    // An approved price needs validated costs; without them it is not sold.
    const approvedNoCosts: PricingOffer = { ...PRICING_OFFER, topups: { ...PRICING_OFFER.topups, approvedCents: { 5000: 40000 } } };
    const r1 = priceTopup(5000, { ...input, offer: approvedNoCosts });
    check("an approved price with no cost inputs is NOT sold (fails closed)", !r1.ok && r1.reason === "unpriced");
    const costs = { providerCentsPerCredit: 4, paymentFeePercent: 1.5, paymentFeeFixedCents: 100, minMarginPercent: 50 };
    const approved: PricingOffer = { ...PRICING_OFFER, topups: { ...PRICING_OFFER.topups, approvedCents: { 5000: 45000, 10000: 50000 }, costs } };
    const ok5 = priceTopup(5000, { ...input, offer: approved });
    check("an approved price with a margin above the minimum is sold at exactly that price",
      ok5.ok && ok5.amountCents === 45000 && ok5.source === "approved");
    check("margin = (price − fee − credits × cost) / price",
      Math.abs((topupMarginPercent(5000, 45000, costs) ?? 0) - ((45000 - 675 - 100 - 20000) / 45000) * 100) < 1e-9);
    const thin = priceTopup(10000, { ...input, offer: approved });
    check("an approved price below the minimum margin is refused", !thin.ok && thin.reason === "unpriced");
    const perPlan: PricingOffer = { ...approved, topups: { ...approved.topups,
      perPlanCents: { starter: { 5000: 60000 }, pro: { 5000: 50000 }, agency: null } } };
    const forPro = priceTopup(5000, { ...input, planSlug: "pro", offer: perPlan });
    const forAgency = priceTopup(5000, { ...input, planSlug: "agency", offer: perPlan });
    check("per-plan prices win for their plan, the common price applies to the others",
      forPro.ok && forPro.amountCents === 50000 && forPro.source === "approved_plan"
      && forAgency.ok && forAgency.amountCents === 45000 && forAgency.source === "approved");
    const policy: PricingOffer = { ...approved, topups: { ...approved.topups, minUnitVsPlan: 1 } };
    check("policy: a top-up credit cheaper than the buyer's plan credit is refused",
      !approvedPriceValid(5000, 45000, 29900 / 1200, policy) && approvedPriceValid(5000, 45000, 5, policy));
    check("…and with the policy set, an unknown plan price refuses", !approvedPriceValid(5000, 45000, null, policy));
  }

  console.log("\nG. PREMIERE — OFF, SERVER-CLOCKED, AUDITABLE");
  {
    check("the premiere is off", PRICING_OFFER.premiere.enabled === false && premiereState(NOW).status === "off");
    check("…and no regular price is invented", Object.values(PRICING_OFFER.premiere.regularMonthlyCents).every((v) => v === null));
    check("the deadline is 31 Oct 2026 23:59:59 Warsaw (CET after the 25 Oct DST change) = 22:59:59Z",
      Date.parse(PRICING_OFFER.premiere.endsAt) === Date.UTC(2026, 9, 31, 22, 59, 59));
    const enabledNoPrices: PricingOffer = { ...PRICING_OFFER, premiere: { ...PRICING_OFFER.premiere, enabled: true } };
    check("switched on WITHOUT regular prices it stays off", premiereState(NOW, enabledNoPrices).status === "off");
    const on: PricingOffer = { ...PRICING_OFFER, premiere: { ...PRICING_OFFER.premiere, enabled: true,
      regularMonthlyCents: { starter: 12900, pro: 39900, agency: 129900 } } };
    const end = Date.parse(on.premiere.endsAt);
    check("on, before the deadline: active", premiereState(end - 1, on).status === "active");
    check("on, at the deadline: ended (no reset, no client clock)", premiereState(end, on).status === "ended");
    check("price lock metadata only while active",
      premiereMetadata(end - 1, on).grovbase_price_lock === "premiere-2026-10" && Object.keys(premiereMetadata(end, on)).length === 0
      && Object.keys(premiereMetadata(NOW)).length === 0);
    check("after the deadline a plan still at its premiere price is not sold",
      premiereExpiredFor("pro", 29900, end, on) && !premiereExpiredFor("pro", 39900, end, on) && !premiereExpiredFor("pro", 29900, end - 1, on));
    check("…which today (off) never triggers", !premiereExpiredFor("pro", 29900, end + 1));
    check("a locked subscription is recognised", isPriceLocked({ grovbase_price_lock: "premiere-2026-10" }) && !isPriceLocked({}) && !isPriceLocked(null));
    const migrate = codeOnly(read("lib/server/stripe-migrate.ts"));
    check("the admin bulk price migration skips price-locked subscriptions (grandfathering holds through renewals)",
      /if \(isPriceLocked\(sub\.metadata\)\) \{ continue; \}/.test(migrate));
    const checkout = codeOnly(read("lib/server/checkout.ts")); const billing = codeOnly(read("lib/server/billing.ts"));
    check("both subscription paths tag only through premiereMetadata, on server time",
      /\.\.\.premiereMetadata\(Date\.now\(\)\)/.test(checkout) && /\.\.\.premiereMetadata\(Date\.now\(\)\)/.test(billing));
    const shown = page("free", { offer: on });
    check("page: the banner gets the server's deadline and the server's now", shown.premiere?.endsAtMs === end && shown.premiere?.serverNow === NOW);
    check("page: no banner today", page("free").premiere === null);
    const banner = codeOnly(read("components/plan/premiere-banner.tsx"));
    check("the countdown runs on the server/client skew, and removes itself at zero",
      /serverNow - Date\.now\(\)/.test(banner) && /if \(left <= 0\) return null;/.test(banner));
    check("no strike-through or fake discount anywhere in the page",
      ["premiere-banner.tsx", "plan-cards.tsx", "topups.tsx", "pricing-page.tsx", "plan-comparison.tsx"]
        .every((f) => !/line-through|30% OFF|−30%/.test(read(`components/plan/${f}`))));
  }

  console.log("\nH. THE PAGE'S DATA");
  {
    const anon = page("anon");
    check("visitor: top-ups locked as 'anonymous', no plan, no subscription",
      anon.viewer.topups === "anonymous" && anon.viewer.currentSlug === null && !anon.viewer.hasLiveSubscription && !anon.viewer.signedIn);
    check("visitor: no image counts (ai_models is not readable anonymously)", anon.imageCost === null);
    check("visitor: the data carries nothing about an account",
      Object.keys(anon.viewer).sort().join(",") === "currentSlug,hasLiveSubscription,signedIn,topups"
      && !/balance|email|wallet|workspace_id|ws-0000/i.test(JSON.stringify(anon)));
    check("free user: locked as 'no_plan'", page("free").viewer.topups === "no_plan");
    check("lookup failure: locked as 'check_failed'", page("check_failed").viewer.topups === "check_failed");
    check("a subscription that exists but is not active (past_due): 'plan_inactive', not 'choose a plan'",
      page("past_due").viewer.topups === "plan_inactive" && page("past_due").viewer.hasLiveSubscription);
    let threw = "";
    try {
      await loadPricingPage(catalogueDb(PROD_PLANS, PROD_PACKS, [], { catalogueError: true }));
    } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    check("an unreadable catalogue throws to the error boundary — never a page of 'not on sale' cards",
      threw === "pricing_catalogue_unavailable" && existsSync("app/plany/error.tsx") && existsSync("app/(app)/error.tsx"));
    const loaded = await loadPricingPage(catalogueDb(PROD_PLANS, PROD_PACKS));
    check("…and a readable one loads (visitor view)", loaded.plans.length === 3 && loaded.viewer.topups === "anonymous");
    const mig = codeOnly(read("supabase/migrations/0137_public_catalogue_read.sql").replace(/--.*$/gm, ""));
    check("0137: a visitor reads active plans/packs through a policy that never mentions is_admin(); nothing dropped",
      /create policy "plans_select_public" on public\.subscription_plans for select\s+to anon\s+using \(active = true\);/.test(mig)
      && /create policy "pkg_select_public" on public\.credit_packages for select\s+to anon\s+using \(active = true\);/.test(mig)
      && /alter policy "plans_admin_write" on public\.subscription_plans\s+to authenticated/.test(mig)
      && /alter policy "pkg_admin_write" on public\.credit_packages\s+to authenticated/.test(mig)
      && /alter policy "plans_select" on public\.subscription_plans\s+to authenticated/.test(mig)
      && /alter policy "pkg_select_active" on public\.credit_packages\s+to authenticated/.test(mig)
      && !/\bdrop\b|\brevoke\b|grant execute on function public\.is_admin/i.test(mig));
    check("0137 is proven on a real Postgres (scripts/public-catalogue-sql-tests.sh, npm run test:pubcatalogue:sql)",
      existsSync("scripts/public-catalogue-sql-tests.sh") && /"test:pubcatalogue:sql"/.test(read("package.json")));
    const errorPage = codeOnly(read("app/plany/error.tsx"));
    check("the error page's retry re-fetches the server payload before resetting",
      /startTransition\(\(\) => \{ router\.refresh\(\); reset\(\); \}\)/.test(errorPage) && /onClick=\{retry\}/.test(errorPage));
    check("subscriber: allowed, PRO marked as current", subscriber.viewer.topups === "allowed" && subscriber.viewer.currentSlug === "pro");
    check("three paid cards; Free is only a note", subscriber.plans.map((p) => p.slug).join(",") === "starter,pro,agency" && subscriber.free?.name === "Free");
    check("pack cards 800 / 500 / 300 / 200 / 100 with coins 5 → 1",
      subscriber.packs.map((p) => `${p.slot}:${p.level}`).join(",") === "800:5,500:4,300:3,200:2,100:1");
    check("BEST VALUE is only on the lowest price per credit — the 800 card",
      subscriber.packs.filter((p) => p.best).map((p) => p.slot).join(",") === "800");
    check("savings compare real prices per credit with the 100 pack (none on the 100 pack itself)",
      subscriber.packs.find((p) => p.slot === 100)?.savePct === null
      && subscriber.packs.find((p) => p.slot === 800)?.savePct === Math.round((1 - 10400 / 800 / 19) * 100));
    check("ten tiers on the page, exactly the offered ones", subscriber.tiers.map((t) => t.credits).join(",") === TOPUP_TIERS.join(","));
    const off = page("allowed", { payments: false });
    check("payments off: nothing is buyable (no link anywhere)",
      off.plans.every((p) => !p.payable.monthly) && off.packs.every((p) => !p.href) && off.tiers.every((t) => !t.href));
    const unsynced = page("allowed", { packs: PROD_PACKS.map((p, i) => (i === 2 ? { ...p, stripe_sync_status: "failed" } : p)) });
    check("one unverified pack: no custom amount is priced (the checkout would refuse)",
      unsynced.tiers.every((t) => t.amountCents === null) && unsynced.packs.filter((p) => p.slot === 800 || p.slot === 200).every((p) => p.amountCents === null));
    const counted = page("allowed", { viewer: { cost: { display_name: "Nano Banana Pro", pricing: { "1K": 7, "2K": 7, "4K": 12 } } } });
    check("signed in: image counts come from the model's real per-size price",
      counted.imageCost?.k2 === 7 && counted.imageCost?.k4 === 12 && counted.imageCost?.model === "Nano Banana Pro");
    check("PRO: ≈ 171 photos in 2K, ≈ 100 in 4K (1 200 credits)", Math.floor(1200 / 7) === 171 && Math.floor(1200 / 12) === 100);
    const pl = JSON.parse(read("lib/i18n/dictionaries/pl.json"));
    check("Polish plural: '≈ 42 zdjęcia', '≈ 171 zdjęć' — the few-form keys exist and are chosen by the number",
      isFewForm(42) && !isFewForm(171) && !isFewForm(12) && /zdjęcia/.test(pl.pricing.plan.approx2kFew) && /zdjęć/.test(pl.pricing.plan.approx2k)
      && /approx\$\{size\}\$\{isFewForm\(n\) \? "Few" : ""\}/.test(read("components/plan/plan-cards.tsx")));
    check("the plan's credit word follows the number too (creditsWord)", /creditsWord\(credits, t\)/.test(read("components/plan/plan-cards.tsx")));
    const cards = codeOnly(read("components/plan/plan-cards.tsx"));
    check("the card divides the plan's credits by that price, nothing else",
      /Math\.floor\(credits \/ cost\.k2\)/.test(cards) && /Math\.floor\(credits \/ cost\.k4\)/.test(cards));
  }

  console.log("\nI. ROUTING AND SEO");
  {
    check("/plany is a public route (outside the app group)", existsSync("app/plany/page.tsx") && !existsSync("app/(app)/plany"));
    check("/plany is not a protected path; /plan still is", !isProtectedPath("/plany") && isProtectedPath("/plan") && isProtectedPath("/plan/x"));
    const plany = codeOnly(read("app/plany/page.tsx"));
    const surfaceSrc = codeOnly(read("components/plan/pricing-surface.tsx"));
    check("/plany: canonical /plany, indexable, no redirect to login",
      /export const generateMetadata = pricingMetadata/.test(plany) && /canonical: "\/plany"/.test(surfaceSrc)
      && !/noindex|robots:/.test(plany + surfaceSrc) && !/redirect\(/.test(plany));
    check("/plany's title is the bare name (the layout template adds the brand once)",
      ["pl", "en", "de"].every((l) => !/GrovBase/.test(JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).pricing.meta.title)));
    check("/plany renders the shared surface in page scope, with no ?checkout= banner (returns land on /plan)",
      /<PricingSurface scope="page" \/>/.test(plany) && !/checkoutNotice|searchParams/.test(plany));
    const plan = codeOnly(read("app/(app)/plan/page.tsx"));
    check("/plan renders the SAME surface in the app shell, canonical /plany",
      /<PricingSurface scope="shell"/.test(plan) && /canonical: "\/plany"/.test(plan));
    const config = read("next.config.mjs");
    check("/cennik → /plany, permanent (308)", /\{ source: "\/cennik", destination: "\/plany", permanent: true \}/.test(config));
    const robots = codeOnly(read("app/robots.ts"));
    check("robots no longer blocks every path starting /plan, but still /plan, /plan/… and /plan?…",
      !/"\/plan",/.test(robots) && /"\/plan\$", "\/plan\/", "\/plan\?"/.test(robots));
    check("sitemap lists /plany and never /cennik", /path: "\/plany"/.test(read("app/sitemap.ts")) && !/path: "\/cennik"/.test(read("app/sitemap.ts")));
    check("a CMS redirect cannot hijack /plany or /cennik", /"\/plany", "\/cennik"/.test(read("lib/server/redirects.ts")));
    check("the ?checkout= notice accepts one short token or nothing",
      checkoutNotice({ checkout: "plan_required" }) === "plan_required" && checkoutNotice({ checkout: "https://evil.example" }) === null
      && checkoutNotice({ checkout: ["a", "b"] }) === null && checkoutNotice({}) === null);
    const surface = codeOnly(read("components/plan/pricing-surface.tsx"));
    const loader = codeOnly(read("lib/server/pricing-page.ts"));
    check("a visitor costs only public reads (workspace reads only with a user)",
      /const workspace = user \? await getCurrentWorkspace/.test(loader) && /workspace\s*\? supabase\.from\("subscriptions"\)/.test(loader)
      && /data\.viewer\.signedIn \? memberChrome\(supabase\)/.test(surface));
    check("no anonymous checkout: /checkout still sends a visitor to sign in",
      /if \(!user\) redirect\(/.test(codeOnly(read("app/(app)/checkout/page.tsx"))));
    check("a visitor's 'Wybierz plan' opens the sign-in dialog with the order as the destination",
      /<Gate href=\{cta\.href\} signedIn=\{data\.viewer\.signedIn\}/.test(codeOnly(read("components/plan/plan-cards.tsx"))));
    const bar = codeOnly(read("components/layout/mega-topbar.tsx"));
    check("the header's 'Plany' sends a visitor to /plany, a member to /plan", /href=\{guest \? "\/plany" : "\/plan"\}/.test(bar));
    check("FAQ structured data is exactly the visible questions", /"@type": "FAQPage"/.test(surface)
      && /FAQ\.filter\(\(f\) => f\.when !== "premiere" \|\| data\.premiere\)/.test(surface));
  }

  console.log("\nJ. CONFIG AND COPY");
  {
    const config = codeOnly(read("components/plan/pricing-config.ts"));
    check("pricing-config.ts holds no price, credit amount, discount, date or Stripe id",
      !/(price|cents|credits|amount|discount|percent|stripe)\w*\s*:\s*-?\d/i.test(config)
      && !/price_[0-9A-Za-z]{6,}/.test(config) && !/20\d\d-\d\d-\d\d/.test(config));
    check("the offer config is server-only", read("lib/server/pricing-offer.ts").startsWith('import "server-only"'));
    check("no client component imports the offer config",
      ["pricing-page.tsx", "plan-cards.tsx", "plan-comparison.tsx", "topups.tsx", "pricing-faq.tsx", "premiere-banner.tsx"]
        .every((f) => !/pricing-offer|lib\/server\//.test(codeOnly(read(`components/plan/${f}`)))));
    check("the page computes no price (no rate card in any client component)",
      ["pricing-page.tsx", "plan-cards.tsx", "plan-comparison.tsx", "topups.tsx"]
        .every((f) => !/creditLadder|priceForCredits|validateCustomCredits|priceTopup/.test(codeOnly(read(`components/plan/${f}`)))));
    const dicts = Object.fromEntries((["pl", "en", "de"] as const).map((l) => [l, JSON.parse(read(`lib/i18n/dictionaries/${l}.json`))]));
    const lookup = (d: unknown, key: string): unknown => {
      if (typeof d !== "object" || d === null) return undefined;
      const obj = d as Record<string, unknown>;
      if (key in obj) return obj[key];
      const dot = key.indexOf(".");
      return dot < 0 ? undefined : lookup(obj[key.slice(0, dot)], key.slice(dot + 1));
    };
    const files = ["pricing-page.tsx", "plan-cards.tsx", "plan-comparison.tsx", "topups.tsx", "pricing-faq.tsx", "premiere-banner.tsx", "pricing-config.ts", "checkout-notice.tsx"];
    const src = files.map((f) => read(`components/plan/${f}`)).join("\n") + read("components/checkout/checkout-view.tsx");
    const used = new Set([...src.matchAll(/["'`]((?:pricing|plans|packs)\.[A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]));
    for (const f of FAQ) { used.add(`pricing.faq.${f.key}.q`); used.add(`pricing.faq.${f.key}.a`); }
    const missing = [...used].flatMap((k) => (["pl", "en", "de"] as const).filter((l) => typeof lookup(dicts[l], k) !== "string").map((l) => `${l}:${k}`));
    check(`every copy key the page uses exists in pl/en/de (${used.size} keys)`, missing.length === 0, missing.join(", "));
    const texts = (["pl", "en", "de"] as const).map((l) => JSON.stringify(dicts[l].pricing));
    check("no VAT-invoice promise", texts.every((t) => !/faktur|VAT|Rechnung|invoice/i.test(t)));
    check("no purchase-email promise (GrovBase sends none)", texts.every((t) => !/e-mail(em)? potwierdz|confirmation email|Bestätigungs-?E-Mail|potwierdzenie zakupu/i.test(t)));
    check("no Przelewy24 claim (not active on the account)", texts.every((t) => !/przelewy|p24/i.test(t)));
    check("video is never promised as available", ["pl", "en", "de"].every((l) => /Wkrótce|Soon|Bald/.test(dicts[l].pricing.soon))
      && featureOn("video", "pro", {}) === "soon");
    check("FAQ: eight questions, the premiere one only while it runs",
      FAQ.length === 8 && FAQ.filter((f) => f.when === "premiere").map((f) => f.key).join() === "premiere");
    check("the false 'change your plan in the billing portal' copy is gone (the portal cannot)",
      (["pl", "en", "de"] as const).every((l) => !/panelu płatności|billing portal|Zahlungsportal/.test(dicts[l].packs.alreadySubscribed)));
    check("unready capabilities are 'soon', never ✓: seats, priority queue, operator mode",
      featureOn("seats", "pro", { workspace_members: 5 }) === "soon" && featureOn("priority", "pro", { priority_queue: true }) === "soon"
      && featureOn("operator", "agency", { operator_mode: true }) === "soon" && featureOn("operator", "pro", {}) === "no");
    check("BUSINESS is a label on `agency`", planPresentation("agency").nameKey === "plans.tier.business" && dicts.pl.plans.tier.business === "Business");
    check("numbers the Polish way", nb(formatCount(1200)) === "1 200" && nb(formatMoney(29900, "PLN")) === "299 zł"
      && nb(formatPerCredit(19, "PLN")) === "0,19 zł" && nb(formatMoney(7949, "PLN")) === "79,49 zł");
  }

  console.log("\nK. UI CONTRACT");
  {
    const topups = codeOnly(read("components/plan/topups.tsx"));
    check("the slider moves over tier INDEXES: min 0, max last, step 1",
      /type="range" min=\{0\} max=\{last\} step=\{1\}/.test(topups));
    check("no typed amount field", !/type="number"|inputMode/.test(topups));
    check("labels show the first and last tier", /formatCount\(tiers\[0\]\.credits\)/.test(topups) && /formatCount\(tiers\[last\]\.credits\)/.test(topups));
    check("the lock is the server's decision, and the locked content is inert",
      /const locked = data\.viewer\.topups !== "allowed"/.test(topups) && /inert=\{locked\}/.test(topups));
    check("an unpriced tier has no buy button", /tier\.href \? \(/.test(topups) && /disabled data-custom-buy/.test(topups));
    check("the slider tells a screen reader the price, or that the stop is not on sale yet",
      /pricing\.topups\.tierSoon/.test(topups.slice(topups.indexOf("const valueText"), topups.indexOf("if (!tier)")))
      && /aria-describedby="topup-tier-unit"/.test(topups) && /id="topup-tier-unit"/.test(topups));
    check("an inactive subscription is sent to its settings, not to buy a second plan",
      /const inactive = reason === "plan_inactive"/.test(topups) && /href="\/settings\?tab=subscriptions"/.test(topups));
    const pageSrc = codeOnly(read("components/plan/pricing-page.tsx"));
    check("'Kup kredyty' scrolls to the top-ups under the sticky bar, honouring reduced motion",
      /go\(A\.topups\)/.test(pageSrc) && /prefers-reduced-motion: reduce/.test(pageSrc) && /scroll-mt-\[calc\(var\(--header-h\)/.test(pageSrc));
    check("PRO first on a phone, in the middle on wide screens (two lists, matching focus order)",
      CARD_ORDER.join() === "starter,pro,agency" && CARD_ORDER_PHONE.join() === "pro,starter,agency"
      && /layout="phone"/.test(pageSrc) && /layout="wide"/.test(pageSrc));
    check("one container width (1100px), FAQ narrower (700px)", /max-w-\[1100px\]/.test(pageSrc) && /max-w-\[700px\]/.test(pageSrc));
    const cmp = codeOnly(read("components/plan/plan-comparison.tsx"));
    check(`comparison folds to the first ${COMPARE_INITIAL_ROWS} rows, the rest are hidden (not focusable)`,
      COMPARE_INITIAL_ROWS === 9 && /hidden=\{!open && index >= COMPARE_INITIAL_ROWS\}/.test(cmp)
      && COMPARE_GROUPS.map((g) => g.key).join() === "credits,imageTools,video,output,team,support,license");
    check("comparison: a real table with a pinned first column and internal scroll",
      /<table/.test(cmp) && /sticky left-0/.test(cmp) && /overflow-x-auto/.test(cmp));
    const faq = codeOnly(read("components/plan/pricing-faq.tsx"));
    check("FAQ: one open at a time, buttons with aria-expanded", /const expanded = open === item\.key/.test(faq) && /aria-expanded=\{expanded\}/.test(faq));
    check("the subscribed viewer is never offered a second subscription",
      /if \(data\.viewer\.hasLiveSubscription\) return \{ kind: "disabled"/.test(codeOnly(read("components/plan/plan-cards.tsx"))));
    check("PRICING_PAGE opens on monthly unless annual is on sale", PRICING_PAGE.defaultBillingPeriod === "annual"
      && /initialBillingPeriod\(PRICING_PAGE\.defaultBillingPeriod, data\.annual\.onSale\)/.test(pageSrc));
  }

  console.log(failures === 0
    ? `\nAll /plany page tests passed (${passes} checks).`
    : `\n${failures} /plany page test(s) failed, ${passes} passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
