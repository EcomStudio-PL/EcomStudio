/**
 * CREDIT LEVEL — the UX spec's traffic-light thresholds for the wallet,
 * computed against a visual reference scale (plans do not grant fixed
 * allowances yet, so 200 kr — the same scale the dashboard meter has always
 * used — stands in for the plan limit until plans carry one).
 *
 *   >70%  ok        standard state (green)
 *   31–70% low      colour shift only (orange)
 *   1–30%  critical colour + "credits running out" tooltip (red)
 *   0      empty    generation blocked upstream; UI shows a "buy credits" CTA
 *
 * Shared by server and client components — keep it free of "server-only".
 */
export const CREDIT_REFERENCE = 200;

export type CreditLevel = "ok" | "low" | "critical" | "empty";

export function creditLevel(balance: number, reference: number = CREDIT_REFERENCE): CreditLevel {
  if (balance <= 0) return "empty";
  const pct = (balance / Math.max(1, reference)) * 100;
  if (pct > 70) return "ok";
  if (pct > 30) return "low";
  return "critical";
}

/** Meter/track colour class per level — green→orange→red, never just hue. */
export const CREDIT_METER_CLASS: Record<CreditLevel, string> = {
  ok: "bg-[rgb(var(--success))]",
  low: "bg-[rgb(var(--warning))]",
  critical: "bg-[rgb(var(--danger))]",
  empty: "bg-[rgb(var(--danger))]",
};
