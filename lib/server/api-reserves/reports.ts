import "server-only";
import { after } from "next/server";
import { notify, buildDedupeKey, type NotifyInput } from "@/lib/server/notify";
import { dispatchToken } from "@/lib/server/server-token";
import type { Client } from "@/lib/services/workspace";
import {
  computeReserves, credits, revenueText, runwayText, saleLiability, usd, cents,
  STATUS_ICON, STATUS_LABEL, BASIS_LABEL,
  type ReserveReport, type ReserveSnapshot, type ProviderReserve,
} from "@/lib/finance/api-reserves";
import { syncProviderBalances } from "./providers";

/**
 * API RESERVE CENTER — THE FOUR ADMIN REPORTS (0180).
 *
 *   finance.reserve_sale     after every CONFIRMED and booked payment (called
 *                            from the Stripe webhook only when the settlement
 *                            was applied — never from a started checkout);
 *   finance.reserve_hourly   the last hour and the funds now (optionally
 *                            skipped when nothing happened);
 *   finance.reserve_daily    sales, credits, costs, providers, top-ups — at
 *                            the configured local hour (23:00 Europe/Warsaw);
 *   finance.funds_low        a provider at Ostrzeżenie / Krytyczny, repeated at
 *                            most once per configured window.
 *
 * Each goes through the existing dispatcher (notify → outbox → Telegram /
 * e-mail / the admin panel), with a dedupe key per occurrence: a repeated cron
 * wake, a retried webhook or a second tab can never send one twice. Nothing
 * here can fail a payment: every entry point catches and logs.
 */

const PANEL = "/admin/finance/rezerwy";

export async function loadReserveSnapshot(supabase: Client, viaToken = false): Promise<ReserveSnapshot | null> {
  const { data, error } = await supabase.rpc("api_reserve_snapshot", viaToken ? { p_token: dispatchToken() ?? "" } : {});
  if (error || !data) return null;
  return data as unknown as ReserveSnapshot;
}

export async function loadReserveReport(supabase: Client, viaToken = false): Promise<{ snap: ReserveSnapshot; report: ReserveReport } | null> {
  const snap = await loadReserveSnapshot(supabase, viaToken);
  return snap ? { snap, report: computeReserves(snap) } : null;
}

/* ── wall clock in the report's zone ───────────────────────────────────────*/

export function localParts(date: Date, timeZone: string): { y: string; m: string; d: string; h: number; stamp: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  const h = Number(parts.hour);
  return { y: parts.year, m: parts.month, d: parts.day, h, stamp: `${parts.day}.${parts.month}.${parts.year}, ${String(h).padStart(2, "0")}:00` };
}

/* ── message pieces ─────────────────────────────────────────────────────────*/

/** Telegram shows 8 rows; the rest goes into the expandable block, the e-mail prints all rows. */
function withOverflow(input: Omit<NotifyInput, "details">): NotifyInput {
  const rows = input.rows ?? [];
  if (rows.length <= 8) return input;
  return { ...input, details: rows.slice(8).map(([l, v]) => `${l}: ${v}`).join("\n") };
}

const providerLine = (p: ProviderReserve): [string, string] => [
  `${STATUS_ICON[p.status]} ${p.name}`,
  p.mode === "postpaid"
    ? `postpaid · do zabezpieczenia ${usd(p.secure)}`
    : `${usd(p.available.micros)} (${BASIS_LABEL[p.available.basis].toLowerCase()}) · rezerwa ${usd(p.reserve)}${p.topup ? ` · doładuj +${usd(p.topup)}` : ""}`,
];

function reserveStatusText(report: ReserveReport): string {
  if (report.missing > 0) return "Wymaga uzupełnienia";
  if (report.unknownFunds.length > 0) return "Brak danych o saldzie części dostawców";
  return "Rezerwy pokrywają zobowiązania";
}

function relevant(report: ReserveReport): ProviderReserve[] {
  return report.providers.filter((p) => p.mode !== "off" && (p.active || p.reserve > 0 || p.spend.month > 0));
}

/* ── 1. after a confirmed sale ─────────────────────────────────────────────*/

export type SaleFacts = {
  id: string; kind: string; amount_cents: number; currency: string; billing_period: string | null; billing_reason: string | null;
  plan_slug: string | null; plan_name: string | null; internal: boolean; credits_now: number; credits_scheduled: number;
};

export function saleMessage(facts: SaleFacts, report: ReserveReport): NotifyInput {
  const total = Number(facts.credits_now) + Number(facts.credits_scheduled);
  const liability = saleLiability(report, total);
  const what = facts.kind === "subscription"
    ? facts.billing_reason === "subscription_cycle" ? "Odnowienie" : facts.billing_reason === "subscription_update" ? "Zmiana planu" : "Nowy abonament"
    : "Doładowanie kredytów";
  const topups = relevant(report).filter((p) => (p.topup ?? 0) > 0 || (p.mode === "postpaid" && (p.secure ?? 0) > 0));
  const rows: [string, string][] = [
    ["🧾 Rodzaj", `${what}${facts.internal ? " (konto wewnętrzne)" : ""}`],
    ...(facts.plan_name ? [["📦 Plan", `${facts.plan_slug === "agency" ? "Business" : facts.plan_name}${facts.billing_period ? ` · ${facts.billing_period === "annual" ? "roczny" : "miesięczny"}` : ""}`] as [string, string]] : []),
    ["💳 Płatność", cents(facts.amount_cents, facts.currency)],
    ["🪙 Przyznane kredyty", `${credits(Number(facts.credits_now))}${Number(facts.credits_scheduled) > 0 ? ` (+ ${credits(Number(facts.credits_scheduled))} w transzach)` : ""}`],
    ["📈 Szacowane dodatkowe zobowiązanie API", usd(liability.standard)],
    [`🛡 Zobowiązanie z buforem ${report.settings.buffer_percent}%`, usd(liability.withBuffer)],
    ["🧮 Łącznie do zabezpieczenia", usd(report.missing)],
    ["🚦 Status rezerw", reserveStatusText(report)],
  ];
  const details = topups.length > 0
    ? ["REKOMENDOWANE DOŁADOWANIA", ...topups.map((p) => p.mode === "postpaid"
        ? `${STATUS_ICON[p.status]} ${p.name}: zabezpiecz ${usd(p.secure)} (postpaid)`
        : `${STATUS_ICON[p.status]} ${p.name}: +${usd(p.topup)}`)].join("\n")
    : "Obecne rezerwy pokrywają nowe zobowiązania — doładowanie nie jest potrzebne.";
  return {
    type: "finance.reserve_sale",
    icon: "💰",
    title: "Nowa sprzedaż — GrovBase",
    rows,
    details,
    footer: "Otwórz panel finansowy → Rezerwy API",
    data: { amount: cents(facts.amount_cents, facts.currency), credits: credits(total) },
    dedupeKey: buildDedupeKey("finance.reserve_sale", facts.id),
  };
}

/* ── 2. hourly ──────────────────────────────────────────────────────────────*/

export function hourlyMessage(report: ReserveReport, snap: ReserveSnapshot, stamp: string): NotifyInput {
  const h = snap.sales.h1;
  const rows: [string, string][] = [
    ["🕒 Godzina", stamp],
    ["💳 Sprzedaż", `${h.count} · ${revenueText(h.revenue)}`],
    ["🔌 Koszty API (1 h)", `${usd(report.spend.total.h1)}${report.unknownCalls.h1 ? ` + ${report.unknownCalls.h1} wywołań o nieznanym koszcie` : ""}`],
    ["👥 W tym klienci", usd(report.spend.customer.h1)],
    ["🧪 Admin / wewnętrzne / system", usd(report.spend.internal.h1 + report.spend.system.h1)],
    ["🏦 Dostępne środki", `${usd(report.available.micros)} (${BASIS_LABEL[report.available.basis].toLowerCase()})`],
    ["🛡 Zalecana rezerwa", usd(report.reserve)],
    ["🧮 Do uzupełnienia", usd(report.missing)],
    ...relevant(report).map(providerLine),
  ];
  return withOverflow({
    type: "finance.reserve_hourly", icon: "⏱", title: "GrovBase — raport godzinowy", rows,
    footer: "Panel finansowy → Rezerwy API", dedupeKey: buildDedupeKey("finance.reserve_hourly", stamp),
  });
}

/** Nothing happened in the last hour: no call, no sale, no unknown-cost call. */
export function hourIsEmpty(report: ReserveReport, snap: ReserveSnapshot): boolean {
  const calls = report.providers.reduce((a, p) => a + p.spend.callsH1, 0);
  return calls === 0 && Number(snap.sales.h1.count ?? 0) === 0 && report.unknownCalls.h1 === 0;
}

/* ── 3. daily ───────────────────────────────────────────────────────────────*/

export function dailyMessage(report: ReserveReport, snap: ReserveSnapshot, day: string): NotifyInput {
  const t = snap.sales.today;
  const c = report.credits;
  const providers = relevant(report);
  const rows: [string, string][] = [
    ["🆕 Nowe abonamenty", String(t.new ?? 0)],
    ["🔁 Odnowienia", String(t.renewals ?? 0)],
    ["🪙 Doładowania", String(t.topups ?? 0)],
    ["💳 Przychód", revenueText(t.revenue)],
    ["📥 Kredyty sprzedane (dziś)", credits(c.month.granted_today)],
    ["📤 Kredyty wykorzystane (dziś)", credits(c.month.used_today)],
    ["💼 Kredyty klientów pozostałe", credits(c.customer.total)],
    ["🔌 Koszty API (dziś)", `${usd(report.spend.total.today)}${report.unknownCalls.today ? ` + ${report.unknownCalls.today} o nieznanym koszcie` : ""}`],
    ...providers.filter((p) => p.spend.today > 0).map((p) => [`   · ${p.name}`, usd(p.spend.today)] as [string, string]),
    ["🏦 Dostępne środki", `${usd(report.available.micros)} (${BASIS_LABEL[report.available.basis].toLowerCase()})`],
    ["🛡 Zalecana rezerwa", usd(report.reserve)],
    ["🧮 Do uzupełnienia", usd(report.missing)],
    ...providers.map(providerLine),
  ];
  return withOverflow({
    type: "finance.reserve_daily", icon: "📊", title: "GrovBase — raport dzienny", rows,
    footer: "Panel finansowy → Rezerwy API", dedupeKey: buildDedupeKey("finance.reserve_daily", day),
  });
}

/* ── 4. low funds ───────────────────────────────────────────────────────────*/

export function lowFundsMessage(p: ProviderReserve, report: ReserveReport, bucket: number): NotifyInput {
  const rows: [string, string][] = [
    ["🔌 Dostawca", p.name],
    ["🚦 Status", `${STATUS_ICON[p.status]} ${STATUS_LABEL[p.status]}`],
    ["🏦 Dostępne", `${usd(p.available.micros)} (${BASIS_LABEL[p.available.basis].toLowerCase()})`],
    ["⏳ Starczy na", runwayText(p.runwayHours)],
    ["📅 Zapotrzebowanie 24 h / 7 dni", `${usd(p.need.h24[report.settings.scenario])} / ${usd(p.need.d7[report.settings.scenario])}`],
    ["🛡 Zalecana rezerwa", usd(p.reserve)],
    [p.mode === "postpaid" ? "🧮 Do zabezpieczenia" : "➕ Rekomendowane doładowanie", usd(p.mode === "postpaid" ? p.secure : p.topup)],
  ];
  return {
    type: "finance.funds_low", icon: p.status === "critical" ? "🔴" : "🟡",
    title: `${p.status === "critical" ? "Krytycznie niskie" : "Niskie"} środki — ${p.name}`,
    rows, footer: p.billingUrl ? `Doładuj w panelu dostawcy: ${p.billingUrl}` : "Panel finansowy → Rezerwy API",
    dedupeKey: buildDedupeKey("finance.funds_low", p.slug, p.status, String(bucket)),
  };
}

/* ── entry points ───────────────────────────────────────────────────────────*/

/** After a payment was settled ("applied") by the Stripe webhook. Never throws. */
export async function reportSale(supabase: Client, paymentId: string | null | undefined): Promise<void> {
  try {
    if (!paymentId) return;
    const token = dispatchToken();
    if (!token) return;
    const loaded = await loadReserveReport(supabase, true);
    if (!loaded || !loaded.report.settings.enabled) return;
    const { data } = await supabase.rpc("api_reserve_sale_facts", { p_token: token, p_payment_id: paymentId });
    if (!data) return;
    await notify(supabase, saleMessage(data as unknown as SaleFacts, loaded.report));
  } catch (e) {
    console.error("reserves.sale", e instanceof Error ? e.message : "error");
  }
}

export type TickResult = { ran: boolean; synced?: Record<string, string>; hourly?: string; daily?: string; alerts?: string[] };

/**
 * The scheduled work (pg_cron → pg_net → /api/cron/reserves, every 15 min).
 * Due-ness is decided here from the clock in the report's zone; the dedupe
 * keys make a repeated or overlapping wake send nothing twice.
 */
export async function runReservesTick(supabase: Client, now = new Date()): Promise<TickResult> {
  let loaded = await loadReserveReport(supabase, true);
  if (!loaded || !loaded.report.settings.enabled) return { ran: false };
  const s = loaded.report.settings;
  const out: TickResult = { ran: true, alerts: [] };

  // Automatic balances, at most once an hour (the first wake of each hour).
  if (now.getUTCMinutes() < 15) {
    out.synced = await syncProviderBalances(supabase, loaded.snap.providers.map((p) => ({ id: p.id, slug: p.slug, mode: p.mode, active: p.active })));
    loaded = (await loadReserveReport(supabase, true)) ?? loaded;
  }
  const { snap, report } = loaded;
  const local = localParts(now, s.report_timezone || "Europe/Warsaw");

  // Hourly: the first wake of an hour reports the hour that just ended.
  if (now.getUTCMinutes() < 15) {
    if (s.hourly_skip_empty && hourIsEmpty(report, snap)) out.hourly = "skipped_empty";
    else { await notify(supabase, hourlyMessage(report, snap, local.stamp)); out.hourly = "sent"; }
  }
  // Daily: any wake at or after the configured local hour, once per local day.
  if (local.h >= s.daily_report_hour) {
    await notify(supabase, dailyMessage(report, snap, `${local.y}-${local.m}-${local.d}`));
    out.daily = "sent";
  }
  // Alerts: one per provider, status and repeat window.
  const bucket = Math.floor(now.getTime() / (Math.max(1, s.alert_repeat_hours) * 3_600_000));
  for (const p of report.providers) {
    if ((p.status !== "warning" && p.status !== "critical") || !(p.active || p.reserve > 0)) continue;
    await notify(supabase, lowFundsMessage(p, report, bucket));
    out.alerts!.push(`${p.slug}:${p.status}`);
  }
  return out;
}

/** "Wyślij testowy": the real builder over the real numbers, marked TEST and never deduplicated away. */
export async function sendTestReport(supabase: Client, kind: "sale" | "hourly" | "daily" | "funds_low"): Promise<boolean> {
  const loaded = await loadReserveReport(supabase, false);
  if (!loaded) return false;
  const { snap, report } = loaded;
  const stamp = `test-${Date.now()}`;
  const local = localParts(new Date(), report.settings.report_timezone || "Europe/Warsaw");
  let msg: NotifyInput;
  if (kind === "sale") {
    // A test sale of the catalogue's own PRO row (read, never typed here).
    const { data: plan } = await supabase.from("subscription_plans")
      .select("slug, name, price_cents, currency, monthly_credits, bonus_credits").eq("slug", "pro").maybeSingle();
    if (!plan) return false;
    msg = saleMessage({ id: stamp, kind: "subscription", amount_cents: plan.price_cents, currency: plan.currency, billing_period: "monthly",
      billing_reason: "subscription_create", plan_slug: plan.slug, plan_name: plan.name, internal: false,
      credits_now: Number(plan.monthly_credits) + Number(plan.bonus_credits ?? 0), credits_scheduled: 0 }, report);
  } else if (kind === "hourly") msg = hourlyMessage(report, snap, local.stamp);
  else if (kind === "daily") msg = dailyMessage(report, snap, `${local.y}-${local.m}-${local.d}`);
  else {
    const p = report.providers.find((x) => x.active && x.mode !== "off") ?? report.providers[0];
    if (!p) return false;
    msg = lowFundsMessage({ ...p, status: p.status === "critical" ? "critical" : "warning" }, report, 0);
  }
  await notify(supabase, { ...msg, title: `[TEST] ${msg.title}`, dedupeKey: buildDedupeKey(msg.type, stamp) });
  return true;
}

/**
 * Called by the Stripe webhook right after a settlement was APPLIED (exactly
 * once per payment — duplicates come back as duplicate_event/already_settled
 * and never reach here). Runs after the response (`after`), so a slow or
 * failing report can never delay, fail or repeat the payment's booking.
 * Outside a request (tests, scripts) there is nothing to schedule on, and the
 * sale simply goes unreported.
 */
export function scheduleSaleReport(supabase: Client, paymentId: string | null | undefined): void {
  if (!paymentId) return;
  try {
    after(() => reportSale(supabase, paymentId));
  } catch {
    /* no request scope */
  }
}
