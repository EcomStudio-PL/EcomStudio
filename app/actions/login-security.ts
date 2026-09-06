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
  | { ok: true; masked: string; resendSeconds: number; status: "sent" | "reused" | "not_configured" | "error" }
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
  return { ok: true, masked: maskEmail(user.email), resendSeconds: settings.resendSeconds, status };
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
  | { ok: true; status: "sent" | "cooldown" | "not_configured" | "error"; waitSeconds?: number };

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
  return { ok: true, status: result.status === "reused" ? "sent" : result.status, waitSeconds: result.waitSeconds };
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
