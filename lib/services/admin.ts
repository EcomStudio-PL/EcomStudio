import { cache } from "react";
import type { Client } from "./workspace";

/** Business KPIs for the admin shell and dashboard. Revenue comes from the
 *  real `payments` table — before a PSP is connected it is legitimately 0;
 *  the structure is already what Stripe webhooks will write into. */
export const adminBusinessStats = cache(async (supabase: Client) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [users, usersToday, payToday, pay30, gensToday] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
    supabase.from("payments").select("amount_cents, status").gte("created_at", todayStart.toISOString()),
    supabase.from("payments").select("amount_cents, status, created_at").gte("created_at", d30),
    supabase.from("generation_jobs").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
  ]);
  const SETTLED = new Set(["succeeded", "paid", "completed"]);
  const paid = (rows: { amount_cents: number; status: string }[] | null) =>
    (rows ?? []).filter((p) => SETTLED.has(p.status)).reduce((s, p) => s + p.amount_cents, 0);
  return {
    users: users.count ?? 0,
    usersToday: usersToday.count ?? 0,
    revenueTodayCents: paid(payToday.data),
    revenue30dCents: paid(pay30.data),
    payments30d: (pay30.data ?? []).filter((p) => SETTLED.has(p.status)),
    generationsToday: gensToday.count ?? 0,
  };
});

export async function adminCounts(supabase: Client) {
  // No product count. The Produkty module is DISABLED in the feature registry
  // — customers cannot add one any more — so the number could only ever fall,
  // and a dashboard tile counting a closed catalogue is a fact about the past
  // dressed up as a metric. The rows stay in the database; nothing reads them
  // here.
  const [users, jobs, credits] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("generation_jobs").select("id", { count: "exact", head: true }),
    // Summed in SQL (SECURITY INVOKER — RLS still applies): the old version
    // pulled every generation transaction ever written into JS to add them.
    supabase.rpc("generation_credits_total"),
  ]);
  const creditsUsed = Number(credits.data ?? 0);
  return {
    users: users.count ?? 0,
    jobs: jobs.count ?? 0,
    creditsUsed,
  };
}

/**
 * A STRUCTURED SETTING MUST NOT COME BACK AS A SENTENCE (P1-07).
 *
 * /admin/system renders every field of a settings row as one input, and an
 * input's value is a string: `String(val)` turns an array into "a,b,c" and an
 * object into the literal "[object Object]". Whatever the operator then saves
 * is what the row becomes.
 *
 * That is not cosmetic. Production holds five settings rows with structured
 * fields, and two of them are read on the generation path —
 * `generation.provider_priority` (which providers to try, in what order) and
 * `free_tools.remove_bg` (the free-run allowance). A provider list written
 * back as one comma-joined string leaves the router with no order to read.
 *
 * So the last word belongs to what is STORED, not to what the form sent: a
 * field that is an object or an array in the database keeps its stored value
 * unless the caller sends a matching shape. Every flat field — which is every
 * field that editor can actually represent — is written exactly as before, so
 * the screen behaves identically for everything it was designed to edit, and
 * this is a guard rather than a redesign.
 */
export function keepStructuredFields(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...incoming };
  for (const [field, current] of Object.entries(stored)) {
    if (current === null || typeof current !== "object") continue;
    const sent = merged[field];
    // A caller that genuinely sends structure is honoured; a flattened string,
    // a number, null or a missing field falls back to what is already there.
    if (sent === null || typeof sent !== "object") merged[field] = current;
  }
  return merged;
}
