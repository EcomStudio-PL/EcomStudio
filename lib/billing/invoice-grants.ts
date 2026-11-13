/**
 * WHAT A PAID SUBSCRIPTION INVOICE GRANTS — decided from its LINES.
 *
 * Pure (no Stripe, no database) so every case below is a unit test:
 *
 *   a full monthly line          one month's credits, expiring at the line's
 *                                period end;
 *   a full annual line           a 12-month schedule (tranche 1 now, 2..12
 *                                by the tick) over the line's period;
 *   a POSITIVE proration line    an upgrade: the new plan's credits for the
 *                                share of the period Stripe charged for
 *                                (amount / full price), expiring with it —
 *                                for an annual plan, a schedule over the
 *                                remaining period (the database prorates the
 *                                last window);
 *   a NEGATIVE proration line    unused time of the previous plan, credited
 *                                back in money by Stripe: the same share of
 *                                that plan's current credits is taken back
 *                                (monthly: by Stripe's amount; annual: future
 *                                tranches void and the current month by time)
 *                                — never more than is left of them.
 *
 * A line whose Price is not a plan (or a zero amount proration) grants
 * nothing. Both grants and reversals round DOWN to hundredths — a reversal
 * therefore takes back at most what the arithmetic says, never more.
 */

export type PlanForPrice = {
  id: string;
  name: string;
  /** monthly_credits + bonus_credits */
  credits: number;
  period: "monthly" | "annual";
  /** The full price of that period, minor units (the plan row's figure). */
  priceCents: number;
};

export type InvoiceLineFacts = {
  priceId: string | null;
  amount: number;
  proration: boolean;
  /** Epoch seconds. */
  periodStart: number | null;
  periodEnd: number | null;
};

export type Grant =
  | { type: "lot"; credits: number; expires_at: string; plan_id: string; billing_period: "monthly"; subscription: string | null; description: string }
  | { type: "annual"; credits_per_month: number; period_start: string; period_end: string; plan_id: string; subscription: string | null }
  | { type: "revert"; credits: number | null; plan_id: string; subscription: string | null };

const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const iso = (s: number) => new Date(s * 1000).toISOString();

export function invoiceGrants(
  lines: InvoiceLineFacts[],
  planOf: (priceId: string) => PlanForPrice | null,
  subscription: string | null,
): Grant[] {
  const out: Grant[] = [];
  // Reversals first: the database takes back the old plan's share before the
  // new plan's credits exist, so the new lot can never be the one reverted.
  const ordered = [...lines].sort((a, b) => Number(b.amount < 0) - Number(a.amount < 0));
  for (const line of ordered) {
    if (!line.priceId) continue;
    const plan = planOf(line.priceId);
    if (!plan || plan.credits <= 0) continue;
    const start = line.periodStart;
    const end = line.periodEnd;
    if (!start || !end || end <= start) continue;

    if (!line.proration) {
      if (line.amount < 0) continue;
      out.push(plan.period === "annual"
        ? { type: "annual", credits_per_month: plan.credits, period_start: iso(start), period_end: iso(end), plan_id: plan.id, subscription }
        : { type: "lot", credits: plan.credits, expires_at: iso(end), plan_id: plan.id, billing_period: "monthly", subscription,
            description: `Abonament: ${plan.name}` });
      continue;
    }
    if (line.amount === 0 || plan.priceCents <= 0) continue;
    const share = Math.min(1, Math.abs(line.amount) / plan.priceCents);
    if (line.amount > 0) {
      if (plan.period === "annual") {
        out.push({ type: "annual", credits_per_month: plan.credits, period_start: iso(start), period_end: iso(end), plan_id: plan.id, subscription });
      } else {
        const credits = floor2(plan.credits * share);
        if (credits > 0) {
          out.push({ type: "lot", credits, expires_at: iso(end), plan_id: plan.id, billing_period: "monthly", subscription,
            description: `Zmiana planu: ${plan.name}` });
        }
      }
    } else {
      out.push({ type: "revert", credits: plan.period === "annual" ? null : floor2(plan.credits * share), plan_id: plan.id, subscription });
    }
  }
  return out;
}

/** Read the facts this module needs from a Stripe invoice line, old or new API shape. */
export function lineFacts(line: Record<string, unknown>, priceId: string | null): InvoiceLineFacts {
  const period = (line.period ?? {}) as Record<string, unknown>;
  const parent = line.parent as Record<string, unknown> | undefined;
  const itemDetails = parent?.subscription_item_details as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    priceId,
    amount: num(line.amount) ?? 0,
    proration: line.proration === true || itemDetails?.proration === true,
    periodStart: num(period.start),
    periodEnd: num(period.end),
  };
}
