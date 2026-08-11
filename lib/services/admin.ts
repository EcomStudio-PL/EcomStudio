import type { Client } from "./workspace";

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
