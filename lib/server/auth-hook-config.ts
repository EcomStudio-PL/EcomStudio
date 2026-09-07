import "server-only";
import type { Client } from "@/lib/services/workspace";
import { api, managementToken } from "@/lib/server/supabase-management";
import {
  activeSecret, envSecret, generateSecret, hookSecretState, markPushed, storeSecret,
  type HookSecretState,
} from "@/lib/server/auth-hook-secret";
import { absoluteUrl } from "@/lib/site";

/**
 * TURNING THE SEND EMAIL HOOK ON, WITHOUT ANYONE COPYING A SECRET.
 *
 * The hook lives in the Supabase CONTROL plane — not in the project database,
 * so no migration reaches it. The Management API does:
 *
 *   PATCH /v1/projects/{ref}/config/auth
 *     hook_send_email_enabled : true
 *     hook_send_email_uri     : https://grovbase.com/api/hooks/supabase/send-email
 *     hook_send_email_secrets : v1,whsec_…
 *
 * When SUPABASE_MANAGEMENT_TOKEN is present, GrovBase does the whole thing
 * itself: it generates the secret, seals it with APP_ENCRYPTION_KEY, sends it
 * once over TLS inside that PATCH, and reads the config back to confirm. The
 * operator never sees the secret, so there is nothing for them to paste, lose
 * or leak — and this file never logs it, never returns it and never puts it
 * in an error message.
 *
 * Without the token the same endpoint still works; the operator generates the
 * secret in the dashboard and puts it in SUPABASE_SEND_EMAIL_HOOK_SECRET
 * instead. That is the ONLY manual path, and it exists so a deployment that
 * cannot hold a management token is not stuck.
 */

export const HOOK_PATH = "/api/hooks/supabase/send-email";

/**
 * Auth e-mails GrovBase's own mailbox may send per hour.
 *
 * Not a guess and not a maximum: it is a deliberate ceiling that is far above
 * ordinary traffic and far below anything that would get a shared mailbox
 * flagged as a spam source. Supabase's own default is 2 — meant for its demo
 * mailer, catastrophic for ours.
 */
export const EMAIL_RATE_LIMIT_PER_HOUR = 200;

export function hookUrl(): string {
  return absoluteUrl(HOOK_PATH);
}

/** What the panel is allowed to know. Never the secret, and never a green
 *  light that was not read back from Supabase. */
export type HookStatus = {
  /** ready   — Supabase confirms the hook is on and points at this URL
   *  mismatch— the hook is on, but at a different URL
   *  off     — Supabase has the hook disabled
   *  unknown — we cannot ask (no management token), so we do not claim */
  supabase: "ready" | "mismatch" | "off" | "unknown";
  /** The URI Supabase currently has, when we could read it. */
  configuredUri: string | null;
  /** Our endpoint's own readiness: is there a secret to verify against. */
  endpoint: "ready" | "no_secret";
  secret: HookSecretState;
  /** Can this deployment configure Supabase by itself? */
  canAutomate: boolean;
  /**
   * Auth e-mails Supabase will let through per hour, read back from the
   * project config. This is the number that quietly capped production at two
   * registrations an hour, so the panel shows it rather than assuming it.
   * Null when we have no management token to ask with.
   */
  emailRateLimit: number | null;
  /** Populated only when a read or a push failed. */
  error: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function readHookStatus(supabase: Client): Promise<HookStatus> {
  const secret = await hookSecretState(supabase);
  const endpoint: HookStatus["endpoint"] = (await activeSecret(supabase)) ? "ready" : "no_secret";
  const token = managementToken();
  const base: HookStatus = {
    supabase: "unknown", configuredUri: null, endpoint, secret,
    canAutomate: token !== null, emailRateLimit: null, error: null,
  };
  if (!token) return base;

  const current = await api(token, "GET");
  if (!current.ok) return { ...base, error: current.error };

  const enabled = current.data.hook_send_email_enabled === true;
  const uri = str(current.data.hook_send_email_uri);
  const quota = Number(current.data.rate_limit_email_sent);
  const emailRateLimit = Number.isFinite(quota) ? quota : null;
  if (!enabled) return { ...base, supabase: "off", configuredUri: uri || null, emailRateLimit };
  return {
    ...base,
    supabase: uri === hookUrl() ? "ready" : "mismatch",
    configuredUri: uri || null,
    emailRateLimit,
  };
}

export type HookPushResult =
  | { ok: true; status: HookStatus }
  | { ok: false; reason: "no_token" | "no_key" | "api" | "verify"; error?: string; status: HookStatus };

/**
 * Configure the hook end to end.
 *
 * A secret already in the environment is used as-is — that one belongs to the
 * operator and this must not silently replace it. Otherwise a fresh secret is
 * generated, sealed locally FIRST (so a successful PATCH can never leave
 * Supabase holding a secret this endpoint does not know), then pushed, then
 * read back to confirm.
 */
export async function pushHookConfig(supabase: Client): Promise<HookPushResult> {
  const token = managementToken();
  if (!token) {
    return { ok: false, reason: "no_token", status: await readHookStatus(supabase) };
  }

  let secret = envSecret();
  if (!secret) {
    const state = await hookSecretState(supabase);
    if (!state.canGenerate) {
      // No APP_ENCRYPTION_KEY: a generated secret could not be stored, and a
      // secret Supabase holds but we cannot read is worse than none.
      return { ok: false, reason: "no_key", status: await readHookStatus(supabase) };
    }
    // Reuse the one already sealed here if there is one, so re-running this
    // does not invalidate deliveries that are in flight.
    secret = (await activeSecret(supabase)) || generateSecret();
    if (!(await storeSecret(supabase, secret))) {
      return { ok: false, reason: "no_key", status: await readHookStatus(supabase) };
    }
  }

  const uri = hookUrl();
  const patched = await api(token, "PATCH", {
    hook_send_email_enabled: true,
    hook_send_email_uri: uri,
    hook_send_email_secrets: secret,
    // THE QUOTA, RAISED IN THE SAME BREATH AS THE HOOK.
    //
    // Supabase defaults `rate_limit_email_sent` to 2 PER HOUR, a number set
    // for its own shared demo mailer. GrovBase does not use that mailer — this
    // very PATCH is what tells Supabase to hand every message to our own SMTP
    // instead — so the cap protects nothing and merely rations our own mailbox
    // to two customers an hour. On production it did exactly that: the third
    // registration of the hour came back 429, and every one after it.
    //
    // Enabling the hook and leaving the demo-mailer quota in place is a
    // half-configuration, so the two are set together and can never drift.
    rate_limit_email_sent: EMAIL_RATE_LIMIT_PER_HOUR,
  });
  if (!patched.ok) {
    return { ok: false, reason: "api", error: patched.error, status: await readHookStatus(supabase) };
  }

  // Trust nothing: read it back. The secret is write-only in that API, so
  // only the two non-secret fields can be verified — which is exactly why the
  // secret was sealed locally before the push.
  const after = await api(token, "GET");
  if (!after.ok) {
    return { ok: false, reason: "verify", error: after.error, status: await readHookStatus(supabase) };
  }
  if (after.data.hook_send_email_enabled !== true || str(after.data.hook_send_email_uri) !== uri) {
    return {
      ok: false, reason: "verify",
      error: "Supabase did not report the hook as enabled for this URL.",
      status: await readHookStatus(supabase),
    };
  }

  await markPushed(supabase, uri);
  return { ok: true, status: await readHookStatus(supabase) };
}

/** Turn it off again — the honest counterpart, so an operator who wants
 *  Supabase to send its own mail again is not stuck in our panel. */
export async function disableHook(supabase: Client): Promise<HookPushResult> {
  const token = managementToken();
  if (!token) return { ok: false, reason: "no_token", status: await readHookStatus(supabase) };
  const patched = await api(token, "PATCH", { hook_send_email_enabled: false });
  if (!patched.ok) {
    return { ok: false, reason: "api", error: patched.error, status: await readHookStatus(supabase) };
  }
  return { ok: true, status: await readHookStatus(supabase) };
}
