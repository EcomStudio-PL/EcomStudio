import "server-only";
import { createHash } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken, safeError } from "@/lib/server/integrations";

/**
 * SIGNUP GUARD — the per-IP registration cap from migration 0054.
 *
 * Same privilege story as notifications: a signup runs as `anon`, so the
 * counter sits behind SECURITY DEFINER functions gated by the dispatch token
 * only our server can derive. And the same failure story, in the opposite
 * direction: this is a speed bump for mass registration, not an
 * authentication boundary — every failure here FAILS OPEN, because our own
 * breakage must never lock a real customer out of registration. The SQL side
 * makes the identical choice, on purpose.
 *
 * Raw addresses never reach the database. Only a keyed hash is stored, so
 * signup_events can count repeat registrations without ever becoming a list
 * of visitor IPs — and without the key, the hashes are just noise.
 */

/**
 * The key the hash is salted with. This repeats the resolution rule from
 * integrations.ts deliberately, the way notify.ts does: the salt must be a
 * secret the server already holds, and importing a private helper across
 * modules for it would couple two files that only share a convention.
 */
function integrationsKeyHex(): string | null {
  for (const candidate of [process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY, process.env.APP_ENCRYPTION_KEY]) {
    const hex = candidate?.trim();
    if (hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) return hex;
  }
  return null;
}

/** The keyed hash stored in signup_events.ip_hash. Null — meaning "cannot
 *  guard, let the signup through" — when there is no key to salt with or no
 *  usable address (callerIp() answers "unknown" behind a broken proxy). */
export function signupIpHash(ip: string): string | null {
  const keyHex = integrationsKeyHex();
  const addr = ip.trim();
  if (!keyHex || !addr || addr === "unknown") return null;
  return createHash("sha256").update(`grovbase-signup-ip:${keyHex}:${addr}`).digest("hex");
}

/** May this IP register another account? True on ANY failure — a missing
 *  token, an RPC error, a database that never saw 0054 — for the same reason
 *  the SQL fails open: a broken guard must never close registration. */
export async function signupAllowed(supabase: Client, ipHash: string): Promise<boolean> {
  try {
    const token = dispatchToken();
    if (!token) return true;
    const { data, error } = await supabase.rpc("signup_ip_allowed", {
      p_token: token,
      p_ip_hash: ipHash,
    });
    if (error) {
      console.error("signup.allowed", safeError(error));
      return true;
    }
    // Only an explicit "no" counts; a null from a confused round trip does not.
    return data !== false;
  } catch (e) {
    console.error("signup.allowed", safeError(e));
    return true;
  }
}

/** Remember that a registration happened. Swallows every failure — a signup
 *  that succeeded must never be un-succeeded by its own bookkeeping — and the
 *  SQL itself no-ops silently on a bad token. */
export async function recordSignup(supabase: Client, ipHash: string, email: string): Promise<void> {
  try {
    const token = dispatchToken();
    if (!token) return;
    const { error } = await supabase.rpc("signup_ip_record", {
      p_token: token,
      p_ip_hash: ipHash,
      p_email: email,
    });
    if (error) console.error("signup.record", safeError(error));
  } catch (e) {
    console.error("signup.record", safeError(e));
  }
}
