import "server-only";
import { cookies, headers } from "next/headers";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { describeUserAgent, formatWarsaw } from "@/lib/server/event-context";
import { readIntegrationSecrets, safeError, type MailConfig } from "@/lib/server/integrations";
import { deliverHtml, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";
import { encryptionAvailable, encryptSecret } from "@/lib/server/crypto";

/**
 * APP-LEVEL LOGIN SECURITY — the second factor that sits on top of Supabase
 * Auth. After a correct password / Google / Apple sign-in, an unrecognised
 * device (or a new IP, or one stale past the admin's window) has to confirm a
 * 6-digit code we email before any protected page renders.
 *
 * What lives here: the device cookie, the IP HMAC, the admin knobs, the risk
 * decision, the challenge lifecycle, and the branded code email. What lives in
 * the database (0057): the trusted-device table, the hashed challenges and the
 * event trail, all written through SECURITY DEFINER functions.
 *
 * Secrets discipline: the device cookie is 128-bit random and only its SHA-256
 * is stored; the OTP is generated here and only sha256(code) reaches the DB;
 * the IP is HMAC'd with a server-only secret and the raw address is never
 * persisted. Nothing here returns a secret to the browser.
 */

/* ── the device cookie ─────────────────────────────────────────────────────
 * HttpOnly / Secure / SameSite=Lax, 400 days. The value is opaque random; the
 * database matches on its hash, so a stolen cookie is useless without also
 * passing the email step-up that minted it. */
export const DEVICE_COOKIE = "grovbase_device";
const DEVICE_MAX_AGE = 60 * 60 * 24 * 400;

export function hashDevice(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Read the device cookie's hash, or null when the browser has none yet. */
export async function readDeviceHash(): Promise<string | null> {
  const raw = (await cookies()).get(DEVICE_COOKIE)?.value?.trim();
  return raw ? hashDevice(raw) : null;
}

/**
 * Ensure the browser carries a device cookie, returning its hash. A response
 * that can set cookies is required — this is called from routes and actions
 * that already own one. The raw value never leaves this process except as the
 * Set-Cookie header the browser stores.
 */
export async function ensureDeviceCookie(): Promise<{ hash: string; raw: string; isNew: boolean }> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value?.trim();
  if (existing) return { hash: hashDevice(existing), raw: existing, isNew: false };
  const raw = randomBytes(20).toString("base64url");
  store.set(DEVICE_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  });
  return { hash: hashDevice(raw), raw, isNew: true };
}

/* ── the IP HMAC ────────────────────────────────────────────────────────────
 * A raw address is never stored: security matching uses HMAC-SHA256(ip, secret)
 * so a database leak cannot map rows back to people, and without the secret the
 * hash cannot be recomputed from a guessed address. Falls back to APP_ENCRYPTION_KEY
 * so a deployment that never set the dedicated secret still hashes rather than
 * storing plaintext. */
function ipSecret(): string | null {
  for (const candidate of [process.env.LOGIN_IP_HASH_SECRET, process.env.APP_ENCRYPTION_KEY]) {
    const s = candidate?.trim();
    if (s) return s;
  }
  return null;
}

/** The caller's address, server-side only: the leftmost X-Forwarded-For hop
 *  (Vercel appends the real client there), never anything the page sent. */
export async function callerIpRaw(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "";
}

export function hashIp(ip: string): string {
  const secret = ipSecret();
  if (!secret || !ip) return "";
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/* ── admin settings ─────────────────────────────────────────────────────────
 * Stored flat in app_settings->'login_security' (0057 seeds the defaults). A
 * missing row, an RLS refusal or a bad value degrades to the product defaults
 * — a broken setting must never lock everyone out or wave everyone through. */
export type LoginSecuritySettings = {
  verifyNewDevice: boolean;
  verifyNewIp: boolean;
  reverifyDays: number;
  codeTtlMinutes: number;
  maxAttempts: number;
  resendSeconds: number;
};

export const LOGIN_SECURITY_DEFAULTS: LoginSecuritySettings = {
  verifyNewDevice: true,
  verifyNewIp: false,
  reverifyDays: 14,
  codeTtlMinutes: 10,
  maxAttempts: 5,
  resendSeconds: 60,
};

export const LOGIN_SECURITY_KEY = "login_security";

function asFlag(value: unknown, fallback: boolean): boolean {
  if (value === "1" || value === true) return true;
  if (value === "0" || value === false) return false;
  return fallback;
}
function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export async function getLoginSecuritySettings(supabase: Client): Promise<LoginSecuritySettings> {
  try {
    const { data } = await supabase
      .from("app_settings").select("value").eq("key", LOGIN_SECURITY_KEY).maybeSingle();
    const v = (data?.value && typeof data.value === "object" && !Array.isArray(data.value)
      ? data.value : {}) as Record<string, unknown>;
    return {
      verifyNewDevice: asFlag(v.verify_new_device, LOGIN_SECURITY_DEFAULTS.verifyNewDevice),
      verifyNewIp: asFlag(v.verify_new_ip, LOGIN_SECURITY_DEFAULTS.verifyNewIp),
      reverifyDays: asInt(v.reverify_days, LOGIN_SECURITY_DEFAULTS.reverifyDays, 0, 365),
      codeTtlMinutes: asInt(v.code_ttl_minutes, LOGIN_SECURITY_DEFAULTS.codeTtlMinutes, 1, 60),
      maxAttempts: asInt(v.max_attempts, LOGIN_SECURITY_DEFAULTS.maxAttempts, 1, 10),
      resendSeconds: asInt(v.resend_seconds, LOGIN_SECURITY_DEFAULTS.resendSeconds, 15, 600),
    };
  } catch {
    return LOGIN_SECURITY_DEFAULTS;
  }
}

/** The stored (flat, string) shape of the settings row — what the admin save
 *  writes and 0057 seeds. Kept next to the reader so the round trip cannot drift. */
export function toStoredSettings(s: LoginSecuritySettings): Record<string, string> {
  return {
    verify_new_device: s.verifyNewDevice ? "1" : "0",
    verify_new_ip: s.verifyNewIp ? "1" : "0",
    reverify_days: String(Math.min(365, Math.max(0, Math.trunc(s.reverifyDays)))),
    code_ttl_minutes: String(Math.min(60, Math.max(1, Math.trunc(s.codeTtlMinutes)))),
    max_attempts: String(Math.min(10, Math.max(1, Math.trunc(s.maxAttempts)))),
    resend_seconds: String(Math.min(600, Math.max(15, Math.trunc(s.resendSeconds)))),
  };
}

/* ── the dispatch token ─────────────────────────────────────────────────────
 * The anon-callable challenge functions (0057) authenticate the server the same
 * way the notification queue does: a token DERIVED from a key the server holds,
 * with only its hash in the database. Holding the anon key is not enough. */
function keyHex(): string | null {
  for (const candidate of [process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY, process.env.APP_ENCRYPTION_KEY]) {
    const hex = candidate?.trim();
    if (hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) return hex;
  }
  return null;
}

export function loginSecurityToken(): string | null {
  const hex = keyHex();
  if (!hex) return null;
  return createHash("sha256").update(`grovbase-login-security:${hex}`).digest("hex");
}

/** Publish sha256(token) so the SECURITY DEFINER functions can verify it.
 *  Idempotent; called on the paths that open or verify a challenge. */
export async function ensureLoginSecurityHash(supabase: Client): Promise<void> {
  const token = loginSecurityToken();
  if (!token) return;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "login_security_dispatch").maybeSingle();
  const current = (data?.value && typeof data.value === "object" && !Array.isArray(data.value)
    ? data.value : {}) as Record<string, unknown>;
  if (current.hash === hash) return;
  const { error } = await supabase.from("app_settings").upsert(
    { key: "login_security_dispatch", value: { ...current, hash }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) console.error("loginSecurity.hash", safeError(error));
}

/* ── the OTP ────────────────────────────────────────────────────────────────
 * Six digits, crypto-random. Only sha256(code) reaches the DB; the plaintext is
 * emailed and returned here for exactly that one send. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Constant-time compare for the challenge id we round-trip through the cookie,
 *  so a timing side channel cannot be used to guess it. */
export function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** A human label for the device — "iPhone • Safari" — from the User-Agent.
 *  Never a fingerprint: just enough for a person to recognise the session. */
export async function deviceLabel(): Promise<string> {
  const ua = (await headers()).get("user-agent") ?? "";
  const parts = describeUserAgent(ua);
  const left = parts.device || parts.os || "Urządzenie";
  const right = parts.browser || "";
  return right ? `${left} • ${right}` : left;
}

/* ── the security-code email ────────────────────────────────────────────────
 * Sent through the GrovBase transport the caller supplies (the same SMTP the
 * mailbox uses), never through Supabase. Dark, branded, inline-CSS. */
export function renderSecurityCodeEmail(input: {
  code: string;
  deviceLabel: string;
  when: Date;
}): { subject: string; html: string; text: string } {
  const subject = "Kod bezpieczeństwa logowania — GrovBase";
  const when = formatWarsaw(input.when);
  const spaced = input.code.slice(0, 3) + " " + input.code.slice(3);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

  const text = [
    "Nowe logowanie do GrovBase",
    "",
    "Otrzymaliśmy próbę logowania:",
    `Urządzenie: ${input.deviceLabel}`,
    `Czas: ${when}`,
    "",
    `Kod: ${spaced}`,
    "",
    "Kod wygasa za kilka minut.",
    "Jeżeli to nie Ty, nie udostępniaj kodu i zmień hasło.",
    "",
    "grovbase.com",
  ].join("\n");

  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#0b0710;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0710;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#141019;border:1px solid #2a2033;border-radius:16px;overflow:hidden;">
<tr><td style="padding:28px 32px 8px;">
<span style="font:700 20px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff;letter-spacing:-0.02em;">Grov<span style="color:#F950E1;">Base</span></span>
</td></tr>
<tr><td style="padding:8px 32px 0;">
<h1 style="margin:0;font:600 18px/1.35 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff;">Nowe logowanie do GrovBase</h1>
<p style="margin:12px 0 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#b9adc7;">Otrzymaliśmy próbę logowania na Twoje konto. Podaj poniższy kod, aby ją potwierdzić.</p>
</td></tr>
<tr><td style="padding:20px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0b16;border:1px solid #2a2033;border-radius:12px;">
<tr><td style="padding:14px 18px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9a8ea8;">Urządzenie<br><span style="color:#e9e2f0;font-weight:600;">${esc(input.deviceLabel)}</span></td></tr>
<tr><td style="padding:0 18px 14px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9a8ea8;">Czas<br><span style="color:#e9e2f0;font-weight:600;">${esc(when)}</span></td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:24px 32px 4px;">
<div style="display:inline-block;background:linear-gradient(135deg,#D628CF,#F950E1);border-radius:12px;padding:16px 28px;">
<span style="font:700 30px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffffff;letter-spacing:8px;">${esc(spaced)}</span>
</div>
</td></tr>
<tr><td align="center" style="padding:12px 32px 0;">
<p style="margin:0;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9a8ea8;">Kod wygasa za kilka minut.</p>
</td></tr>
<tr><td style="padding:20px 32px 28px;">
<p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#7d7188;">Jeżeli to nie Ty próbowałeś się zalogować, nie udostępniaj tego kodu nikomu i jak najszybciej zmień hasło.</p>
<p style="margin:14px 0 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#5f5569;">grovbase.com · © GrovBase</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject, html, text };
}

/* ── sending through GrovBase SMTP ───────────────────────────────────────────
 * The OTP goes out on the SAME transport the mailbox uses (contact@grovbase.com),
 * decrypted for one send. readIntegrationSecrets hands back the SMTP password as
 * plaintext (opened with the integrations key); smtpTransport wants the ciphertext
 * shape, so it is re-sealed with the app key for the length of the call — the same
 * bridge the notification dispatcher uses. Returns {sent,error}; never throws. */
export async function sendSecurityCode(
  supabase: Client,
  to: string,
  code: string,
  label: string,
): Promise<{ sent: boolean; error?: string }> {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  const password = secrets.smtp_password ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
  if (!config.smtp_host.trim() || !config.smtp_user.trim() || !password) {
    return { sent: false, error: "not_configured" };
  }
  if (!encryptionAvailable()) return { sent: false, error: "encryption_unavailable" };
  const sealed = encryptSecret(password);
  const smtp: SmtpConfig = {
    host: config.smtp_host,
    port: config.smtp_port,
    user: config.smtp_user,
    encryption: config.smtp_encryption === "starttls" ? "tls"
      : config.smtp_encryption === "ssl" ? "ssl" : "auto",
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    auth_tag: sealed.authTag,
  };
  const identity: MailIdentity = {
    from_name: config.from_name || "GrovBase",
    from_email: config.email,
    reply_to: config.email,
  };
  const { subject, html, text } = renderSecurityCodeEmail({ code, deviceLabel: label, when: new Date() });
  return deliverHtml({ to, subject, text, html }, identity, smtp);
}

/* ── the risk decision + challenge lifecycle ─────────────────────────────────
 * These are the two calls the gate and the step-up page make. Everything they
 * touch in the database is a SECURITY DEFINER function; nothing here trusts a
 * value the browser sent beyond the device cookie (whose hash the DB matches)
 * and the server-derived IP. */

export type RiskReason = "known" | "first_use" | "new_device" | "new_ip" | "stale" | "no_session";

/** Does this signed-in user, on this device+IP, need a code? Runs the DB risk
 *  check with the admin's knobs. `trusted` false means "challenge required". */
export async function evaluateRisk(
  supabase: Client,
  settings: LoginSecuritySettings,
  deviceHash: string | null,
  ipHash: string,
): Promise<{ trusted: boolean; reason: RiskReason }> {
  // Feature entirely off → nothing to enforce, and no DB round trip.
  if (!settings.verifyNewDevice && !settings.verifyNewIp && settings.reverifyDays === 0) {
    return { trusted: true, reason: "known" };
  }
  const { data, error } = await supabase.rpc("login_security_check", {
    p_device_hash: deviceHash ?? "",
    p_ip_hash: ipHash,
    p_verify_device: settings.verifyNewDevice,
    p_verify_ip: settings.verifyNewIp,
    p_reverify_days: settings.reverifyDays,
  });
  if (error) {
    // Fail CLOSED on a security check: a database hiccup must not wave an
    // unrecognised device through. The user sees the step-up, which recovers
    // the moment the check works again.
    console.error("loginSecurity.check", safeError(error));
    return { trusted: false, reason: "new_device" };
  }
  const row = (data && typeof data === "object" ? data : {}) as { trusted?: boolean; reason?: string };
  return { trusted: row.trusted === true, reason: (row.reason as RiskReason) ?? "new_device" };
}

/**
 * Open a challenge and email the code — unless a fresh one is already
 * outstanding, in which case the reload/re-entry just reuses it. `force`
 * (the resend button) bypasses the reuse but still honours the cooldown.
 * Returns what happened so the caller can show the right toast.
 */
export async function openOrReuseChallenge(
  supabase: Client,
  opts: {
    userId: string;
    email: string;
    deviceHash: string;
    ipHash: string;
    label: string;
    reason: RiskReason;
    settings: LoginSecuritySettings;
    force?: boolean;
  },
): Promise<{ status: "sent" | "reused" | "cooldown" | "not_configured" | "error"; waitSeconds?: number }> {
  await ensureLoginSecurityHash(supabase);
  const token = loginSecurityToken();
  if (!token) return { status: "error" };

  const { data: peek } = await supabase.rpc("login_challenge_peek", {
    p_token: token, p_user: opts.userId, p_device_hash: opts.deviceHash,
  });
  const live = peek && typeof peek === "object" ? peek as { age_seconds?: number } : null;
  if (live) {
    const age = typeof live.age_seconds === "number" ? live.age_seconds : 0;
    const wait = opts.settings.resendSeconds - age;
    if (!opts.force) return { status: "reused" };
    if (wait > 0) return { status: "cooldown", waitSeconds: wait };
  }

  const code = generateCode();
  const { data: id, error } = await supabase.rpc("login_challenge_open", {
    p_token: token,
    p_user: opts.userId,
    p_device_hash: opts.deviceHash,
    p_code_hash: hashCode(code),
    p_ip_hash: opts.ipHash,
    p_device_label: opts.label,
    p_reason: opts.reason,
    p_ttl_minutes: opts.settings.codeTtlMinutes,
    p_max_attempts: opts.settings.maxAttempts,
  });
  if (error || !id) {
    console.error("loginSecurity.open", safeError(error));
    return { status: "error" };
  }
  const sent = await sendSecurityCode(supabase, opts.email, code, opts.label);
  if (!sent.sent) return { status: sent.error === "not_configured" ? "not_configured" : "error" };
  return { status: "sent" };
}

/** Verify a submitted code. Thin wrapper over the DB verdict; on success the
 *  device is now trusted (the function upserted it), so the gate lets the user
 *  through on the next request with no cookie to forge. */
export async function verifyChallengeCode(
  supabase: Client,
  opts: { userId: string; deviceHash: string; ipHash: string; label: string; code: string },
): Promise<{ ok: boolean; reason?: string; attemptsLeft?: number }> {
  await ensureLoginSecurityHash(supabase);
  const token = loginSecurityToken();
  if (!token) return { ok: false, reason: "error" };
  const digits = opts.code.replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false, reason: "mismatch" };
  const { data, error } = await supabase.rpc("login_challenge_verify", {
    p_token: token,
    p_user: opts.userId,
    p_device_hash: opts.deviceHash,
    p_code_hash: hashCode(digits),
    p_ip_hash: opts.ipHash,
    p_device_label: opts.label,
  });
  if (error) {
    console.error("loginSecurity.verify", safeError(error));
    return { ok: false, reason: "error" };
  }
  const row = (data && typeof data === "object" ? data : {}) as
    { ok?: boolean; reason?: string; attempts_left?: number };
  return { ok: row.ok === true, reason: row.reason, attemptsLeft: row.attempts_left };
}

/**
 * THE GATE, used by both protected layouts.
 *
 * "Given the current session, may this request render, or must it verify?"
 * Returns null to allow, or the path to redirect to. It is the real security
 * boundary — there is no cookie a client can set to skip it: the only thing
 * that returns `trusted` is a trusted-device ROW, and that row is created only
 * by passing the emailed code (login_challenge_verify, token-gated). Deleting
 * the device cookie fails closed (new_device → challenge), never open.
 *
 * The step-up page lives outside both protected layouts, so it never gates
 * itself into a loop.
 */
export async function enforceLoginSecurity(supabase: Client): Promise<string | null> {
  const settings = await getLoginSecuritySettings(supabase);
  if (!settings.verifyNewDevice && !settings.verifyNewIp && settings.reverifyDays === 0) return null;
  const deviceHash = await readDeviceHash();
  const ipHash = hashIp(await callerIpRaw());
  const { trusted } = await evaluateRisk(supabase, settings, deviceHash, ipHash);
  if (trusted) return null;
  // FAIL OPEN when we could not actually deliver a code. A security step-up
  // whose email cannot be sent would lock every customer — and every admin —
  // out of the whole app with no way back. Availability wins here: the device
  // is let through and the gap is logged, rather than turning a mail outage
  // into a total lockout. In production the mailbox is configured, so this
  // path is the safety net, not the norm.
  if (!(await canSendSecurityMail(supabase))) {
    console.warn("loginSecurity.failOpen: step-up needed but security mail is not sendable");
    return null;
  }
  return "/auth/security-check";
}

/** Can we actually email a code right now? Both the SMTP transport and the
 *  dispatch token have to be in place, or a challenge is a dead end. */
export async function canSendSecurityMail(supabase: Client): Promise<boolean> {
  if (!loginSecurityToken() || !encryptionAvailable()) return false;
  try {
    const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
    const password = secrets.smtp_password ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
    return Boolean(config.smtp_host.trim() && config.smtp_user.trim() && config.email.trim() && password);
  } catch {
    return false;
  }
}

/** m***@gmail.com — enough for the customer to recognise the inbox, never the
 *  whole address on a page a shoulder-surfer might see. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const name = email.slice(0, at);
  const domain = email.slice(at);
  const head = name.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, Math.min(6, name.length - 1)))}${domain}`;
}
