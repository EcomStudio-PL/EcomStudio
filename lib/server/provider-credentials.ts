import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { putSecret, readSecret, secretName } from "@/lib/server/secret-store";

/**
 * AI PROVIDER API KEYS — Photoroom, OpenAI, Gemini, fal, whatever comes next.
 *
 * These are operator-managed secrets like any other, so they live in the same
 * store as the mailbox password: Supabase Vault, via lib/server/secret-store.
 * Stage 22 of the brief is explicit about why — an operator must be able to add
 * a provider key from the GrovBase panel without pasting anything into a deploy
 * platform, and that is only true if storing it needs no key from one.
 *
 * WHAT STAYS IN ai_provider_credentials. Everything that is not the secret:
 * which provider, the base URL, the last four characters, the test verdicts,
 * who changed it and when. The panel reads that row freely; it just no longer
 * holds anything worth stealing.
 *
 * THE SENTINEL. encrypted_value / iv / auth_tag are NOT NULL columns and this
 * code is not going to alter a production table to write a null. A row whose
 * secret lives in the vault carries VAULT_SENTINEL in all three, which reads
 * plainly in a database client and can never be mistaken for base64 ciphertext.
 * Rows written before this change still hold real ciphertext and are still
 * opened with the app key, so nothing that worked yesterday stops working.
 */

/** Written into the ciphertext columns when the real secret is in the vault. */
export const VAULT_SENTINEL = "vault";

/** `grovbase.provider.<uuid>` — the vault name for one provider's API key. */
export function providerSecretName(providerId: string): string {
  return secretName("provider", providerId);
}

/** The three columns to write when the secret went to the vault. */
export function vaultPlaceholderColumns(): { encrypted_value: string; iv: string; auth_tag: string } {
  return { encrypted_value: VAULT_SENTINEL, iv: VAULT_SENTINEL, auth_tag: VAULT_SENTINEL };
}

/** The ciphertext columns as any of the readers below receive them. */
export type LegacyCredential = {
  encrypted_value: string | null;
  iv: string | null;
  auth_tag: string | null;
};

/**
 * Store a provider key. Admin session only — no encryption key involved, which
 * is the entire point.
 */
export async function writeProviderKey(
  supabase: Client, providerId: string, apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return putSecret(supabase, providerSecretName(providerId), apiKey);
}

/**
 * The key for one provider call.
 *
 * The vault is asked first and is authoritative: a key saved from the panel
 * must beat a stale ciphertext from before the migration. Only when the vault
 * has nothing is the legacy ciphertext opened, and only when it is real
 * ciphertext rather than the sentinel.
 *
 * Returns null when there is no usable key. Callers treat that as "this
 * provider is not configured" — never as an error to show a customer.
 */
export async function readProviderKey(
  supabase: Client, providerId: string, legacy?: LegacyCredential | null,
): Promise<string | null> {
  const fromVault = await readSecret(supabase, providerSecretName(providerId));
  if (fromVault) return fromVault;

  if (!legacy?.encrypted_value || !legacy.iv || !legacy.auth_tag) return null;
  if (legacy.encrypted_value === VAULT_SENTINEL) return null;
  if (!encryptionAvailable()) return null;
  try { return decryptSecret(legacy.encrypted_value, legacy.iv, legacy.auth_tag); }
  catch { return null; }
}
