import type { Client } from "./workspace";

/** Business KPIs for the admin shell and dashboard. Revenue comes from the
 *  real `payments` table — before a PSP is connected it is legitimately 0;
 *  the structure is already what Stripe webhooks will write into. */
export async function adminBusinessStats(supabase: Client) {
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
}

export async function adminCounts(supabase: Client) {
  const [users, products, jobs, credits] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("generation_jobs").select("id", { count: "exact", head: true }),
    supabase.from("credit_transactions").select("amount").eq("type", "generation"),
  ]);
  const creditsUsed = (credits.data ?? []).reduce((s, r) => s + Math.abs(r.amount), 0);
  return {
    users: users.count ?? 0,
    products: products.count ?? 0,
    jobs: jobs.count ?? 0,
    creditsUsed,
  };
}
