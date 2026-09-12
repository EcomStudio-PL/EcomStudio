import "server-only";
import { randomBytes } from "crypto";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { safeError } from "@/lib/server/integrations";
import { putSecret, readSecret, secretName } from "@/lib/server/secret-store";

/**
 * THE SEND EMAIL HOOK SECRET — where it lives, and why not in a chat window.
 *
 * Supabase signs every hook delivery with a shared secret. Two ways to have
 * one, and this file supports both so the operator does not have to care:
 *
 *  1. GENERATED HERE (preferred). The panel presses a button, this file makes
 *     32 random bytes, stores them in Supabase Vault (migration 0078), and the
 *     Management API push writes the same value into Supabase. The
 *     secret never appears on a screen, in a chat message, in a log line or
 *     in an environment variable — nobody has to copy it anywhere, which is
 *     the only way a copied secret cannot be mislaid.
 *
 *  2. AN ENVIRONMENT VARIABLE. If the operator would rather generate it in
 *     the Supabase dashboard and paste it into Vercel themselves, they set
 *     SUPABASE_SEND_EMAIL_HOOK_SECRET and this file simply reads it. Server
 *     only — never NEXT_PUBLIC_, never logged, never returned to a client.
 *
 * When both exist the environment wins, because an env var is an explicit act
 * by a person and a stored value could be left over from an earlier attempt.
 *
 * Standard Webhooks format: `v1,whsec_<base64>`. Several may be configured at
 * once, separated by `|`, which is how a rotation happens without downtime.
 *
 * WHERE THE SEALED COPY LIVES. It used to be an AES envelope in app_settings,
 * sealed with APP_ENCRYPTION_KEY — which meant the panel's "generate" button
 * was dead whenever that variable was missing. It is a vault secret now, like
 * every other credential GrovBase manages; the app_settings row keeps only the
 * timestamps the panel displays. An envelope written before that change is
 * still read, so a deployment mid-migration keeps verifying deliveries.
 */

const SETTINGS_KEY = "auth_email_hook";

export function envSecret(): string | null {
  const raw = process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET?.trim();
  return raw ? raw : null;
}

/** The vault name for the hook secret. */
const VAULT_NAME = secretName("auth_hook", "secret");

type StoredHook = {
  /** Legacy AES-256-GCM envelope, app key. Read, never written. */
  ciphertext?: string;
  iv?: string;
  auth_tag?: string;
  /** When it was generated, for the panel. Never the value. */
  created_at?: string;
  /** Whether the Management API push confirmed Supabase has it. */
  pushed_at?: string;
  hook_uri?: string;
};

async function readStored(supabase: Client): Promise<StoredHook> {
  try {
    const { data } = await supabase
      .from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const v = data?.value;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StoredHook) : {};
  } catch {
    return {};
  }
}

async function writeStored(supabase: Client, value: StoredHook): Promise<boolean> {
  const { error } = await supabase.from("app_settings").upsert(
    { key: SETTINGS_KEY, value: value as never, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) console.error("authHook.store", safeError(error));
  return !error;
}

/** A fresh secret in the format Supabase expects. */
export function generateSecret(): string {
  return `v1,whsec_${randomBytes(32).toString("base64")}`;
}

/**
 * The secret the ENDPOINT verifies against — env first, then the sealed
 * store. Returns "" when the hook has not been configured yet, which the
 * endpoint reports as "not configured" rather than pretending to verify.
 */
export async function activeSecret(supabase: Client): Promise<string> {
  const fromEnv = envSecret();
  if (fromEnv) return fromEnv;

  // The vault is authoritative — a secret generated since the migration lives
  // there and needs no key of ours. This call is made by the hook ENDPOINT,
  // which has no admin session, so it is authorised by the proof-of-server
  // token that readSecret attaches.
  const fromVault = await readSecret(supabase, VAULT_NAME);
  if (fromVault) return fromVault;

  // A pre-migration envelope, for a deployment that has not regenerated yet.
  const stored = await readStored(supabase);
  if (!stored.ciphertext || !stored.iv || !stored.auth_tag) return "";
  if (!encryptionAvailable()) return "";
  try {
    return decryptSecret(stored.ciphertext, stored.iv, stored.auth_tag);
  } catch {
    return "";
  }
}

/** Store a newly generated secret. The plaintext is returned to the CALLER —
 *  the server-side push — and to nobody else. */
export async function storeSecret(supabase: Client, secret: string): Promise<boolean> {
  const sealed = await putSecret(supabase, VAULT_NAME, secret);
  if (!sealed.ok) return false;
  const previous = await readStored(supabase);
  // The envelope columns are deliberately NOT carried forward: the vault now
  // holds the live value, and leaving a stale ciphertext beside it would make
  // activeSecret's fallback answer with a secret that is no longer current.
  return writeStored(supabase, {
    created_at: new Date().toISOString(),
    hook_uri: previous.hook_uri,
  });
}

/** Record that Supabase confirmed it holds this secret for this URL. */
export async function markPushed(supabase: Client, uri: string): Promise<void> {
  const previous = await readStored(supabase);
  await writeStored(supabase, { ...previous, pushed_at: new Date().toISOString(), hook_uri: uri });
}

export type HookSecretState = {
  /** Where the endpoint would get its secret from right now. */
  source: "env" | "stored" | "none";
  generatedAt: string | null;
  pushedAt: string | null;
  hookUri: string | null;
  /** Whether generating one can work. Always true now: an admin session is
   *  the only requirement, and only an admin reaches this screen. */
  canGenerate: boolean;
};

/** Everything the admin panel may know about the secret — and nothing of its
 *  value. */
export async function hookSecretState(supabase: Client): Promise<HookSecretState> {
  const stored = await readStored(supabase);
  // Either store counts as "we have one": the vault for anything generated
  // since the migration, the envelope for anything older.
  const inVault = Boolean(await readSecret(supabase, VAULT_NAME));
  const hasLegacy = Boolean(stored.ciphertext && stored.iv && stored.auth_tag && encryptionAvailable());
  return {
    source: envSecret() ? "env" : inVault || hasLegacy ? "stored" : "none",
    generatedAt: stored.created_at ?? null,
    pushedAt: stored.pushed_at ?? null,
    hookUri: stored.hook_uri ?? null,
    canGenerate: true,
  };
}
