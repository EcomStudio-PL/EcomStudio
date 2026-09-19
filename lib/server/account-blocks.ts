import "server-only";
import { dispatchToken } from "./server-token";
import type { Client } from "@/lib/services/workspace";

/**
 * THE EXPIRED-BLOCK SWEEP, FOR THE SCHEDULE.
 *
 * WHAT WENT WRONG (P1-05 / P1-08 / P1-29). The daily cron called
 * `expireBlocksAction()`, a server action that opens with `requireAdmin()`.
 * Vercel Cron authenticates with a bearer secret and carries no session, so
 * that guard threw on every single run and the route reported `{ ok: false }`
 * — a shape that reads like "nothing to do" rather than "never ran".
 *
 * WHAT THIS IS NOT. It is not the enforcement. `account_blocked()` compares
 * `blocked_until` to now(), so a block that ended at 15:30 stopped applying at
 * 15:30 whether or not anything swept. The only consequence of the sweep never
 * running is cosmetic and visible: the CRM keeps showing "zablokowany do" on
 * an account that has been working for weeks. That is worth fixing and worth
 * not overstating.
 *
 * WHY A SEPARATE ENTRY POINT rather than relaxing the action's guard: the
 * admin screen's path must keep asking for an admin. Migration 0108 adds
 * `server_expire_account_blocks(p_token)` beside the admin one; both call the
 * same `expire_account_blocks()`, so there is one sweep with two doors.
 */
export async function expireAccountBlocks(
  supabase: Client,
): Promise<{ ok: true; lifted: number } | { ok: false; error: string }> {
  const token = dispatchToken();
  // Fails closed and names the reason. Without the server key the database
  // refuses the call anyway; saying "server_unconfigured" in the cron response
  // is the difference between an operator fixing an environment variable and
  // an operator reading `false` for six months.
  if (!token) return { ok: false, error: "server_unconfigured" };

  const { data, error } = await supabase.rpc("server_expire_account_blocks", { p_token: token });
  if (error) {
    console.error("account-blocks.expire", error.code, error.message);
    return { ok: false, error: "sweep_failed" };
  }
  return { ok: true, lifted: Number(data ?? 0) };
}
