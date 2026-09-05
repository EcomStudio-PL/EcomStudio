import "server-only";
import { createHash } from "crypto";
import type { Json } from "@/lib/database.types";
import type { Client } from "@/lib/services/workspace";
import { decryptWith, encryptWith } from "@/lib/server/crypto";

/**
 * COMMUNICATION INTEGRATIONS — the single door to the mail and Telegram rows.
 *
 * Two rules shape this file. First, a credential typed by an admin must never
 * come back out: the row keeps AES-256-GCM ciphertext, `readIntegration`
 * answers with `hasSecret` booleans, and only `readIntegrationSecrets` — used
 * inside a request, never serialised — decrypts. Second, a save form posts an
 * empty password field when the admin did not retype it, so "absent" and ""
 * mean KEEP; only an explicit null deletes.
 *
 * Nothing here throws at the caller. A missing table, an RLS refusal or a
 * rotated key degrades to defaults / no secrets, because a broken integration
 * must never take a page or a signup down with it.
 */

export type IntegrationType = "mail" | "telegram";
export type IntegrationStatus = "not_configured" | "connected" | "error";

export type MailConfig = {
  account_name: string;
  email: string;
  from_name: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: "starttls" | "ssl" | "none";
  smtp_user: string;
  smtp_same_as_imap: boolean;
  mirror_to_email_settings: boolean;
  sent_folder: string;
};

export type TelegramConfig = { chat_id: string; channel_name: string };

/**
 * Prefill only — every one of these stays editable in the admin panel. They
 * match the seed in 0052_communications.sql so a row that was never saved and
 * a row that was saved with the defaults read back identically.
 */
export const MAIL_DEFAULTS: MailConfig = {
  account_name: "GrovBase",
  email: "contact@grovbase.com",
  from_name: "GrovBase",
  imap_host: "host483417.hostido.net.pl",
  imap_port: 993,
  imap_secure: true,
  imap_user: "contact@grovbase.com",
  smtp_host: "host483417.hostido.net.pl",
  smtp_port: 587,
  smtp_encryption: "starttls",
  smtp_user: "contact@grovbase.com",
  smtp_same_as_imap: true,
  mirror_to_email_settings: false,
  sent_folder: "",
};

export const TELEGRAM_DEFAULTS: TelegramConfig = {
  chat_id: "",
  channel_name: "GrovBase — Powiadomienia",
};

export type IntegrationView<C> = {
  type: IntegrationType;
  enabled: boolean;
  config: C;
  status: IntegrationStatus;
  last_tested_at: string | null;
  last_error_safe: string | null;
  /** One entry per secret this integration owns — true means a ciphertext is
   *  stored. The plaintext itself never leaves the server. */
  hasSecret: Record<string, boolean>;
};

/** The secret names each integration owns; they are also the jsonb keys. */
const SECRET_NAMES: Record<IntegrationType, readonly string[]> = {
  mail: ["imap_password", "smtp_password"],
  telegram: ["bot_token"],
};

/** One stored secret: ciphertext / iv / auth tag, all base64. */
type SecretBlob = { c: string; i: string; t: string };
type SecretBag = Record<string, SecretBlob>;

const SELECT_COLUMNS = "enabled, config, secrets, status, last_tested_at, last_error_safe";

/**
 * The key these secrets are encrypted with: a dedicated one when the operator
 * wants mail and Telegram on their own key, otherwise the app key that
 * production already carries. A malformed dedicated key falls through to the
 * app key rather than disabling the whole module — nothing was ever encrypted
 * with a key that could not be parsed.
 */
function integrationsKeyHex(): string | null {
  for (const candidate of [process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY, process.env.APP_ENCRYPTION_KEY]) {
    const hex = candidate?.trim();
    if (hex && hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) return hex;
  }
  return null;
}

export function integrationsEncryptionAvailable(): boolean {
  return integrationsKeyHex() !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function defaultsFor(type: IntegrationType): Record<string, unknown> {
  return type === "mail" ? { ...MAIL_DEFAULTS } : { ...TELEGRAM_DEFAULTS };
}

function asStatus(value: unknown): IntegrationStatus {
  return value === "connected" || value === "error" ? value : "not_configured";
}

/** Keep only entries that actually look like a stored blob; a half-written
 *  row must not make decryption throw later. */
function readBag(value: unknown): SecretBag {
  const out: SecretBag = {};
  for (const [name, blob] of Object.entries(asRecord(value))) {
    const b = blob as Partial<SecretBlob> | null;
    if (b && typeof b.c === "string" && typeof b.i === "string" && typeof b.t === "string") {
      out[name] = { c: b.c, i: b.i, t: b.t };
    }
  }
  return out;
}

async function readRow(supabase: Client, type: IntegrationType) {
  const { data, error } = await supabase
    .from("integration_settings")
    .select(SELECT_COLUMNS)
    .eq("type", type)
    .maybeSingle();
  // A refusal here is not the same as "not configured", and silence would make
  // the two indistinguishable while debugging. The message is scrubbed anyway.
  if (error) console.error("integrations.read", type, safeError(error));
  return data ?? null;
}

/** The admin-panel view. It carries no plaintext, by construction. */
export async function readIntegration<C>(supabase: Client, type: IntegrationType): Promise<IntegrationView<C>> {
  const row = await readRow(supabase, type);
  const bag = readBag(row?.secrets);
  const hasSecret: Record<string, boolean> = {};
  for (const name of SECRET_NAMES[type]) hasSecret[name] = Boolean(bag[name]);
  return {
    type,
    enabled: row?.enabled === true,
    config: { ...defaultsFor(type), ...asRecord(row?.config) } as C,
    status: asStatus(row?.status),
    last_tested_at: row?.last_tested_at ?? null,
    last_error_safe: row?.last_error_safe ?? null,
    hasSecret,
  };
}

/**
 * Server-only: config plus decrypted secrets, for the code that actually talks
 * to IMAP/SMTP/Telegram. The result must never be returned from an action or a
 * route. A wrong or rotated key yields an EMPTY secrets object instead of an
 * exception, so the UI can report comm.err.decrypt and the admin can retype.
 */
export async function readIntegrationSecrets<C>(
  supabase: Client,
  type: IntegrationType,
): Promise<{ enabled: boolean; config: C; secrets: Record<string, string> }> {
  const row = await readRow(supabase, type);
  const config = { ...defaultsFor(type), ...asRecord(row?.config) } as C;
  const enabled = row?.enabled === true;
  const bag = readBag(row?.secrets);
  const keyHex = integrationsKeyHex();
  if (!keyHex) return { enabled, config, secrets: {} };
  const secrets: Record<string, string> = {};
  try {
    for (const [name, blob] of Object.entries(bag)) secrets[name] = decryptWith(keyHex, blob.c, blob.i, blob.t);
  } catch {
    // All or nothing: half-decrypted credentials would look "configured" and
    // then fail at the provider with a far more confusing error.
    console.error("integrations.decrypt", type);
    return { enabled, config, secrets: {} };
  }
  return { enabled, config, secrets };
}

/**
 * Secret merge semantics, and the reason they live in their own pure function:
 * an absent key KEEPS the stored ciphertext, a string REPLACES it, null
 * DELETES it. An empty string is treated as absent too — that is what an
 * untouched password field posts, and overwriting a working credential with ""
 * is the one mistake this module can never make.
 */
export function mergeSecrets(current: SecretBag, patch: Record<string, string | null> | undefined): SecretBag {
  const out: SecretBag = { ...current };
  for (const [name, value] of Object.entries(patch ?? {})) {
    if (value === null) {
      delete out[name];
      continue;
    }
    if (typeof value !== "string" || value === "") continue;
    const keyHex = integrationsKeyHex();
    if (!keyHex) throw new Error("encryption_unavailable");
    const enc = encryptWith(keyHex, value);
    out[name] = { c: enc.ciphertext, i: enc.iv, t: enc.authTag };
  }
  return out;
}

/**
 * Save a patch. Config merges per key (an undefined value is "not part of this
 * patch", so a form that posts one field cannot blank the rest) and secrets
 * merge by the rules above.
 */
export async function writeIntegration<C>(
  supabase: Client,
  type: IntegrationType,
  patch: { config?: Partial<C>; enabled?: boolean; secrets?: Record<string, string | null> },
): Promise<{ ok: boolean; error?: string }> {
  const wantsNewSecret = Object.values(patch.secrets ?? {}).some((v) => typeof v === "string" && v !== "");
  if (wantsNewSecret && !integrationsEncryptionAvailable()) return { ok: false, error: "encryption_unavailable" };

  const row = await readRow(supabase, type);
  const config = { ...defaultsFor(type), ...asRecord(row?.config) };
  for (const [key, value] of Object.entries(asRecord(patch.config))) {
    if (value !== undefined) config[key] = value;
  }

  let secrets: SecretBag;
  try {
    secrets = mergeSecrets(readBag(row?.secrets), patch.secrets);
  } catch (e) {
    return { ok: false, error: safeError(e) };
  }

  // Who changed it, for the audit trail the admin panel shows. An anonymous
  // caller can never reach this write anyway — RLS keeps the table admin-only.
  const { data: auth } = await supabase.auth.getUser();
  // upsert, not update: the seed row exists in every environment, but a saved
  // integration must not silently no-op if it somehow does not.
  const { error } = await supabase.from("integration_settings").upsert(
    {
      type,
      enabled: patch.enabled ?? row?.enabled === true,
      // `config` is merged from the caller's patch and so is typed
      // Record<string, unknown>, which is wider than the `Json` a jsonb column
      // generates as. The values are plain JSON by construction, but the
      // compiler cannot see that — hence this one assertion, on this one field.
      // `secrets` needs none: SecretBag is already Json-shaped.
      config: config as Json,
      secrets,
      updated_at: new Date().toISOString(),
      updated_by: auth.user?.id ?? null,
    },
    { onConflict: "type" },
  );
  if (error) return { ok: false, error: safeError(error) };
  return { ok: true };
}

/** Record the outcome of a connection test. Success clears the stale error. */
export async function setIntegrationStatus(
  supabase: Client,
  type: IntegrationType,
  status: IntegrationStatus,
  errorSafe?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("integration_settings")
    .update({
      status,
      last_tested_at: now,
      last_error_safe: status === "error" && errorSafe ? safeError(errorSafe) : null,
      updated_at: now,
    })
    .eq("type", type);
  if (error) console.error("integrations.status", type, safeError(error));
}

/**
 * The password the cron and the notification dispatch present to the database.
 *
 * It is DERIVED from a key the server already holds, so no new env var is
 * needed on a deployment that has none to spare. The database only ever stores
 * sha256(token): holding the anon key — which every browser has — is therefore
 * not enough to claim an outbox row or read the mail credentials.
 */
export function dispatchToken(): string | null {
  const keyHex = integrationsKeyHex();
  if (!keyHex) return null;
  return createHash("sha256").update(`grovbase-notify-dispatch:${keyHex}`).digest("hex");
}

/** Publish sha256(token) so the SECURITY DEFINER functions can verify it.
 *  Idempotent, and it merges into the "notifications" row rather than
 *  replacing it — other settings live there too. */
export async function ensureDispatchHash(supabase: Client): Promise<void> {
  const token = dispatchToken();
  if (!token) return;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "notifications").maybeSingle();
  const current = (data?.value && typeof data.value === "object" && !Array.isArray(data.value)
    ? data.value
    : {}) as Record<string, Json | undefined>;
  if (current.dispatch_hash === hash) return;
  const { error } = await supabase.from("app_settings").upsert(
    { key: "notifications", value: { ...current, dispatch_hash: hash }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) console.error("integrations.dispatchHash", safeError(error));
}

/**
 * Anything a mail server, Telegram or PostgREST says can end up on an admin's
 * screen and in a database column, and those messages sometimes quote the
 * request that failed. Scrub first, then trim.
 */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  // Telegram bot tokens, including inside an api.telegram.org/bot<token>/ URL.
  [/\d{5,}:[A-Za-z0-9_-]{30,}/g, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  // password=…, "token": "…", api_key: … — the key quoted or bare, the value
  // quoted or bare, which is how mail servers and JSON APIs both phrase it.
  [/\b(pass(?:word|wd)?|token|secret|api[_-]?key|authorization)\b("?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[redacted]"],
  // Basic-auth credentials carried in a URL.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[redacted]@"],
];

export function safeError(e: unknown): string {
  let out = messageOf(e).replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.slice(0, 200);
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(e);
}
