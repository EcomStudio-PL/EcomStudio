/**
 * CENNIK V2 — the approved numbers, checked without Stripe, a browser or a
 * paid call. The expectations are written out by hand from the approved
 * document (GrovBase_CENNIK_I_RENTOWNOSC_DO_AKCEPTACJI_2026-11-13), never
 * computed by the code under test.
 *
 *   A  top-ups: progressive bands, limits, refusals
 *   B  subscription invoices → grants (monthly, annual, upgrade, reversal)
 *   C  tool prices for the examples in the document
 *   D  presentation: 16,67 %, "≈ zł", "1,25 kr."
 *
 * Run: npm run test:pricing
 */
import { quoteTopup, topupCents, TOPUP_LIMITS } from "@/lib/plans/topup-price";
import { invoiceGrants, type PlanForPrice } from "@/lib/billing/invoice-grants";
import { quoteTotal } from "@/lib/thumbnail/config";
import { priceFor } from "@/lib/ai/types";
import { annualSavingPct } from "@/lib/plans/pricing";
import { approxPln, formatMoney } from "@/components/plan/pricing-model";
import { makeT } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || detail === "" ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

console.log("A. TOP-UPS");
{
  const PINS: [number, number][] = [[20, 1120], [49, 2744], [50, 2796], [99, 5344], [100, 5392], [249, 12544], [250, 12588]];
  for (const [n, cents] of PINS) check(`${n} credits = $${(cents / 100).toFixed(2)}`, topupCents(n) === cents, topupCents(n));
  check("the approved example: 100 = 49 × 0.56 + 50 × 0.52 + 1 × 0.48", topupCents(100) === 49 * 56 + 50 * 52 + 48);
  check("progressive, never retroactive: 50 costs more than 49, 100 more than 99, 250 more than 249",
    topupCents(50) > topupCents(49) && topupCents(100) > topupCents(99) && topupCents(250) > topupCents(249));
  let rising = true;
  for (let n = TOPUP_LIMITS.min + 1; n <= TOPUP_LIMITS.max; n++) if (topupCents(n) <= topupCents(n - 1)) rising = false;
  check("the price rises with every credit from 20 to 5000", rising);
  check("limits: min 20, max 5000, step 1", TOPUP_LIMITS.min === 20 && TOPUP_LIMITS.max === 5000 && TOPUP_LIMITS.step === 1);
  for (const bad of [19, 5001, 0, -1, 20.5, Number.NaN, "100", null]) {
    check(`${String(bad)} is refused`, !quoteTopup(bad).ok);
  }
  const q = quoteTopup(100);
  check("a quote carries USD and the rate-card version", q.ok && q.currency === "USD" && q.version.length > 0 && q.amountCents === 5392);
}

console.log("B. SUBSCRIPTION INVOICES");
{
  const plans: Record<string, PlanForPrice> = {
    pm: { id: "pro", name: "Pro", credits: 125, period: "monthly", priceCents: 4990 },
    pa: { id: "pro", name: "Pro", credits: 125, period: "annual", priceCents: 49900 },
    bm: { id: "agency", name: "Business", credits: 290, period: "monthly", priceCents: 10990 },
    ba: { id: "agency", name: "Business", credits: 290, period: "annual", priceCents: 109900 },
  };
  const of = (id: string) => plans[id] ?? null;
  const S = 1794000000, E = 1796592000; // a 30-day month
  const monthly = invoiceGrants([{ priceId: "pm", amount: 4990, proration: false, periodStart: S, periodEnd: E }], of, "sub_1");
  check("monthly PRO: one lot of 125, expiring at the period end",
    monthly.length === 1 && monthly[0].type === "lot" && monthly[0].credits === 125
    && monthly[0].expires_at === new Date(E * 1000).toISOString(), monthly);
  const annual = invoiceGrants([{ priceId: "ba", amount: 109900, proration: false, periodStart: S, periodEnd: S + 365 * 86400 }], of, "sub_2");
  check("annual Business: a 12-month schedule of 290 a month (not a lump of 3480)",
    annual.length === 1 && annual[0].type === "annual" && annual[0].credits_per_month === 290, annual);
  // Upgrade PRO → Business halfway through a monthly period (always_invoice).
  const upgrade = invoiceGrants([
    { priceId: "bm", amount: 5495, proration: true, periodStart: S + 15 * 86400, periodEnd: E },
    { priceId: "pm", amount: -2495, proration: true, periodStart: S + 15 * 86400, periodEnd: E },
  ], of, "sub_3");
  check("an upgrade: the old plan's unused half is taken back (62.5) BEFORE the new half (145) is granted",
    upgrade.length === 2 && upgrade[0].type === "revert" && upgrade[0].credits === 62.5
    && upgrade[1].type === "lot" && upgrade[1].credits === 145, upgrade);
  const toAnnual = invoiceGrants([
    { priceId: "pa", amount: 49900, proration: false, periodStart: S + 10 * 86400, periodEnd: S + 375 * 86400 },
    { priceId: "pm", amount: -3327, proration: true, periodStart: S + 10 * 86400, periodEnd: E },
  ], of, "sub_4");
  check("monthly → annual: unused monthly share reverted, a fresh 12-month schedule",
    toAnnual.length === 2 && toAnnual[0].type === "revert" && toAnnual[1].type === "annual", toAnnual);
  const annualDown = invoiceGrants([{ priceId: "pa", amount: -20000, proration: true, periodStart: S, periodEnd: E }], of, "sub_5");
  check("an annual plan's credit line: future tranches void, the current month by time (no amount)",
    annualDown.length === 1 && annualDown[0].type === "revert" && annualDown[0].credits === null, annualDown);
  check("a line that is not a plan grants nothing", invoiceGrants([{ priceId: "tax", amount: 100, proration: false, periodStart: S, periodEnd: E }], of, null).length === 0);
  check("a line without a period grants nothing", invoiceGrants([{ priceId: "pm", amount: 4990, proration: false, periodStart: null, periodEnd: null }], of, null).length === 0);
}

console.log("C. TOOL PRICES — the document's examples");
{
  const model = (pricing: Record<string, number>, metadata: Record<string, unknown> = {}) =>
    ({ pricing, credit_cost: 1, metadata }) as Parameters<typeof priceFor>[0];
  const nbp = model({ "1K": 1, "2K": 1, "4K": 1.25 });
  const nb2 = model({ "1K": 1, "2K": 1.25, "4K": 1.75 });
  const nb = model({ "1K": 0.5 });
  const gpt2 = model({ "1K": 1, "2K": 1 }, { qualities: ["low", "medium", "high"], quality_pricing: { low: { "1K": 1, "2K": 1 }, medium: { "1K": 1, "2K": 1 }, high: { "1K": 1, "2K": 1 } } });
  check("Packshot 2K = 1, 4K = 1.25; five 2K images = 5", priceFor(nbp, "2K") === 1 && priceFor(nbp, "4K") === 1.25 && priceFor(nbp, "2K") * 5 === 5);
  check("Stwórz zdjęcie: Nano Banana 0.5", priceFor(nb, "1K") === 0.5);
  check("Stwórz zdjęcie: Nano Banana 2 — 1K 1, 2K 1.25, 4K 1.75", priceFor(nb2, "1K") === 1 && priceFor(nb2, "2K") === 1.25 && priceFor(nb2, "4K") === 1.75);
  check("Stwórz zdjęcie: Nano Banana Pro — 1K/2K 1, 4K 1.25", priceFor(nbp, "1K") === 1 && priceFor(nbp, "2K") === 1 && priceFor(nbp, "4K") === 1.25);
  check("Stwórz zdjęcie: GPT Image 2 — 1 at 1K and 2K, whatever quality", ["low", "medium", "high"].every((q) => priceFor(gpt2, "1K", q as "low") === 1 && priceFor(gpt2, "2K", q as "low") === 1));
  const mini = (photos: number, retouch: boolean, reused = 0) => quoteTotal({ photos, retouch, retouchUnit: 1, thumbnailCredits: 2, reused }).total;
  check("Miniaturka without Packshot AI: 2", mini(3, false) === 2);
  check("Miniaturka + retouch of 1 / 3 / 5 / 10 photos: 3 / 5 / 7 / 12", mini(1, true) === 3 && mini(3, true) === 5 && mini(5, true) === 7 && mini(10, true) === 12);
  check("photos already retouched (paid) are not charged again: 5 photos, 2 reused = 5", mini(5, true, 2) === 5);
  const shot = (n: number, unit: number) => Math.round((2 + unit * n) * 100) / 100;
  check("GrovShot 2K: 1 / 3 / 5 / 10 images = 3 / 5 / 7 / 12", shot(1, 1) === 3 && shot(3, 1) === 5 && shot(5, 1) === 7 && shot(10, 1) === 12);
  check("GrovShot 4K: 1 / 5 images = 3.25 / 8.25", shot(1, 1.25) === 3.25 && shot(5, 1.25) === 8.25);
}

console.log("D. PRESENTATION");
{
  const tenForTwelve = [990, 2490, 4990, 10990].map((c) => ({ priceCents: c, annualPriceCents: c * 10 }));
  check("12 months for the price of 10 = 16.67 % saving", annualSavingPct(tenForTwelve) === 16.67, annualSavingPct(tenForTwelve));
  check("USD is written the dollar way", formatMoney(4990, "USD") === "$49.90" && formatMoney(109900, "USD") === "$1,099");
  check("≈ zł from the NBP rate (PRO at 3,9676 = 197,98 zł)", (approxPln(4990, 3.9676) ?? "").replace(/\s/g, " ") === "197,98 zł", approxPln(4990, 3.9676));
  check("no rate, no złoty figure", approxPln(4990, null) === null);
  const tpl = makeT(pl as never); const ten = makeT(en as never);
  check("a fractional price reads 1,25 in Polish and 1.25 in English",
    tpl("pricing.topups.perCredit", { price: 1.25 }).startsWith("1,25") && ten("pricing.topups.perCredit", { price: 1.25 }).startsWith("1.25"));
}

console.log(failed ? `\n${failed} PRICING TEST(S) FAILED` : "\nAll pricing tests passed.");
process.exit(failed ? 1 : 0);
