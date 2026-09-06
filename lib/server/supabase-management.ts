import "server-only";
import { createHash } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { readIntegrationSecrets, safeError, type MailConfig } from "@/lib/server/integrations";
import { AUTH_EMAIL_TEMPLATES } from "@/lib/server/auth-email-templates";

/**
 * SUPABASE AUTH SYNC — the automated half of "make GoTrue send OUR mails".
 *
 * Authentication settings (Site URL, redirect allow-list, mail templates,
 * custom SMTP) live in the Supabase CONTROL PLANE, not in the project's
 * database — no migration and no repo file changes them. The only automated
 * doors are the Management API and the CLI's `config push`, and both need a
 * personal access token. This module drives the Management API door:
 *
 *   PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
 *
 * with exactly the fields GrovBase owns — a PARTIAL update, so dashboard-only
 * settings (OAuth providers, rate limits) are never touched.
 *
 * Secrets discipline: the token comes exclusively from the server-only
 * SUPABASE_MANAGEMENT_TOKEN env var (the admin adds it in Vercel; it is never
 * in the repo and never reaches the client). The SMTP password is read from
 * the admin-entered mailbox integration (sealed with the app key), sent once
 * over TLS inside the PATCH body, and excluded from the fingerprint, the
 * status row, every error message and every log line.
 *
 * Honesty (A12): the status stored here is what the UI shows. "Synced" is
 * only ever written after a verification GET confirms the non-secret fields
 * actually landed; anything less is "pending", "error" or "manual".
 */

export const SUPABASE_PROJECT_REF = "orjkxijqpecnbzhxhfct";
const API_BASE = "https://api.supabase.com/v1";
const SYNC_KEY = "supabase_auth_sync";
const TIMEOUT_MS = 20_000;

export const AUTH_SITE_URL = "https://grovbase.com";
export const AUTH_REDIRECT_ALLOW_LIST = [
  "https://grovbase.com/auth/callback",
  "https://grovbase.com/auth/confirm",
  "https://grovbase.com/auth/verified",
  "https://grovbase.com/reset-password",
  "https://grovbase.com/**",
].join(",");

export function managementToken(): string | null {
  const raw = process.env.SUPABASE_MANAGEMENT_TOKEN?.trim();
  return raw ? raw : null;
}

/* ── the desired configuration ──────────────────────────────────────────────*/

type SmtpPart = {
  smtp_admin_email: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_sender_name: string;
  /** Write-only; excluded from fingerprints, statuses and errors. */
  smtp_pass: string;
};

export type DesiredAuthConfig = {
  /** Non-secret fields — PATCHed and then VERIFIED with a follow-up GET. */
  base: Record<string, string | boolean>;
  /** SMTP block, present only when the mailbox integration is complete. */
  smtp: SmtpPart | null;
};

/** What the mail surface of the project SHOULD look like, built from the same
 *  files GoTrue would get pasted into the dashboard. */
export async function desiredAuthConfig(supabase: Client): Promise<DesiredAuthConfig> {
  const confirm = AUTH_EMAIL_TEMPLATES["auth.confirm_signup"]!;
  const recovery = AUTH_EMAIL_TEMPLATES["auth.reset_password"]!;
  const base: Record<string, string | boolean> = {
    site_url: AUTH_SITE_URL,
    uri_allow_list: AUTH_REDIRECT_ALLOW_LIST,
    // Confirmations stay ON — the whole flow depends on the mail arriving.
    mailer_autoconfirm: false,
    mailer_subjects_confirmation: confirm.subject,
    mailer_templates_confirmation_content: confirm.html,
    mailer_subjects_recovery: recovery.subject,
    mailer_templates_recovery_content: recovery.html,
  };

  let smtp: SmtpPart | null = null;
  try {
    const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
    const password = secrets.smtp_password
      ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
    if (config.smtp_host.trim() && config.smtp_user.trim() && config.email.trim() && password) {
      smtp = {
        smtp_admin_email: config.email.trim(),
        smtp_host: config.smtp_host.trim(),
        smtp_port: String(config.smtp_port || 587),
        smtp_user: config.smtp_user.trim(),
        smtp_sender_name: config.from_name?.trim() || "GrovBase",
        smtp_pass: password,
      };
    }
  } catch {
    smtp = null;
  }
  return { base, smtp };
}

/** Stable digest of everything non-secret we intend to push. When the repo
 *  templates change (a redeploy) or the mailbox settings change, this changes,
 *  and a previously green status honestly degrades to "changes pending". */
export function desiredFingerprint(desired: DesiredAuthConfig): string {
  const { smtp_pass: _omitted, ...smtpPublic } = desired.smtp ?? ({} as SmtpPart);
  const stable = JSON.stringify({
    base: Object.fromEntries(Object.entries(desired.base).sort(([a], [b]) => a.localeCompare(b))),
    smtp: desired.smtp ? Object.fromEntries(Object.entries(smtpPublic).sort(([a], [b]) => a.localeCompare(b))) : null,
  });
  return createHash("sha256").update(stable).digest("hex");
}

/* ── Management API calls ───────────────────────────────────────────────────*/

async function api(
  token: string,
  method: "GET" | "PATCH",
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}/projects/${SUPABASE_PROJECT_REF}/config/auth`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const parsed = await res.json() as { message?: string };
        if (typeof parsed?.message === "string") detail = parsed.message;
      } catch { /* non-JSON error body */ }
      return { ok: false, error: `HTTP ${res.status}${detail ? ` — ${safeError(detail)}` : ""}` };
    }
    const data = await res.json();
    return { ok: true, data: (data && typeof data === "object" ? data : {}) as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }
}

/* ── the persisted status row ───────────────────────────────────────────────*/

type StoredSync = {
  status?: string;       // 'synced' | 'error'
  at?: string;           // ISO of the last ATTEMPT
  synced_at?: string;    // ISO of the last VERIFIED success
  error?: string;
  fingerprint?: string;  // desired fingerprint at the last verified success
  smtp?: string;         // '1' when that success included the SMTP block
};

async function readStored(supabase: Client): Promise<StoredSync> {
  try {
    const { data } = await supabase
      .from("app_settings").select("value").eq("key", SYNC_KEY).maybeSingle();
    return (data?.value && typeof data.value === "object" && !Array.isArray(data.value)
      ? data.value : {}) as StoredSync;
  } catch {
    return {};
  }
}

async function writeStored(supabase: Client, row: StoredSync): Promise<void> {
  const { error } = await supabase.from("app_settings").upsert(
    { key: SYNC_KEY, value: { ...row }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) console.error("authSync.store", safeError(error));
}

/* ── what the admin panel shows ─────────────────────────────────────────────*/

export type AuthSyncView = {
  /** synced ● | pending ● | error ● | manual ● — the four A11 states. */
  state: "synced" | "pending" | "error" | "manual";
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  tokenPresent: boolean;
  /** The desired payload currently includes a complete SMTP block. */
  smtpReady: boolean;
  /** The last verified sync pushed the SMTP block too. */
  smtpSynced: boolean;
};

export async function readAuthSyncView(supabase: Client): Promise<AuthSyncView> {
  const tokenPresent = managementToken() !== null;
  const [stored, desired] = await Promise.all([readStored(supabase), desiredAuthConfig(supabase)]);
  const fp = desiredFingerprint(desired);
  const syncedCurrent = stored.status === "synced" && stored.fingerprint === fp;
  const state: AuthSyncView["state"] = syncedCurrent
    ? "synced"
    : !tokenPresent
      ? "manual"
      : stored.status === "error"
        ? "error"
        : "pending";
  return {
    state,
    lastSyncAt: stored.synced_at ?? null,
    lastAttemptAt: stored.at ?? null,
    error: state === "error" ? (stored.error ?? null) : null,
    tokenPresent,
    smtpReady: desired.smtp !== null,
    smtpSynced: syncedCurrent && stored.smtp === "1",
  };
}

/* ── the sync itself ────────────────────────────────────────────────────────*/

/** Fields verified after the PATCH. Template bodies included — a truncated or
 *  rejected template must not report green. */
const VERIFY_FIELDS = [
  "site_url",
  "uri_allow_list",
  "mailer_subjects_confirmation",
  "mailer_templates_confirmation_content",
  "mailer_subjects_recovery",
  "mailer_templates_recovery_content",
] as const;

export type AuthSyncResult =
  | { ok: true; smtpIncluded: boolean; view: AuthSyncView }
  | { ok: false; reason: "no_token" | "api"; error?: string; view: AuthSyncView };

export async function runAuthSync(supabase: Client): Promise<AuthSyncResult> {
  const token = managementToken();
  const now = new Date().toISOString();
  if (!token) {
    return { ok: false, reason: "no_token", view: await readAuthSyncView(supabase) };
  }

  const desired = await desiredAuthConfig(supabase);
  const fp = desiredFingerprint(desired);
  const stored = await readStored(supabase);

  const fail = async (error: string): Promise<AuthSyncResult> => {
    await writeStored(supabase, { ...stored, status: "error", at: now, error });
    return { ok: false, reason: "api", error, view: await readAuthSyncView(supabase) };
  };

  // 1. Prove the token + project before writing anything.
  const before = await api(token, "GET");
  if (!before.ok) return fail(before.error);

  // 2. Partial update: only the fields GrovBase owns.
  const body: Record<string, unknown> = { ...desired.base, ...(desired.smtp ?? {}) };
  const patched = await api(token, "PATCH", body);
  if (!patched.ok) return fail(patched.error);

  // 3. Trust nothing: read the config back and compare the non-secret fields.
  const after = await api(token, "GET");
  if (!after.ok) return fail(`verify: ${after.error}`);
  const mismatched = VERIFY_FIELDS.filter((f) =>
    f in desired.base && after.data[f] !== desired.base[f]);
  if (desired.smtp && after.data.smtp_host !== desired.smtp.smtp_host) mismatched.push("smtp_host" as never);
  if (mismatched.length > 0) return fail(`verify mismatch: ${mismatched.join(", ")}`);

  await writeStored(supabase, {
    status: "synced",
    at: now,
    synced_at: now,
    error: "",
    fingerprint: fp,
    smtp: desired.smtp ? "1" : "0",
  });
  return { ok: true, smtpIncluded: desired.smtp !== null, view: await readAuthSyncView(supabase) };
}
