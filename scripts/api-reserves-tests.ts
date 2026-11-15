/**
 * API RESERVE CENTER — the model, the reports and the guards (0180).
 *
 *   npm run test:reserves         (this file)
 *   npm run test:reserves:sql     (0180 against a real Postgres)
 *
 *   A  the cost of a credit: history first, configuration when history is
 *      thin, never an invented number; unknown costs never priced at 0
 *   B  available funds: confirmed / manual / estimated / unavailable,
 *      postpaid never shown as a prepaid balance
 *   C  need, reserve, top-up: formulas, provider split from the demand model,
 *      no double counting, statuses and runway
 *   D  the reports: after-sale (top-ups or "covered"), hourly (skip empty),
 *      daily, low funds; dedupe keys; Telegram rows + details, e-mail rows
 *   E  official balance APIs only, parsing
 *   F  guards: admin only, token cron, sale report only after an applied
 *      settlement and never able to fail it, no automatic purchase
 */
import { readFileSync } from "node:fs";
import {
  computeReserves, configCostPerCredit, saleLiability, type ReserveSnapshot, type SpendRow, type ProviderFacts,
} from "@/lib/finance/api-reserves";
import { saleMessage, hourlyMessage, dailyMessage, lowFundsMessage, hourIsEmpty, localParts } from "@/lib/server/api-reserves/reports";
import { parseBalance, PROVIDER_FUNDS } from "@/lib/server/api-reserves/providers";
import { renderNotification } from "@/lib/server/telegram-notification";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n      ${detail}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);
const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const M = 1_000_000;

const row = (provider_slug: string, cls: SpendRow["cls"], o: Partial<SpendRow>): SpendRow => ({
  provider_slug, cls, h1: 0, today: 0, d1: 0, d7: 0, d30: 0, month: 0, hist: 0,
  calls_h1: 0, calls_today: 0, calls_d1: 0, calls_month: 0, calls_d30: 0,
  unknown_h1: 0, unknown_today: 0, unknown_month: 0, unknown_d30: 0, failed_paid_month: 0, ...o,
});
const prov = (slug: string, name: string, o: Partial<ProviderFacts>): ProviderFacts => ({
  id: `id-${slug}`, slug, name, active: true, has_key: true, mode: "manual", balance: null, basis: null, balance_at: null,
  credit_limit: null, warn: 20 * M, critical: 5 * M, billing_url: `https://${slug}.example/billing`,
  last_sync_at: null, last_sync_status: null, last_sync_error: null, spend_since_balance: null, unknown_since_balance: null,
  adjust_since_balance: null, events: [], ...o,
});

function snapshot(o: Partial<ReserveSnapshot> = {}): ReserveSnapshot {
  return {
    now: "2026-11-15T21:05:00Z", today_start: "2026-11-14T23:00:00Z", month_start: "2026-10-31T23:00:00Z", history_start: "2026-08-17T21:05:00Z",
    settings: {
      enabled: true, buffer_percent: 20, horizon_days: 30, scenario: "standard", cautious_factor: 1.5, history_days: 90,
      min_history_credits: 50, daily_report_hour: 23, report_timezone: "Europe/Warsaw", hourly_skip_empty: true, alert_repeat_hours: 6,
    },
    spend: [],
    pools: { customer: { subscription: 165, topup: 100, bonus: 10, legacy: 0, expiring_24h: 0, expiring_7d: 40, expiring_horizon: 165 } },
    tranches: { customer: { total: 250, within_24h: 0, within_7d: 0, within_horizon: 125 } },
    credits_month: { customer: { granted_subscription: 180, granted_topup: 100, granted_bonus: 10, used: 60, expired: 0,
      used_d1: 15, used_today: 15, used_d7: 30, used_d30: 60, used_hist: 100, granted_today: 55 } },
    expired_history: { lots: 0, granted: 0, unused: 0 },
    sales: { h1: { count: 1, revenue: { USD: 4990 } }, today: { count: 2, new: 1, renewals: 0, changes: 0, topups: 1, revenue: { USD: 6890 } }, month: { count: 2, revenue: { USD: 6890 } } },
    providers: [
      prov("google", "Google Gemini", { mode: "postpaid" }),
      prov("anthropic", "Anthropic", { mode: "manual", balance: 50 * M, basis: "manual", balance_at: "2026-11-10T00:00:00Z", spend_since_balance: 2 * M, adjust_since_balance: 10 * M, unknown_since_balance: 0 }),
      prov("fal", "fal.ai", { mode: "auto", balance: 24.5 * M, basis: "confirmed", balance_at: "2026-11-15T21:00:00Z", spend_since_balance: 0, adjust_since_balance: 0, unknown_since_balance: 0 }),
      prov("openai", "OpenAI", { mode: "manual" }),
      prov("photoroom", "Photoroom", { mode: "manual", active: false }),
    ],
    models: [{ provider: "google", model: "gemini-3-pro-image", name: "Nano Banana Pro", pricing: { "2K": 1, "4K": 1.25 }, credit_cost: 1, customer: true }],
    unit_prices: [
      { provider: "google", model: "gemini-3-pro-image", unit_kind: "image", resolution: "2K", quality: null, usd_micros: 134000 },
      { provider: "google", model: "gemini-3-pro-image", unit_kind: "image", resolution: "4K", quality: null, usd_micros: 240000 },
    ],
    ...o,
  };
}

function main() {
  section("A. WHAT ONE CREDIT COSTS");
  {
    const cfg = configCostPerCredit(snapshot().models, snapshot().unit_prices);
    check("configuration: Nano Banana Pro 2K $0.134 / 1 credit, 4K $0.24 / 1.25 → avg $0.163, max $0.192",
      Math.round(cfg.get("google")!.avg) === 163000 && Math.round(cfg.get("google")!.max) === 192000, JSON.stringify([...cfg]));
    const thin = computeReserves(snapshot({ spend: [row("google", "customer", { hist: 5 * M, d1: 268000, d7: 268000, month: 268000 })] }));
    check("enough history (100 credits used ≥ minimum 50): the cost comes from HISTORY", thin.costPerCredit.source === "history");
    const hist = computeReserves(snapshot({
      spend: [row("google", "customer", { hist: 10 * M }), row("anthropic", "customer", { hist: 5 * M })],
    }));
    check("history: customer provider cost ÷ customer credits used ($15 / 100 = $0.15)",
      hist.costPerCredit.source === "history" && hist.costPerCredit.standard === 150000, String(hist.costPerCredit.standard));
    check("…split per provider from the same model (google $0.10, anthropic $0.05), not fixed percentages",
      hist.providers.find((p) => p.slug === "google")!.costPerCredit!.standard === 100000
      && hist.providers.find((p) => p.slug === "anthropic")!.costPerCredit!.standard === 50000);
    check("cautious per provider = max(history × factor, most expensive configured size)",
      Math.round(hist.providers.find((p) => p.slug === "google")!.costPerCredit!.cautious) === 192000
      && hist.providers.find((p) => p.slug === "anthropic")!.costPerCredit!.cautious === 75000);
    const few = computeReserves(snapshot({
      credits_month: { customer: { ...snapshot().credits_month!.customer!, used_hist: 10 } },
      spend: [row("google", "customer", { hist: 3 * M })],
    }));
    check("thin history (10 < 50 credits): configuration, with the assumption stated",
      few.costPerCredit.source === "config" && few.assumptions.includes("history_insufficient"));
    const none = computeReserves(snapshot({ models: [], unit_prices: [], credits_month: { customer: { ...snapshot().credits_month!.customer!, used_hist: 0 } } }));
    check("no history and no prices: no cost basis — the forecast is unknown, not $0",
      none.costPerCredit.source === "none" && none.costPerCredit.standard === null && none.exposure === null && none.assumptions.includes("no_cost_basis"));
    const unknown = computeReserves(snapshot({ spend: [row("openai", "system", { unknown_month: 646, unknown_h1: 2 })] }));
    check("calls with an unknown cost are counted and flagged, never priced", unknown.unknownCalls.month === 646 && unknown.assumptions.includes("unknown_costs")
      && unknown.spend.system.month === 0);
  }

  section("B. AVAILABLE FUNDS");
  {
    const r = computeReserves(snapshot());
    const p = (s: string) => r.providers.find((x) => x.slug === s)!;
    check("auto, synced, nothing spent since: CONFIRMED $24.50", p("fal").available.micros === 24.5 * M && p("fal").available.basis === "confirmed");
    check("manual base $50 + $10 top-up − $2 spent since: ESTIMATED $58", p("anthropic").available.micros === 58 * M && p("anthropic").available.basis === "estimated");
    check("no balance entered: UNAVAILABLE (null), never $0", p("openai").available.micros === null && p("openai").available.basis === "unavailable");
    check("postpaid: never a prepaid balance", p("google").available.micros === null && p("google").topup === null && p("google").secure !== null);
    check("the total is the known prepaid balances only, marked estimated when any is", r.available.micros === 82.5 * M && r.available.basis === "estimated");
    check("an active provider without a balance is listed as unknown", r.unknownFunds.includes("openai") && !r.unknownFunds.includes("photoroom"));
  }

  section("C. NEED, RESERVE, TOP-UP");
  {
    const s = snapshot({ spend: [
      row("google", "customer", { hist: 10 * M, d1: 2 * M, d7: 7 * M, month: 9 * M }),
      row("anthropic", "customer", { hist: 5 * M }),
      row("anthropic", "internal", { d1: 1 * M, d7: 3.5 * M, month: 4 * M }),
    ] });
    const r = computeReserves(s);
    const g = r.providers.find((x) => x.slug === "google")!;
    const a = r.providers.find((x) => x.slug === "anthropic")!;
    // customer volume over 30 days: min(available 275+125, max(rate 15/day × 30 = 450, expiring 165 × 1)) = 400
    check("customer volume (30 days) = min(what they hold + tranches due, max(rate × days, expiring × utilisation)) = 400",
      g.need.horizon.standard === 400 * 100000, String(g.need.horizon.standard));
    check("internal/admin spend reserved at its own running rate (anthropic 1/day × 30 + customers 400 × $0.05)",
      a.need.horizon.standard === 30 * M + 400 * 50000, String(a.need.horizon.standard));
    check("reserve = need × (1 + 20%) per provider", g.reserve === Math.round(g.need.horizon.standard * 1.2) && a.reserve === Math.round(a.need.horizon.standard * 1.2));
    check("the total reserve is the sum of providers — computed once, no double count",
      r.reserve === r.providers.filter((x) => x.mode !== "off").reduce((t, x) => t + x.reserve, 0)
      && r.need.horizon.standard === r.providers.reduce((t, x) => t + x.need.horizon.standard, 0));
    check("prepaid top-up = max(0, reserve − available)", a.topup === Math.max(0, a.reserve - 58 * M), String(a.topup));
    check("postpaid: month's unbilled spend + reserve to set aside (no top-up)", g.secure === 9 * M + g.reserve && g.topup === null);
    check("missing = prepaid top-ups + postpaid set-aside", r.missing === r.topupTotal + r.secureTotal);
    check("cautious ≥ standard everywhere", r.providers.every((x) => x.need.h24.cautious >= x.need.h24.standard && x.need.horizon.cautious >= x.need.horizon.standard));
    const c = computeReserves({ ...s, settings: { ...s.settings, scenario: "cautious" } });
    check("the cautious scenario drives a larger reserve when chosen", c.reserve >= r.reserve);
    const big = computeReserves(snapshot({ settings: { ...snapshot().settings, buffer_percent: 50 } }));
    check("the buffer is the admin's setting (50% → each provider's reserve = need × 1.5)",
      big.providers.every((x) => x.reserve === Math.round(x.need.horizon.standard * 1.5)));
    const low = computeReserves(snapshot({ providers: [prov("fal", "fal.ai", { mode: "auto", balance: 4 * M, basis: "confirmed", balance_at: "x", spend_since_balance: 0, adjust_since_balance: 0, unknown_since_balance: 0 })],
      spend: [row("fal", "customer", { d1: 12 * M, d7: 12 * M, month: 12 * M })] }));
    check("below the critical threshold ($4 < $5): CRITICAL, runway in hours", low.providers[0].status === "critical" && (low.providers[0].runwayHours ?? 99) < 24);
    const warn = computeReserves(snapshot({ providers: [prov("fal", "fal.ai", { mode: "auto", balance: 15 * M, basis: "confirmed", balance_at: "x", spend_since_balance: 0, adjust_since_balance: 0, unknown_since_balance: 0 })] }));
    check("under the warning threshold ($15 < $20): WARNING", warn.providers[0].status === "warning");
    const ok = computeReserves(snapshot({ providers: [prov("fal", "fal.ai", { mode: "auto", balance: 500 * M, basis: "confirmed", balance_at: "x", spend_since_balance: 0, adjust_since_balance: 0, unknown_since_balance: 0 })] }));
    check("well funded and covering its reserve: OK, no top-up", ok.providers[0].status === "ok" && ok.providers[0].topup === 0);
  }

  section("D. THE REPORTS");
  {
    const s = snapshot({ spend: [row("google", "customer", { hist: 10 * M, d1: 2 * M, d7: 7 * M, month: 9 * M, calls_h1: 1, h1: 134000 })] });
    const r = computeReserves(s);
    const facts = { id: "pay-1", kind: "subscription", amount_cents: 4990, currency: "USD", billing_period: "monthly", billing_reason: "subscription_create",
      plan_slug: "pro", plan_name: "Pro", internal: false, credits_now: 125, credits_scheduled: 0 };
    const sale = saleMessage(facts, r);
    const flat = JSON.stringify(sale);
    check("after-sale: plan, payment, credits, liability, with buffer, total and status", ["Pro", "$49.90", "125", "Szacowane dodatkowe zobowiązanie API", "z buforem 20%", "Łącznie do zabezpieczenia", "Status rezerw"].every((x) => flat.includes(x)), flat);
    check("…recommends top-ups when reserves fall short", r.missing > 0 && (sale.details ?? "").startsWith("REKOMENDOWANE DOŁADOWANIA"));
    check("…one report per payment (dedupe key = payment id)", sale.dedupeKey === saleMessage(facts, r).dedupeKey && sale.dedupeKey!.includes("pay-1"));
    const rich = computeReserves(snapshot({ providers: [prov("google", "Google Gemini", { mode: "manual", balance: 10_000 * M, basis: "manual", balance_at: "x", spend_since_balance: 0, adjust_since_balance: 0, unknown_since_balance: 0 })],
      spend: [row("google", "customer", { hist: 10 * M })] }));
    check("…and says the reserves cover it when they do (no needless top-up)", (saleMessage(facts, rich).details ?? "").includes("pokrywają"));
    check("liability of a sale = its credits × cost per credit, with the buffer", saleLiability(r, 125).standard === 125 * 100000 && saleLiability(r, 125).withBuffer === 125 * 120000);
    const annual = saleMessage({ ...facts, id: "pay-2", billing_period: "annual", credits_now: 125, credits_scheduled: 1375 }, r);
    check("an annual plan counts its scheduled tranches in the liability, granted now vs later shown apart",
      JSON.stringify(annual).includes("1\u00a0375") && JSON.stringify(annual).includes(`$${((1500 * 100000) / M).toFixed(2)}`));
    const hourly = hourlyMessage(r, s, "15.11.2026, 22:00");
    check("hourly: dedupe per local hour", hourly.dedupeKey!.includes("15.11.2026, 22:00"));
    const quiet = snapshot({ sales: { ...s.sales, h1: { count: 0, revenue: {} } } });
    check("an empty hour is recognised (and skipped when the admin says so)", hourIsEmpty(computeReserves(quiet), quiet) && !hourIsEmpty(r, s));
    const daily = dailyMessage(r, s, "2026-11-15");
    const dflat = JSON.stringify(daily);
    check("daily: sales, credits, API costs, funds, reserve, missing", ["Nowe abonamenty", "Odnowienia", "Doładowania", "Przychód", "Kredyty sprzedane", "Kredyty wykorzystane", "Koszty API", "Dostępne środki", "Zalecana rezerwa", "Do uzupełnienia"].every((x) => dflat.includes(x)), dflat);
    check("…one per local day", daily.dedupeKey!.includes("2026-11-15"));
    const tg = renderNotification({ ...daily, data: {} } as never, { expandable: true });
    check("Telegram: 8 rows on the card, the rest in the expandable block (nothing silently dropped)",
      (daily.rows?.length ?? 0) > 8 && !!daily.details && tg.text.includes("blockquote expandable"));
    check("e-mail: every row is in the payload (the e-mail prints all rows)", (daily.rows ?? []).some(([l]) => l.includes("Do uzupełnienia")));
    const p = { ...r.providers.find((x) => x.slug === "anthropic")!, status: "critical" as const };
    const a1 = lowFundsMessage(p, r, 100);
    check("low funds: one alert per provider, status and repeat window", a1.dedupeKey !== lowFundsMessage(p, r, 101).dedupeKey && a1.dedupeKey === lowFundsMessage(p, r, 100).dedupeKey);
    check("…links the provider's billing panel", (a1.footer ?? "").includes("https://anthropic.example/billing"));
    const lp = localParts(new Date("2026-11-15T22:10:00Z"), "Europe/Warsaw");
    check("the daily hour is read in Europe/Warsaw (22:10 UTC = 23:10 CET)", lp.h === 23 && lp.d === "15");
  }

  section("E. OFFICIAL BALANCE APIS ONLY");
  {
    check("fal.ai credits.current_balance in USD → micros", parseBalance("fal", { username: "x", credits: { current_balance: 24.5, currency: "USD" } }) === 24.5 * M);
    check("…a non-USD balance is refused, not converted", parseBalance("fal", { credits: { current_balance: 10, currency: "EUR" } }) === null);
    check("Stability credits at one cent each", parseBalance("stability", { credits: 1234 }) === 12.34 * M);
    check("a provider without a money balance API is never parsed", parseBalance("openai", { balance: 99 }) === null && parseBalance("photoroom", { credits: { available: 5 } }) === null);
    check("Google is postpaid; OpenAI and Anthropic need a manual balance", PROVIDER_FUNDS.google.balance === "postpaid"
      && PROVIDER_FUNDS.openai.balance === "manual" && PROVIDER_FUNDS.anthropic.balance === "manual" && PROVIDER_FUNDS.fal.balance === "api");
    const src = code(read("lib/server/api-reserves/providers.ts"));
    check("only GET requests to documented hosts — nothing is bought, nothing scraped",
      /method: "GET"/.test(src) && !/method: "POST"/.test(src) && (src.match(/https:\/\/api\.[a-z.]+\/v1\/[a-z/]+/g) ?? []).every((u) => /api\.fal\.ai\/v1\/account\/billing|api\.stability\.ai\/v1\/user\/balance/.test(u)));
  }

  section("F. GUARDS");
  {
    const mig = read("supabase/migrations/0180_api_reserves.sql");
    check("every reader and writer re-checks admin (or the server token) in the database",
      (mig.match(/if not public\.is_admin\(\) then raise exception 'not_admin'/g) ?? []).length >= 3
      && (mig.match(/if not \(public\.is_admin\(\) or public\.server_call_ok\(p_token\)\)/g) ?? []).length >= 3);
    check("no write policy on the three tables; writes revoked from anon and authenticated",
      !/for (insert|update|delete|all)/i.test(mig) && /revoke insert, update, delete on public\.api_reserve_settings, public\.api_provider_funds, public\.api_provider_fund_events/.test(mig));
    const actions = code(read("app/actions/api-reserves.ts"));
    check("every server action starts with requireAdmin() and is audited",
      (actions.match(/export async function/g) ?? []).length === (actions.match(/await requireAdmin\(\)/g) ?? []).length
      && (actions.match(/logAudit\(/g) ?? []).length >= 5);
    check("the page lives under /admin (the admin layout redirects everyone else)", read("app/admin/finance/rezerwy/page.tsx").includes("loadReserveReport(supabase, false)"));
    const route = code(read("app/api/cron/reserves/route.ts"));
    check("the cron route: POST only, bearer = dispatch token or CRON_SECRET, no session path",
      /export async function POST/.test(route) && !/export async function GET/.test(route) && /secretMatches\(presented, serverToken\)/.test(route) && !/cookies|createClient\(\)/.test(route));
    const hook = code(read("lib/server/stripe-webhook.ts"));
    check("the sale report fires only after an APPLIED settlement (subscription invoices and top-ups)",
      (hook.match(/scheduleSaleReport\(/g) ?? []).length === 2
      && /if \(settledStatus === "applied"\) \{[\s\S]*?scheduleSaleReport\(supabase, \(settled/.test(hook)
      && /if \(status === "applied"\) \{[\s\S]*?scheduleSaleReport\(supabase, \(data/.test(hook));
    const rep = code(read("lib/server/api-reserves/reports.ts"));
    check("…after the response, and it can never throw into the webhook", /after\(\(\) => reportSale\(supabase, paymentId\)\)/.test(rep)
      && /export async function reportSale[\s\S]*?try \{[\s\S]*?\} catch \(e\)/.test(rep));
    check("a started checkout never reports (no hook in checkout code)", !/scheduleSaleReport|reportSale/.test(read("lib/server/checkout.ts")));
    const notify = code(read("lib/server/notify.ts"));
    check("the long breakdown survives the queue (details persisted and read back)", /details: input\.details \?\? null/.test(notify) && /details: asString\(payload\.details\)/.test(notify));
    check("the admin_panel channel never reaches the customers' bell", !/notifications \(user_id/.test(mig) && /'admin_panel', 'sent', now\(\)/.test(mig));
  }

  console.log(failed === 0 ? `\nAll API reserve tests passed (${passed} checks).` : `\n${failed} API reserve test(s) failed, ${passed} passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
