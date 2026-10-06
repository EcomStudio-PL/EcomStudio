/**
 * /plan — THE CENNIK REDESIGN MAY CHANGE HOW PRICES LOOK, NEVER WHAT IS CHARGED.
 *
 * The 2026-10 redesign rewrote components/plan/pricing-board.tsx and moved the
 * page's arithmetic into components/plan/pricing-model.ts. This suite is the
 * gate that says the money did not move with it:
 *
 *   A. THE MONEY PATH IS FROZEN. Every file between a buy button and Stripe —
 *      the /checkout page and its URL parser, the server quote, the actions,
 *      the rate card, the webhook, the Stripe client — hashes exactly as it
 *      did before the redesign (2fea8e5). A deliberate server change must
 *      update these pins consciously; an accidental one fails here.
 *   B. SAME INTENTS. For every production plan, period, pack and every custom
 *      amount the page can produce, the new link is byte-for-byte the link
 *      the old board built.
 *   C. DISPLAYED = QUOTED. Each link is parsed the way /checkout parses it and
 *      priced by the REAL `quoteCheckout` (lib/server/checkout.ts) over the
 *      production catalogue: the server's amount, currency, Stripe Price,
 *      plan/pack id and credits equal what the page shows, to the grosz.
 *   D. ANNUAL is offered and charged only when a real annual price is stored.
 *   E. FREE is never a card and never for sale; BUSINESS is a label on `agency`.
 *   F. The presentation config holds no money; the copy promises nothing the
 *      checkout does not do; numbers are written the Polish way.
 *
 * No network, no database, no Stripe, no payment.
 *
 * Run:  npm run test:planpage
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// ASSEMBLED, NEVER WRITTEN OUT — a literal key shape would trip the repo-wide
// secret scan in scripts/stripe-tests.ts (same convention as billing-sync-tests).
process.env.STRIPE_SECRET_KEY ??= ["sk", "test", "0".repeat(28)].join("_");
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_ZmFrZV90ZXN0X3NlY3JldF9ub3RfYV9yZWFsX29uZQ";
process.env.GROVBASE_SERVER_KEY ??= "test-server-key-not-a-real-one-0123456789";

import { quoteCheckout, type CheckoutRequest } from "@/lib/server/checkout";
import { creditLadder, validateCustomCredits } from "@/lib/plans/credit-price";
import { annualBillingAvailable, annualMonthlyCents } from "@/lib/plans/pricing";
import { parsePlanCapabilities } from "@/lib/plans/capabilities";
import {
  annualOnOffer, annualSavingCents, buyCreditsLabel, clampCredits, coinLevel, committedCredits, creditsWord, creditMultiple, creditsCheckoutHref, customQuote, customRange,
  formatCount, formatMoney, formatPerCredit, initialBillingPeriod, isPaidPlan, nextStepHint,
  packCheckoutHref, packLadder, packQuote, planCheckoutHref, planMonthlyCents, planPerCreditCents,
  referenceRate, sliderMarks,
} from "@/components/plan/pricing-model";
import {
  COMING_SOON_CAPABILITIES, FALLBACK_PLAN, PLAN_PRESENTATION, PRICING_PAGE, SERVICE_LEVELS, isComingSoon, planPresentation,
} from "@/components/plan/pricing-config";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passes += 1; console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
}
const read = (p: string) => readFileSync(p, "utf8");
/** Source with comments stripped, so a check never matches a comment. */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/* ── the production catalogue, as PROD held it on 2026-10-06 ──────────────*/
// Prices, credits, capabilities, flags and Stripe ids are PROD's. Pack ids are
// PROD's; plan ids are stand-ins (any stable id works — the link carries it).

type PlanRow = {
  id: string; slug: string; name: string; description: string | null;
  price_cents: number; annual_price_cents: number; currency: string;
  monthly_credits: number; bonus_credits: number; featured: boolean; active: boolean; sort_order: number;
  features: Record<string, number | boolean>;
  stripe_price_id_monthly: string | null; stripe_price_id_annual: string | null;
  stripe_price_monthly_cents: number | null; stripe_price_annual_cents: number | null;
  stripe_sync_status: string;
};
type PackRow = {
  id: string; name: string; description: string | null; credits: number; bonus_credits: number;
  price_cents: number; currency: string; featured: boolean; badge: string | null; active: boolean; sort_order: number;
  stripe_price_id: string | null; stripe_price_cents: number | null; stripe_sync_status: string;
};

const PROD_PLANS: PlanRow[] = [
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

const PROD_PACKS: PackRow[] = [
  { id: "f86d4f98-14bb-45e6-a867-5700fc7baf65", name: "Start", description: null, credits: 100, bonus_credits: 0,
    price_cents: 1900, currency: "PLN", featured: false, badge: null, active: true, sort_order: 0,
    stripe_price_id: "price_1UIFY7POBRMZKbwYbmcEKrBA", stripe_price_cents: 1900, stripe_sync_status: "synced" },
  { id: "69f5fc50-5328-4ee6-b5f8-4ce1014c1aad", name: "Standard", description: null, credits: 500, bonus_credits: 50,
    price_cents: 7900, currency: "PLN", featured: true, badge: "Najpopularniejszy", active: true, sort_order: 1,
    stripe_price_id: "price_1UIFYAPOBRMZKbwYYpqxc1ou", stripe_price_cents: 7900, stripe_sync_status: "synced" },
  { id: "d5e9b0d0-9497-4511-b66f-82a808751c8b", name: "Pro", description: null, credits: 1000, bonus_credits: 150,
    price_cents: 13900, currency: "PLN", featured: false, badge: null, active: true, sort_order: 2,
    stripe_price_id: "price_1UIFYGPOBRMZKbwYUO5EZGYF", stripe_price_cents: 13900, stripe_sync_status: "synced" },
  { id: "f0e44f7c-9768-48e6-b753-79544fb3646d", name: "Business", description: null, credits: 2500, bonus_credits: 500,
    price_cents: 29900, currency: "PLN", featured: false, badge: "Najlepsza wartość", active: true, sort_order: 3,
    stripe_price_id: "price_1UIFYJPOBRMZKbwYn7csVnEN", stripe_price_cents: 29900, stripe_sync_status: "synced" },
];

/**
 * The cards the page builds from those rows — the SAME field mapping as
 * app/(app)/plan/page.tsx (section J pins the page's mapping lines verbatim).
 */
const toPlanCard = (p: PlanRow) => ({
  id: p.id, slug: p.slug, name: p.name, description: p.description,
  priceCents: p.price_cents, annualPriceCents: p.annual_price_cents ?? 0, currency: p.currency,
  monthlyCredits: p.monthly_credits, bonusCredits: p.bonus_credits,
  capabilities: parsePlanCapabilities(p.features), featured: p.featured,
  monthlyMapped: Boolean(p.stripe_price_id_monthly), annualMapped: Boolean(p.stripe_price_id_annual),
});
const toPackCard = (p: PackRow) => ({
  id: p.id, name: p.name, credits: p.credits, bonusCredits: p.bonus_credits,
  priceCents: p.price_cents, currency: p.currency, featured: p.featured, badge: p.badge,
  mapped: Boolean(p.stripe_price_id),
});
type PackCard = ReturnType<typeof toPackCard>;

/* ── a catalogue that answers the server's reads, the way Postgres would ──*/

type Row = Record<string, unknown>;
function catalogueDb(plans: PlanRow[], packs: PackRow[]) {
  const build = (rows: Row[]) => {
    const filters: Record<string, unknown> = {};
    const matching = () => rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => { filters[col] = val; return q; },
      order: () => q,
      in: () => q,
      limit: () => Promise.resolve({ data: matching(), error: null }),
      maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
      then: (res: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: matching(), error: null }).then(res),
    };
    return q;
  };
  return {
    from: (name: string) => build(
      name === "credit_packages" ? packs as unknown as Row[]
        : name === "subscription_plans" ? plans as unknown as Row[]
          : [],
    ),
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never;
}
const WS = { id: "ws-0000", name: "Test Workspace" } as never;

/**
 * /checkout's own URL → request rule, restated (the page itself is frozen by
 * hash in section A, so this copy cannot silently diverge from it).
 */
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

/* ── the OLD board's links, verbatim from components/plan/pricing-board.tsx @ 2fea8e5 ─*/
const OLD = {
  plan: (id: string, annual: boolean) => `/checkout?kind=subscription&plan=${id}&period=${annual ? "annual" : "monthly"}`,
  pack: (id: string) => `/checkout?kind=package&pack=${id}`,
  credits: (n: number) => `/checkout?kind=credits&n=${n}`,
};

async function main() {
  console.log("\nA. THE MONEY PATH IS FROZEN (sha256 vs 2fea8e5)");
  {
    const FROZEN: [string, string][] = [
      ["lib/server/checkout.ts", "a821fd4514e04b5cf566a49dcd5bb25343e2325c17f49b888a047ce85f096468"],
      ["app/actions/checkout.ts", "9b8ab0caa75e32de658126353fb731d431f006bf83839f456057a54b33a659bd"],
      ["app/(app)/checkout/page.tsx", "2fca9f8520c44682ebc3669a497ef31a0a0b3b2957f40284359d14c72f31a8c8"],
      ["lib/plans/credit-price.ts", "c3ebca6452053a0157eee7bf0fd8c1bdc767593f2e082941951ba02b30aff95c"],
      ["lib/plans/pricing.ts", "6c6ddf4d5784f236eaff740efed5bc23538b2ce44118b92cf9f24b5df2e1c3fa"],
      ["lib/plans/capabilities.ts", "d60ae58bcea9ba6747bb6a3ca978e36a527696b14045b80f33d2930651f19ca6"],
      ["lib/server/stripe-webhook.ts", "e9a03ea46af4bb7d5c91332969154e4b111b4c1634fbbe124a1ba6b8e03c95d2"],
      ["lib/server/billing.ts", "55c3236a0890b39c8ea15493d9ddad2801eb34ebf76fdf1854b4b1d3dfa45ec3"],
      ["app/actions/billing.ts", "f9feeb8aad93a24806a1de1e0fbd9a3ab929c055cce382e3436f9700e4d862c2"],
      ["lib/server/stripe-pricing.ts", "41573ba733ba26854abed17270fbf310433ae16d9425acc2a176dd0b8c395efe"],
      ["lib/stripe/config.ts", "0679ce3f018add12ead081c8a667511be4237661d15b9a024fb9ec578ed71df1"],
      ["lib/stripe/client.ts", "76df572faae6b3f032010a538385f4c2fd6e18b0d63e294646bd0ae42e97a9b4"],
      ["lib/stripe/signature.ts", "722af66f1fa0c1c11ced6d49d37d6bb18090e72df249290c8dca08b00b44b0b8"],
      ["lib/stripe/capabilities.ts", "d346fde51068e2a67dac2827b986525caf9a73f69d3fd7302d532df120f59cf7"],
      ["lib/stripe/publishable.ts", "84949ccf2061c66ebeb334e2529b3465a9dc3a7eb85ef18b16f30a6bcf8fa0bd"],
      ["components/checkout/checkout-view.tsx", "e1eabb3c572cf66df533cc90b8425e82514c1407bd419699e03182a1fe783495"],
      ["app/api/hooks/stripe/route.ts", "12d6aa79017034b0cd8d50ee60bc946541db2eede3aa60508fbf663dfe1c3362"],
      ["components/plan/checkout-notice.tsx", "a7c5a455369ccb2bd99bdab0a5a8779f0c07f8d9b176f32bfd93f9315c0f2813"],
      ["components/plan/billing-portal-button.tsx", "75ba0ace8f08d0f5f3cd9363f253a687338af672f1deb47958912f208ba04005"],
    ];
    for (const [file, sha] of FROZEN) {
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      check(`${file} unchanged`, actual === sha, `sha256 ${actual.slice(0, 16)}… ≠ pinned ${sha.slice(0, 16)}…`);
    }
  }

  const plans = PROD_PLANS.map(toPlanCard);
  const packs = PROD_PACKS.map(toPackCard);
  const paid = plans.filter(isPaidPlan);
  const ladder = packLadder(packs);
  const range = customRange(ladder)!;
  const db = catalogueDb(PROD_PLANS, PROD_PACKS);
  const quote = async (href: string) => {
    const req = parseIntent(href);
    if (!req) return { ok: false as const, reason: "unparsable" };
    return quoteCheckout(db, WS, req);
  };

  console.log("\nB. SAME INTENTS AS THE OLD BOARD");
  {
    for (const p of paid) {
      check(`${p.slug} monthly link unchanged`, planCheckoutHref(p.id, "monthly") === OLD.plan(p.id, false));
      check(`${p.slug} annual link unchanged`, planCheckoutHref(p.id, "annual") === OLD.plan(p.id, true));
    }
    for (const p of packs) check(`pack ${p.name} link unchanged`, packCheckoutHref(p.id) === OLD.pack(p.id));
    let same = 0;
    let total = 0;
    for (let n = range.min; n <= range.max; n += range.step) {
      total += 1;
      if (creditsCheckoutHref(n) === OLD.credits(n)) same += 1;
    }
    check(`custom-credit links unchanged for all ${total} slider stops`, same === total && total > 0, `${same}/${total}`);
    check("links carry intents only — no amount, price or currency",
      [...paid.map((p) => planCheckoutHref(p.id, "monthly")), ...packs.map((p) => packCheckoutHref(p.id)), creditsCheckoutHref(550)]
        .every((h) => !/amount|price|cents|currency|zl|pln/i.test(h)));
    check("plan links name the row id, never the slug or the display label",
      paid.every((p) => planCheckoutHref(p.id, "monthly").includes(`plan=${p.id}`))
      && !paid.some((p) => /agency|business/i.test(planCheckoutHref(p.id, "monthly"))));
  }

  console.log("\nC. DISPLAYED = QUOTED BY THE REAL SERVER (production catalogue)");
  {
    // C1 — plans, monthly.
    for (const p of paid) {
      const row = PROD_PLANS.find((r) => r.id === p.id)!;
      const shown = planMonthlyCents(p, "monthly");
      const q = await quote(planCheckoutHref(p.id, "monthly"));
      check(`${p.slug}: shown ${formatMoney(shown, p.currency)} = quoted`,
        q.ok && q.quote.amountCents === shown && formatMoney(q.quote.amountCents, q.quote.currency) === formatMoney(shown, p.currency),
        JSON.stringify(q));
      check(`${p.slug}: same Stripe Price, plan id, period, currency, credits`,
        q.ok && q.quote.stripePriceId === row.stripe_price_id_monthly && q.quote.planId === row.id
        && q.quote.period === "monthly" && q.quote.recurring === true && q.quote.currency === "PLN"
        && q.quote.credits === p.monthlyCredits + p.bonusCredits);
    }
    // Pinned as literals, so the expectation is not computed by the code under test.
    const PLAN_PRICES: Record<string, string> = { starter: "99 zł", pro: "299 zł", agency: "999 zł" };
    for (const p of paid) {
      check(`${p.slug} card reads ${PLAN_PRICES[p.slug]}`,
        formatMoney(planMonthlyCents(p, "monthly"), p.currency).replace(/\s/g, " ") === PLAN_PRICES[p.slug]);
    }

    // C2 — every pack, through ONE parity predicate (C6 proves it can fail).
    type PackQ = Awaited<ReturnType<typeof quote>>;
    const packParity = (card: PackCard, q: PackQ): boolean => {
      const row = PROD_PACKS.find((r) => r.id === card.id);
      return Boolean(row) && q.ok && q.quote.amountCents === card.priceCents
        && q.quote.stripePriceId === row!.stripe_price_id && q.quote.packageId === row!.id
        && q.quote.credits === card.credits + card.bonusCredits && q.quote.currency === card.currency;
    };
    for (const p of packs) {
      const q = await quote(packCheckoutHref(p.id));
      check(`pack ${p.name}: shown ${formatMoney(p.priceCents, p.currency)} = quoted, same Price / pack / credits`,
        packParity(p, q), JSON.stringify(q));
      check(`pack ${p.name}: the quote the row shows is its own price`, packQuote(p, referenceRate(ladder)).cents === p.priceCents);
    }

    // C3 — every custom amount the slider can land on, plus typed values.
    const samples = [100, 101, 150, 250, 333, 549, 550, 551, 777, 800, 1000, 1149, 1150, 1151, 1600, 2000, 2500, 2999, 3000];
    const amounts = new Set<number>(samples);
    for (let n = range.min; n <= range.max; n += range.step) amounts.add(n);
    let agree = 0;
    const mismatches: string[] = [];
    for (const n of amounts) {
      const shown = customQuote(n, ladder);
      const q = await quote(creditsCheckoutHref(n));
      const server = validateCustomCredits(n, creditLadder(PROD_PACKS));
      if (q.ok && server.ok && q.quote.amountCents === shown.cents && server.amountCents === shown.cents
        && q.quote.credits === n && q.quote.stripePriceId === null && q.quote.currency === "PLN") agree += 1;
      else mismatches.push(`${n}: shown ${shown.cents} / quote ${q.ok ? q.quote.amountCents : q.reason}`);
    }
    check(`custom amounts: shown = quoted = validateCustomCredits for all ${amounts.size}`,
      agree === amounts.size, mismatches.slice(0, 5).join("; "));
    // Literal pins — the production rate card, written out by hand.
    const PINS: [number, number][] = [[100, 1900], [150, 2600], [550, 7900], [777, 10200], [1150, 13900],
      [1600, 17800], [2000, 21300], [2500, 25600], [3000, 29900]];
    for (const [n, cents] of PINS) {
      check(`${formatCount(n)} kredytów → ${formatMoney(cents, "PLN")}`, customQuote(n, ladder).cents === cents);
    }

    // C4 — what a typed value becomes before it can reach a link.
    for (const raw of [99, 3001, 0, -5, 777.4, Number.NaN, 1e9, Number.POSITIVE_INFINITY]) {
      const v = clampCredits(raw, range, 550);
      const q = await quote(creditsCheckoutHref(v));
      check(`typed ${String(raw)} → ${v}: a whole number in range the server accepts`,
        Number.isSafeInteger(v) && v >= range.min && v <= range.max && q.ok);
    }
    const unclamped = await quote(creditsCheckoutHref(3001));
    check("…and an UNclamped out-of-range value would be refused (so the clamp is load-bearing)",
      !unclamped.ok && unclamped.reason === "invalid_credits");

    // C5 — the board only ever links the clamped / slider / ladder value.
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the board builds every checkout link with the shared helpers",
      /planCheckoutHref\(p\.id, period\)/.test(board) && /packCheckoutHref\(p\.id\)/.test(board)
      && /creditsCheckoutHref\(credits\)/.test(board) && !/\/checkout\?/.test(board));
    const setters = [...board.matchAll(/setCredits\(([^;]+?)\);/g)].map((m) => m[1].trim());
    const allowed = [/^Number\(e\.target\.value\)$/, /^n$/, /^committedCredits\(raw, range, credits\)$/, /^hint\.at$/];
    check("every way `credits` is set is slider / validated typed / clamped / a ladder point",
      setters.length >= 4 && setters.every((s) => allowed.some((r) => r.test(s))), setters.join(" | "));
    check("a typed value is applied live only when it is a whole number in range",
      /Number\.isInteger\(n\) && n >= min && n <= max\) setCredits\(n\)/.test(board));
    check("…and committed through committedCredits", /setCredits\(committedCredits\(raw, range, credits\)\)/.test(board));
    // What a committed (blur / Enter) entry becomes: a cleared or junk field
    // keeps the last amount — it must not fall to the minimum.
    const COMMITS: [string, number][] = [["", 777], ["   ", 777], ["abc", 777], ["12.5", 777], ["1e2", 100],
      ["1 200", 1200], ["5000", 3000], ["12", 100], ["-40", 100], ["0", 100], ["550", 550]];
    for (const [raw, want] of COMMITS) {
      const got = committedCredits(raw, range, 777);
      check(`commit ${JSON.stringify(raw)} (from 777) → ${want}`, got === want, String(got));
    }
    check("the custom quote is the shared one (priceForCredits through customQuote)",
      /customQuote\(credits, ladder\)/.test(board)
      && /priceForCredits\(credits, ladder\)/.test(codeOnly(read("components/plan/pricing-model.ts"))));
    check("the slider ladder is built from ALL active packs the page received",
      /packLadder\(packs\)/.test(board) && !/packs\.filter\(/.test(board));

    // C6 — the predicate C2 relies on is not vacuous: the original card
    // passes it, and every single-field drift fails it.
    const base = packs[1];
    const q = await quote(packCheckoutHref(base.id));
    check("self-check: the untouched card passes the parity predicate", packParity(base, q));
    const drifts: [string, PackCard][] = [
      ["+1 gr price", { ...base, priceCents: base.priceCents + 1 }],
      ["+1 credit", { ...base, credits: base.credits + 1 }],
      ["+1 bonus", { ...base, bonusCredits: base.bonusCredits + 1 }],
      ["currency", { ...base, currency: "EUR" }],
    ];
    for (const [what, card] of drifts) {
      check(`self-check: a ${what} drift fails the parity predicate`, !packParity(card, q));
    }
  }

  console.log("\nD. ANNUAL — ONLY WHEN A REAL ANNUAL PRICE IS STORED");
  {
    check("production: annual billing is not available", !annualBillingAvailable(plans));
    check("production: the page opens on monthly although the config prefers annual",
      PRICING_PAGE.defaultBillingPeriod === "annual"
      && initialBillingPeriod(PRICING_PAGE.defaultBillingPeriod, annualBillingAvailable(plans)) === "monthly");
    for (const p of paid) {
      const q = await quote(planCheckoutHref(p.id, "annual"));
      check(`production: a forced annual ${p.slug} checkout is refused`, !q.ok && q.reason === "not_mapped");
    }
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the board's figures follow the derived period (monthly unless annual is real)",
      /const active: BillingPeriod = annualAvailable \? period : "monthly"/.test(board)
      && /initialBillingPeriod\(PRICING_PAGE\.defaultBillingPeriod, annualAvailable\)/.test(board));
    check("the billing control renders only when annual is available", /\{annualAvailable && \(/.test(board));
    check("annual is offered only with stored yearly prices AND Stripe annual Prices",
      /const annualAvailable = useMemo\(\(\) => annualOnOffer\(plans\), \[plans\]\)/.test(board));
    check("production: annual is not on offer", !annualOnOffer(plans));

    // A catalogue with annual prices set on every paid plan.
    const ANNUAL: Record<string, [number, string]> = {
      starter: [95040, "price_annual_starter"], pro: [287040, "price_annual_pro"], agency: [959040, "price_annual_agency"],
    };
    const annualPlans = PROD_PLANS.map((p) => (ANNUAL[p.slug] ? {
      ...p, annual_price_cents: ANNUAL[p.slug][0], stripe_price_id_annual: ANNUAL[p.slug][1],
      stripe_price_annual_cents: ANNUAL[p.slug][0],
    } : p));
    const aCards = annualPlans.map(toPlanCard);
    const aDb = catalogueDb(annualPlans, PROD_PACKS);
    check("annual catalogue: annual billing is available", annualBillingAvailable(aCards) && annualOnOffer(aCards));
    check("yearly prices without Stripe annual Prices are NOT on offer",
      !annualOnOffer(aCards.map((c) => ({ ...c, annualMapped: false }))));
    check("…nor when a single paid plan lacks its annual Price",
      !annualOnOffer(aCards.map((c) => (c.slug === "pro" ? { ...c, annualMapped: false } : c))));
    check("annual catalogue: the page opens on annual",
      initialBillingPeriod(PRICING_PAGE.defaultBillingPeriod, true) === "annual");
    for (const p of aCards.filter(isPaidPlan)) {
      const req = parseIntent(planCheckoutHref(p.id, "annual"))!;
      const q = await quoteCheckout(aDb, WS, req);
      check(`annual ${p.slug}: charged the stored yearly total, shown ÷12, with the annual Price`,
        q.ok && q.quote.amountCents === p.annualPriceCents && q.quote.period === "annual"
        && q.quote.stripePriceId === ANNUAL[p.slug][1]
        && planMonthlyCents(p, "annual") === annualMonthlyCents(p) && planMonthlyCents(p, "annual") < p.priceCents,
        JSON.stringify(q));
      check(`annual ${p.slug}: "Oszczędzasz" = 12 × monthly − yearly`,
        annualSavingCents(p) === p.priceCents * 12 - p.annualPriceCents);
    }
    check("no annual price → no saving line", paid.every((p) => annualSavingCents(p) === null));
  }

  console.log("\nE. FREE IS NOT A CARD; BUSINESS IS A LABEL ON `agency`");
  {
    check("the free plan is not a paid card", plans.filter(isPaidPlan).every((p) => p.slug !== "free"));
    check("three paid cards, in the database order", paid.map((p) => p.slug).join(",") === "starter,pro,agency");
    const freeRow = PROD_PLANS.find((p) => p.slug === "free")!;
    const q = await quote(planCheckoutHref(freeRow.id, "monthly"));
    check("a forced free checkout is refused", !q.ok && q.reason === "plan_not_purchasable");
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the board renders cards for paid plans only",
      /const paid = useMemo\(\(\) => plans\.filter\(isPaidPlan\)/.test(board) && /paid\.map\(\(p\) => \(\s*<PlanColumn/.test(board));
    check("the Free notice reads the free row's own name and credits",
      /t\("plans\.currentFree", \{ name: free\.name, n: formatCount\(free\.monthlyCredits \+ free\.bonusCredits\) \}\)/.test(board));
    check("…and shows only to a workspace on the free plan",
      /const onFree = free !== null && currentSlug === free\.slug/.test(board) && /\{onFree && free && \(/.test(board));
    check("the current plan's card says so and does not sell", /isCurrent\s*\?\s*t\("plans\.current"\)/.test(board)
      && /const canBuy = payable && !isCurrent/.test(board));
    check("`agency` is displayed through a label key", planPresentation("agency").nameKey === "plans.tier.business");
    check("the card keeps the internal slug as its identity", /data-plan=\{p\.slug\}/.test(board));
    // Capabilities with no consumer in the app are "Wkrótce", never ✓.
    check("seats, priority queue and operator mode are listed as not yet running",
      ["workspace_members", "priority_queue", "operator_mode"].every(isComingSoon) && COMING_SOON_CAPABILITIES.length === 3);
    check("card rows carrying such a capability are marked soon, not ✓",
      /soon: r\.on && isComingSoon\(CAPABILITY_OF_ROW\[r\.key\] \?\? ""\)/.test(board)
      && /seats: "workspace_members", priority: "priority_queue", operator: "operator_mode"/.test(board)
      && /data-on=\{\(r\.on && !r\.soon\) \|\| undefined\}/.test(board));
    check("comparison cells for them go through the same switch",
      /soonFlag\(p\.capabilities\.priority_queue, "priority_queue"\)/.test(board)
      && /soonFlag\(p\.capabilities\.operator_mode, "operator_mode"\)/.test(board)
      && /isComingSoon\("workspace_members"\) \? \{ soon: seatLabel\(s, t\) \}/.test(board));
    const pl = JSON.parse(read("lib/i18n/dictionaries/pl.json"));
    check("PL label for agency is BUSINESS (rendered uppercase)", pl.plans.tier.business === "Business");
    check("starter/pro keep their database names (no override)",
      !PLAN_PRESENTATION.starter.nameKey && !PLAN_PRESENTATION.pro.nameKey);
    check("an unknown slug falls back instead of breaking", planPresentation("enterprise-x") === FALLBACK_PLAN);
    check("PRO's benefit is division of stored credits (4× Starter)",
      creditMultiple(paid[1], paid[0]) === 4 && creditMultiple(paid[0], paid[0]) === null);
    check("per-credit on a plan is price ÷ credits",
      Math.abs((planPerCreditCents(paid[1], "monthly") ?? 0) - 29900 / 1200) < 1e-9);
  }

  console.log("\nF. CONFIG HOLDS NO MONEY; COPY PROMISES NOTHING THE CHECKOUT DOES NOT DO");
  {
    const config = codeOnly(read("components/plan/pricing-config.ts"));
    check("pricing-config.ts holds no price, credit amount, discount or Stripe id",
      !/(price|cents|credits|amount|discount|percent|stripe)\w*\s*:\s*-?\d/i.test(config)
      && !/price_[0-9A-Za-z]{6,}/.test(config));
    check("service levels are words, not money",
      Object.values(SERVICE_LEVELS).every((s) => typeof s.supportKey === "string" && typeof s.commercialUse === "boolean"));
    const sources = codeOnly(read("components/plan/pricing-board.tsx")) + config;
    const used = new Set([...sources.matchAll(/["'`]((?:plans|packs|features)\.[A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]));
    const dicts = Object.fromEntries((["pl", "en", "de"] as const).map((l) => [l, JSON.parse(read(`lib/i18n/dictionaries/${l}.json`))]));
    // Mirrors lib/i18n/t.ts: at each level the REST of the path is tried as a
    // flat dotted key first ("row.credits"), then the nesting is walked.
    const lookup = (d: unknown, key: string): unknown => {
      if (typeof d !== "object" || d === null) return undefined;
      const obj = d as Record<string, unknown>;
      if (key in obj) return obj[key];
      const dot = key.indexOf(".");
      return dot < 0 ? undefined : lookup(obj[key.slice(0, dot)], key.slice(dot + 1));
    };
    const missing = [...used].flatMap((k) => (["pl", "en", "de"] as const).filter((l) => typeof lookup(dicts[l], k) !== "string").map((l) => `${l}:${k}`));
    check(`every copy key the page uses exists in pl/en/de (${used.size} keys)`, missing.length === 0, missing.join(", "));
    const promises = [...used].filter((k) => /faktur|VAT|Rechnung|invoice/i.test(String(lookup(dicts.pl, k)) + String(lookup(dicts.en, k))));
    check("no VAT-invoice promise on /plan — the checkout issues none", promises.length === 0, promises.join(", "));
    check("no invented annual offer copy (plans.annualNote) and no '~N ujęć' approximation (plans.approx)",
      !used.has("plans.annualNote") && !used.has("plans.approx"));
    check("the strike-through basis is stated under the packs",
      /packs\.referenceBasis/.test(sources) && /formatPerCredit\(rate, currency\)/.test(sources));

    // Polish numbers, written the way a price list writes them.
    const nb = (s: string) => s.replace(/[  ]/g, " ");
    check("1200 → \"1 200\"", nb(formatCount(1200)) === "1 200");
    check("5000 → \"5 000\"", nb(formatCount(5000)) === "5 000");
    check("29900 gr → \"299 zł\"", nb(formatMoney(29900, "PLN")) === "299 zł");
    check("7949 gr → \"79,49 zł\" (grosze shown when there are grosze)", nb(formatMoney(7949, "PLN")) === "79,49 zł");
    check("0,19 zł per credit", nb(formatPerCredit(19, "PLN")) === "0,19 zł");
    check("~0,25 zł per credit on PRO", nb(formatPerCredit(planPerCreditCents(paid[1], "monthly")!, "PLN")) === "0,25 zł");
    check("99 900 gr → \"999 zł\"", nb(formatMoney(99900, "PLN")) === "999 zł");
  }

  console.log("\nG. PACKS, BEST VALUE, THE NEXT STEP UP");
  {
    const rate = referenceRate(ladder);
    check("the reference rate is the smallest pack's (0,19 zł per credit)", rate === 19);
    const quotes = packs.map((p) => ({ p, q: packQuote(p, rate) }));
    const best = [...quotes].sort((a, b) => a.q.perCredit - b.q.perCredit)[0];
    check("BEST VALUE = lowest price per credit = the 2 500 + 500 pack",
      best.p.credits === 2500 && best.p.bonusCredits === 500);
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the board computes BEST VALUE from price per credit, not from a flag",
      /per <= best\.priceCents \/ \(best\.credits \+ best\.bonusCredits\)/.test(board));
    check("−48% on the 2 500 + 500 pack, struck 570 zł", best.q.offPct === 48 && best.q.referenceCents === 57000);
    check("the smallest pack shows no discount and no struck price",
      quotes.find((x) => x.p.credits === 100)!.q.offPct === 0 && quotes.find((x) => x.p.credits === 100)!.q.referenceCents === null);
    const hint = nextStepHint(550, ladder);
    check("at 550: \"add 600 to get −36%\" (the next pack point)", hint?.add === 600 && hint.offPct === 36 && hint.at === 1150, JSON.stringify(hint));
    check("at 3 000: no next step", nextStepHint(3000, ladder) === null);
    check("hints only point at real rate-card points",
      [100, 300, 550, 900, 2000].every((n) => { const h = nextStepHint(n, ladder); return !h || ladder.some((s) => s.credits === h.at); }));
    const marks = sliderMarks(ladder);
    check("slider marks sit on the four pack points, 0–100 %",
      marks.map((m) => m.at).join(",") === "100,550,1150,3000" && marks[0].pct === 0 && marks[3].pct === 100);
    check("coin stacks grow 1 → 5 with pack size",
      [0, 1, 2, 3].map((i) => coinLevel(i, 4)).join(",") === "1,2,4,5");
    check("the custom slider steps in the server's step (50) from 100 to 3 000",
      range.min === 100 && range.max === 3000 && range.step === 50);
    // Polish plural for the amount — typed amounts can end in 2-4.
    const plDict = JSON.parse(read("lib/i18n/dictionaries/pl.json"));
    const tPl = (key: string, vars?: Record<string, string | number>) => {
      const [ns, ...rest] = key.split(".");
      let out = String(plDict[ns][rest.join(".")]);
      for (const [k, v] of Object.entries(vars ?? {})) out = out.replace(`{${k}}`, String(v));
      return out;
    };
    const FORMS: [number, string][] = [[550, "kredytów"], [1152, "kredyty"], [104, "kredyty"], [112, "kredytów"],
      [1000, "kredytów"], [3000, "kredytów"], [2523, "kredyty"]];
    for (const [n, word] of FORMS) check(`${formatCount(n)} ${word}`, creditsWord(n, tPl) === word);
    check("the buy button agrees: \"Kup 1 152 kredyty\" / \"Kup 550 kredytów\"",
      buyCreditsLabel(1152, tPl).replace(/\s/g, " ") === "Kup 1 152 kredyty"
      && buyCreditsLabel(550, tPl) === "Kup 550 kredytów");
  }

  console.log("\nJ. /plan STILL FEEDS THE BOARD THE SAME ROWS");
  {
    const page = codeOnly(read("app/(app)/plan/page.tsx"));
    for (const [what, re] of [
      ["active plans by sort order", /from\("subscription_plans"\)\.select\("\*"\)\.eq\("active", true\)\.order\("sort_order"\)/],
      ["active packs by sort order", /from\("credit_packages"\)\.select\("\*"\)\.eq\("active", true\)\.order\("sort_order"\)/],
      ["plan price", /priceCents: p\.price_cents/],
      ["stored annual price", /annualPriceCents: p\.annual_price_cents \?\? 0/],
      ["capabilities through the shared parser", /capabilities: parsePlanCapabilities\(p\.features\)/],
      ["monthly Stripe mapping", /monthlyMapped: Boolean\(p\.stripe_price_id_monthly\)/],
      ["annual Stripe mapping", /annualMapped: Boolean\(p\.stripe_price_id_annual\)/],
      ["pack price + mapping", /priceCents: p\.price_cents, currency: p\.currency, featured: p\.featured, badge: p\.badge,\s*mapped: Boolean\(p\.stripe_price_id\)/],
      ["the server's payments flag", /paymentsEnabled=\{paymentsEnabled\(\)\}/],
      ["the checkout notice", /CheckoutNotice status=\{checkout\}/],
    ] as const) {
      check(`page.tsx: ${what}`, re.test(page));
    }
  }

  console.log(failures === 0
    ? `\nAll /plan page tests passed (${passes} checks).`
    : `\n${failures} /plan page test(s) failed, ${passes} passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
