import type { Client } from "./workspace";

export async function getWallet(supabase: Client, workspaceId: string) {
  const { data } = await supabase
    .from("credit_wallets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

export async function getTransactions(supabase: Client, walletId: string, limit = 50) {
  const { data } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
