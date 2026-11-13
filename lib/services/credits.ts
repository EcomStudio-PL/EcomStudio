import { cache } from "react";
import type { Client } from "./workspace";

/** The pools under a wallet's balance (Cennik V2, migration 0174). */
export type WalletPools = {
  subscription: number;
  topup: number;
  topupLocked: number;
  bonus: number;
  planLive: boolean;
  nextExpiry: string | null;
  nextExpiryAmount: number;
};

/**
 * Per-request memo: the app layout and pages like /home and /credits all
 * read the wallet during one request — one query serves them all.
 *
 * CENNIK V2: `balance` is what the workspace can SPEND right now — the
 * ledger's balance minus top-ups locked while no paid plan is active
 * (credit_wallet_state). The ledger's own figure is `total_balance`. Every
 * screen that shows "your credits" and every pre-check reads `balance`, so
 * nobody is shown a credit the server would refuse to spend.
 */
export const getWallet = cache(async (supabase: Client, workspaceId: string) => {
  const [{ data }, { data: state }] = await Promise.all([
    supabase.from("credit_wallets").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.rpc("credit_wallet_state", { p_workspace_id: workspaceId }),
  ]);
  if (!data) return data;
  const st = state as {
    spendable?: number; subscription?: number; topup?: number; topup_locked?: number; bonus?: number;
    plan_live?: boolean; next_expiry?: string | null; next_expiry_amount?: number;
  } | null;
  const total = Number(data.balance);
  const pools: WalletPools | null = st ? {
    subscription: Number(st.subscription ?? 0), topup: Number(st.topup ?? 0),
    topupLocked: Number(st.topup_locked ?? 0), bonus: Number(st.bonus ?? 0),
    planLive: st.plan_live === true, nextExpiry: st.next_expiry ?? null,
    nextExpiryAmount: Number(st.next_expiry_amount ?? 0),
  } : null;
  return {
    ...data,
    balance: st && typeof st.spendable === "number" ? Number(st.spendable) : total,
    total_balance: total,
    pools,
  };
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
