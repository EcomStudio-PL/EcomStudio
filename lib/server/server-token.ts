import "server-only";
import { createHash } from "crypto";

/**
 * PROOF-OF-SERVER.
 *
 * GrovBase's server talks to Supabase with the same publishable key the browser
 * holds, so nothing about a request tells Postgres whether it came from the
 * application or from a customer's console. For anything a customer must not be
 * able to do for themselves — refund their own generation, read a provider
 * credential, pull the SMTP password so the waitlist confirmation can go out —
 * the database needs one thing the browser cannot have.
 *
 * That is this token. The server derives it from a value only the server
 * process holds; the SECURITY DEFINER functions check sha256(token) against
 * app_settings.notifications->>'dispatch_hash', which `ensureDispatchHash`
 * publishes whenever an admin saves an integration. Publishing a HASH is the
 * point: the database can verify the token without ever being able to produce
 * one, so a database dump does not hand anyone the server's identity.
 *
 * WHY THIS IS NO LONGER AN ENCRYPTION KEY.
 *
 * It used to be derived from APP_ENCRYPTION_KEY, because that key was also what
 * sealed every stored secret. Secrets now live in Supabase Vault (migration
 * 0078), sealed by Supabase's own infrastructure, so this value has exactly one
 * job left: proving identity. It can therefore be ANY sufficiently long random
 * string — GROVBASE_SERVER_KEY — rather than a 64-character hex key whose
 * format the operator has to get exactly right.
 *
 * The two legacy names are still accepted so nothing breaks on a deployment
 * that has one of them set. They are read in order of preference.
 *
 * AND WHEN IT IS ABSENT, THE PANEL STILL WORKS. Reading a secret is authorised
 * by `is_admin() OR server_call_ok(token)`, so an operator testing their
 * mailbox, opening the inbox or sending a message needs no server key at all.
 * Only the unattended paths — the waitlist confirmation to an anonymous
 * visitor, the Supabase auth hook, the captcha check, a customer's generation
 * reaching for a provider key — have no admin to authorise them and need this.
 */

/** 64 hex characters, the legacy encryption-key format. */
const KEY_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * The raw server secret, or null. Preference order is deliberate: the purpose-
 * built variable first, then the two keys that used to carry this job, so an
 * existing deployment keeps the token it has already published a hash for.
 */
export function serverSecret(): string | null {
  const dedicated = process.env.GROVBASE_SERVER_KEY?.trim();
  // Long enough that guessing is hopeless; short enough that a person can paste
  // one without a format lecture. A too-short value is refused rather than
  // silently accepted, because a weak proof-of-server is worse than none.
  if (dedicated && dedicated.length >= 32) return dedicated;

  for (const legacy of [
    process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY,
    process.env.APP_ENCRYPTION_KEY,
  ]) {
    const hex = legacy?.trim();
    if (hex && KEY_HEX.test(hex)) return hex;
  }
  return null;
}

/** Whether the unattended paths can authenticate themselves at all. */
export function serverTokenAvailable(): boolean {
  return serverSecret() !== null;
}

/**
 * The token itself. The prefix is a domain separator: it keeps this hash from
 * colliding with any other use of the same underlying secret.
 */
export function dispatchToken(): string | null {
  const secret = serverSecret();
  if (!secret) return null;
  return createHash("sha256").update(`grovbase-notify-dispatch:${secret}`).digest("hex");
}
