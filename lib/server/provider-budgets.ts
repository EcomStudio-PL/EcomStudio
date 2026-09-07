import "server-only";
import type { Client } from "@/lib/services/workspace";
import { notify, buildDedupeKey } from "@/lib/server/notify";
import { monthStart, readBudgetStatus, type BudgetStatus } from "@/lib/services/ai-economics";

/**
 * PROVIDER BUDGET ALERTS.
 *
 * GrovBase does not know a provider's account balance — none of the adapters
 * expose one, and inventing a figure would be worse than having none. What it
 * knows exactly is what WE have spent this month, because every billable call
 * writes its cost to the usage ledger. So the alert is about our budget, not
 * their balance, and it says so.
 *
 * Delivery goes through the existing notification outbox and its Telegram
 * transport. There is no second alerting system here: this module decides
 * *when* something is worth saying and hands the message to `notify()`.
 *
 * One message per level per provider per month. Crossing 75% announces once;
 * crossing 90% announces once more; the same 91% on the next run says nothing.
 * An alert that repeats every hour is an alert people learn to ignore.
 */

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

export type BudgetCheck = {
  checked: number;
  alerted: number;
  levels: { provider: string; level: string }[];
};

export async function checkProviderBudgets(supabase: Client): Promise<BudgetCheck> {
  const statuses = await readBudgetStatus(supabase);
  const month = monthStart();
  const out: BudgetCheck = { checked: 0, alerted: 0, levels: [] };

  for (const s of statuses) {
    if (!s.budget?.alertsEnabled || !s.budget.monthlyBudgetUsdMicros || s.percent === null) continue;
    out.checked += 1;
    if (s.level === "ok") {
      // Spending fell back inside the budget, or a new month started: clear the
      // marker so the next crossing is announced again.
      if (s.budget.lastAlertLevel) await clearMarker(supabase, s.providerId);
      continue;
    }

    // A marker from LAST month must not silence this month's first warning.
    const stale = !s.budget.lastAlertAt || new Date(s.budget.lastAlertAt) < month;
    const alreadySaid = !stale && (
      s.budget.lastAlertLevel === s.level
      || (s.budget.lastAlertLevel === "critical" && s.level === "warn")
    );
    if (alreadySaid) {
      out.levels.push({ provider: s.providerSlug, level: s.level });
      continue;
    }

    await announce(supabase, s, month);
    await supabase.from("ai_provider_budgets").update({
      last_alert_level: s.level,
      last_alert_at: new Date().toISOString(),
    }).eq("provider_id", s.providerId);
    out.alerted += 1;
    out.levels.push({ provider: s.providerSlug, level: s.level });
  }
  return out;
}

async function clearMarker(supabase: Client, providerId: string): Promise<void> {
  await supabase.from("ai_provider_budgets")
    .update({ last_alert_level: null, last_alert_at: null })
    .eq("provider_id", providerId);
}

async function announce(supabase: Client, s: BudgetStatus, month: Date): Promise<void> {
  const budget = s.budget?.monthlyBudgetUsdMicros ?? 0;
  await notify(supabase, {
    type: "system.error",
    icon: s.level === "critical" ? "🚨" : "⚠️",
    title: s.level === "critical"
      ? `Budżet API: ${s.providerName} — ${Math.round(s.percent ?? 0)}%`
      : `Budżet API: ${s.providerName} zbliża się do limitu`,
    rows: [
      ["Dostawca", s.providerName],
      ["Wydane w tym miesiącu", usd(s.spentUsdMicros)],
      ["Budżet", usd(budget)],
      ["Wykorzystanie", `${Math.round(s.percent ?? 0)}%`],
      ["Żądania", String(s.requests)],
    ],
    // Says what the number is, so nobody reads it as the provider's balance.
    footer: `Licznik od ${month.toISOString().slice(0, 10)}. To nasz budżet, nie saldo u dostawcy.`,
    // One per provider, per level, per month.
    dedupeKey: buildDedupeKey("system.error", "budget", s.providerSlug, s.level, month.toISOString().slice(0, 7)),
  });
}
