import { cache } from "react";
import type { Client } from "./workspace";

/** Per-request memo: the app layout and pages like /home and /credits all
 *  read the wallet during one request — one query serves them all. */
export const getWallet = cache(async (supabase: Client, workspaceId: string) => {
  const { data } = await supabase
    .from("credit_wallets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
});

export async function getTransactions(supabase: Client, walletId: string, limit = 50) {
  const { data } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
