import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/**
 * IS THIS ACCOUNT PAUSED RIGHT NOW?
 *
 * A block used to be enforced in exactly one place: the app shell refused to
 * render. That stops a person browsing, and stops nothing else — a session
 * that was already open could still POST to /api/generate, spend credits and
 * bill us for the API call, because no route asked. Hiding a screen is not an
 * authorisation model.
 *
 * So the gate lives here, one definition shared by the shell and by every
 * route that spends money or writes customer data:
 *
 *   blocked AND (no end date OR the end date is still in the future)
 *
 * The expiry is read, never waited for. If the tidy-up sweep never runs, a
 * block that ended at 15:30 stops being enforced at 15:30 anyway — a customer
 * is never locked out by a job that failed to fire.
 *
 * Nothing here deletes or changes anything: a block hides access, and the
 * credits, files, history and profile behind it are untouched.
 */

export type BlockState = {
  blocked: boolean;
  /** ISO instant when it lifts; null means indefinite. */
  until: string | null;
  reason: string | null;
};

const FREE: BlockState = { blocked: false, until: null, reason: null };

/**
 * The one read. A failure is NOT treated as a block: an unreachable database
 * must not lock every customer out of a working application — the surrounding
 * page or route has its own auth check, and this gate is about state, not
 * identity.
 */
export async function readBlockState(supabase: Client, userId: string): Promise<BlockState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("blocked, blocked_until, blocked_reason")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return FREE;
  return blockStateOf(data);
}

/** The same rule applied to a row someone has already read. */
export function blockStateOf(row: {
  blocked: boolean | null;
  blocked_until?: string | null;
  blocked_reason?: string | null;
}): BlockState {
  if (!row.blocked) return FREE;
  const until = row.blocked_until ?? null;
  if (until && new Date(until).getTime() <= Date.now()) return FREE;
  return { blocked: true, until, reason: row.blocked_reason ?? null };
}

/**
 * For server actions, which have no response object to return: throws, and
 * the action's own try/catch turns it into its usual error result.
 *
 * Deliberately NOT applied to the support desk. A paused customer has to be
 * able to ask why they are paused; a block that also silences the person is a
 * support ticket that never gets written.
 */
export async function assertNotBlocked(supabase: Client, userId: string): Promise<void> {
  const state = await readBlockState(supabase, userId);
  if (state.blocked) throw new Error("account_blocked");
}

/**
 * For API routes: the response to return, or null to carry on.
 *
 * 403 with a machine-readable code, and the end time so a client can say when
 * the account comes back rather than "something went wrong". The internal note
 * never leaves the server — it is written for the operator, not the customer.
 */
export async function accountBlockedResponse(
  supabase: Client,
  userId: string,
): Promise<NextResponse | null> {
  const state = await readBlockState(supabase, userId);
  if (!state.blocked) return null;
  return NextResponse.json(
    { ok: false, error: "account_blocked", blocked_until: state.until },
    { status: 403 },
  );
}
