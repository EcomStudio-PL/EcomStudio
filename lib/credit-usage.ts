/**
 * HOW MUCH OF THE PLAN'S PACKAGE IS GONE — the number under the drawer's meter.
 *
 * TWO FACTS GO IN, BOTH FROM THE DATABASE: the wallet balance
 * (`credit_wallets.balance`) and the plan's monthly grant
 * (`subscription_plans.monthly_credits`). Nothing here is a constant standing
 * in for a plan — `lib/credit-level.ts` does that deliberately for the header
 * chip, where there is no plan in scope, and this is the opposite case: the
 * drawer knows which plan the workspace is on, so it measures against that
 * plan's real allowance.
 *
 * WHAT "USED" MEANS, EXACTLY. `total - balance`, clamped into [0, total]. The
 * clamp is not cosmetic: a workspace that bought a credit pack can hold more
 * than its monthly grant, and "used: -300 of 25" is not a thing to show
 * anyone. Such an account reads as 0% used, which is the honest summary — none
 * of this month's allowance is missing. The same clamp is why a balance of 0
 * reads as 100% and never as more.
 *
 * IT IS A PACKAGE METER, NOT A LEDGER. Spending that was covered by a top-up
 * rather than by the monthly grant does not move this bar, because the balance
 * it is derived from was topped up too. The ledger on /credits is where
 * "what did I spend this month" is answered from transactions.
 *
 * NO LIMIT, NO GUESS. A plan with no monthly grant — or a plan row that could
 * not be read — yields `total: null` and the `unknown` band, and the caller
 * renders the brand's own neutral colour instead of inventing a percentage.
 *
 * Shared by server and client components — keep it free of "server-only".
 */

export type UsageBand = "ok" | "caution" | "warn" | "critical" | "unknown";

export type CreditUsage = {
  /** The plan's monthly allowance, or null when there is no classic limit. */
  total: number | null;
  /** Credits of that allowance already spent. Never negative, never > total. */
  used: number;
  /** What is still there — the wallet balance, clamped at zero. */
  remaining: number;
  /** How much of the package is GONE, 0–100. Null when incomputable. */
  percent: number | null;
  /**
   * How much of it is LEFT, 0–100 — what the meter actually draws.
   *
   * The bar empties as credits are spent, which is the direction a seller
   * reads without thinking: a full bar is a full wallet. The BAND still comes
   * from `percent`, because the colour is about danger, not about length —
   * 10 % left is red whichever number you print next to it.
   */
  remainingPercent: number | null;
  band: UsageBand;
};

/**
 * The four stops, by how much of the package is GONE:
 *
 *   0–49 %   ok        green     — plenty left
 *   50–74 %  caution   yellow    — past halfway
 *   75–89 %  warn      orange    — plan ahead
 *   90–100 % critical  red       — about to run out
 */
export function usageBand(percent: number | null | undefined): UsageBand {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "unknown";
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warn";
  if (percent >= 50) return "caution";
  return "ok";
}

export function creditUsage(balance: number, allowance: number | null | undefined): CreditUsage {
  const remaining = Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
  const total =
    typeof allowance === "number" && Number.isFinite(allowance) && allowance > 0
      ? Math.floor(allowance)
      : null;

  if (total === null) {
    return { total: null, used: 0, remaining, percent: null, remainingPercent: null, band: "unknown" };
  }

  const used = Math.min(total, Math.max(0, total - remaining));
  // Rounded for display, but never rounded ACROSS a band edge in a way that
  // lies: 89.6 % of a package is shown as 90 % and is coloured as 90 %,
  // because the band is read off the same rounded figure the label shows.
  const percent = Math.round((used / total) * 100);
  // The complement of the SAME rounded figure, so "70 % used" and "30 % left"
  // can never appear as 70 and 31 next to each other.
  return { total, used, remaining, percent, remainingPercent: 100 - percent, band: usageBand(percent) };
}

/**
 * The meter's fill. A tinted bar with a soft glow of its own colour — enough
 * to read at a glance on a dark panel, nowhere near the brand's own glow.
 */
export const USAGE_BAR: Record<UsageBand, string> = {
  ok: "bg-[rgb(var(--success))] shadow-[0_0_10px_rgb(var(--success)/0.45)]",
  caution: "bg-[rgb(var(--caution))] shadow-[0_0_10px_rgb(var(--caution)/0.45)]",
  warn: "bg-[rgb(var(--warning))] shadow-[0_0_10px_rgb(var(--warning)/0.45)]",
  critical: "bg-[rgb(var(--danger))] shadow-[0_0_10px_rgb(var(--danger)/0.5)]",
  unknown: "bg-[rgb(var(--accent))] shadow-[0_0_10px_rgb(var(--accent)/0.4)]",
};

/** The percentage figure, in the same colour as the bar it describes. */
export const USAGE_TEXT: Record<UsageBand, string> = {
  ok: "text-[rgb(var(--success))]",
  caution: "text-[rgb(var(--caution))]",
  warn: "text-[rgb(var(--warning))]",
  critical: "text-[rgb(var(--danger))]",
  unknown: "text-accent",
};
