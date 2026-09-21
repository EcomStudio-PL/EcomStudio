"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import {
  callerIpRaw, deviceLabel, ensureDeviceCookie, enforceLoginSecurity, evaluateRisk,
  getLoginSecuritySettings, hashIp, maskEmail, openOrReuseChallenge, readDeviceHash,
  toStoredSettings, verifyChallengeCode, LOGIN_SECURITY_KEY,
  type LoginSecuritySettings,
} from "@/lib/server/login-security";

/**
 * Server actions behind /auth/security-check. They run in an action context,
 * so — unlike the page's server render — they may SET the device cookie, which
 * is why the challenge is opened from here and not on page load.
 *
 * Every action re-reads the session server-side; the client passes nothing that
 * is trusted beyond the typed 6-digit code. The IP is taken from the request,
 * never from the body.
 */

export type ChallengeState =
  | {
      ok: true;
      masked: string;
      /**
       * ONE NUMBER, BECAUSE THERE IS ONE CLOCK.
       *
       * Seconds the LIVE code has left, taken from the row's expires_at. It is
       * both "the code expires in" and "a new code can be asked for in" — the
       * two used to be separate values that disagreed by design, and that gap
       * was the window in which a person could hold two live-looking codes.
       * A refresh re-reads the same row, so nothing restarts.
       */
      expiresInSeconds: number;
      status: "sent" | "reused" | "not_configured" | "error";
    }
  | { ok: false; reason: "no_session" | "already_trusted" };

/** Called on mount. Ensures the device cookie, decides whether a code is truly
 *  needed (a user who is already trusted is bounced straight through), and on
 *  the first entry sends the email. */
export async function ensureChallengeAction(): Promise<ChallengeState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, reason: "no_session" };

  const settings = await getLoginSecuritySettings(supabase);
  const { hash: deviceHash } = await ensureDeviceCookie();
  const ipHash = hashIp(await callerIpRaw());

  const risk = await evaluateRisk(supabase, settings, deviceHash, ipHash);
  if (risk.trusted) return { ok: false, reason: "already_trusted" };

  const label = await deviceLabel();
  const result = await openOrReuseChallenge(supabase, {
    userId: user.id,
    email: user.email,
    deviceHash,
    ipHash,
    label,
    reason: risk.reason === "no_session" ? "new_device" : risk.reason,
    settings,
  });
  const status = result.status === "cooldown" ? "reused" : result.status;
  return {
    ok: true,
    masked: maskEmail(user.email),
    expiresInSeconds: Math.max(0, result.expiresInSeconds ?? 0),
    status,
  };
}

export type VerifyState = { ok: true } | { ok: false; reason: string; attemptsLeft?: number };

export async function verifyCodeAction(code: string): Promise<VerifyState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "no_session" };
  const deviceHash = await readDeviceHash();
  if (!deviceHash) return { ok: false, reason: "no_device" };
  const ipHash = hashIp(await callerIpRaw());
  const label = await deviceLabel();
  const verdict = await verifyChallengeCode(supabase, {
    userId: user.id, deviceHash, ipHash, label, code,
  });
  return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason ?? "mismatch", attemptsLeft: verdict.attemptsLeft };
}

export type ResendState =
  | {
      ok: true;
      status: "sent" | "cooldown" | "not_configured" | "error";
      /** Only on "cooldown": seconds the live code still has. The button comes
       *  back exactly then, because that is when a replacement may be issued. */
      waitSeconds?: number;
      expiresInSeconds?: number;
    };

/**
 * "SEND A NEW CODE" — refused while the current one is alive.
 *
 * The refusal is the DATABASE's, not this function's and certainly not the
 * button's: login_challenge_start sees the live row and answers 'live'. A
 * caller that skips the UI entirely and posts this action directly gets the
 * same answer, which is the whole point of putting the rule down there.
 */
export async function resendCodeAction(): Promise<ResendState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: true, status: "error" };
  const settings = await getLoginSecuritySettings(supabase);
  const { hash: deviceHash } = await ensureDeviceCookie();
  const ipHash = hashIp(await callerIpRaw());
  const label = await deviceLabel();
  const result = await openOrReuseChallenge(supabase, {
    userId: user.id, email: user.email, deviceHash, ipHash, label,
    reason: "new_device", settings, force: true,
  });
  return {
    ok: true,
    /*
      `reused` is unreachable with force: true — the service answers `cooldown`
      for a live code. It is mapped anyway, and DELIBERATELY NOT to "sent".

      That is what used to be here, and it was the wrong way to be wrong: both
      outcomes mean a live code exists and no mail went out, so calling it
      "sent" would show "Kod został wysłany", restart the clock and send the
      person to an inbox with nothing new in it. Folded into `cooldown`, an
      unreachable branch that somehow becomes reachable tells the truth.
    */
    status: result.status === "reused" ? "cooldown" : result.status,
    waitSeconds: result.waitSeconds,
    expiresInSeconds: result.expiresInSeconds,
  };
}

/** Re-check clearance after a successful verify, so the page only navigates on
 *  when the gate would actually let the user in. */
export async function clearanceReadyAction(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  return (await enforceLoginSecurity(supabase)) === null;
}

/* ── admin: save the knobs ───────────────────────────────────────────────────
 * Re-checks the admin role here — a server action is its own entry point and
 * must not trust the layout. Writes the flat string row 0057 seeds. */
export async function saveLoginSecurityAction(
  input: LoginSecuritySettings,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "forbidden" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  const row = toStoredSettings(input);
  const { error } = await supabase.from("app_settings").upsert(
    { key: LOGIN_SECURITY_KEY, value: row }, { onConflict: "key" },
  );
  if (error) return { ok: false, error: "generic" };
  await logAudit(supabase, {
    actorId: user.id, action: "login_security.config_saved",
    entityType: "app_settings", entityId: LOGIN_SECURITY_KEY, after: row,
  });
  revalidatePath("/admin/settings/security");
  return { ok: true };
}

/* ── account: revoke a trusted device ────────────────────────────────────────
 * The DB function pins the user to auth.uid(), so a caller can only ever revoke
 * their own device; this just forwards the id and revalidates the page. */
export async function revokeDeviceAction(deviceId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc("trusted_device_revoke", { p_device_id: deviceId });
  if (error) return false;
  revalidatePath("/settings");
  return data === true;
}
