import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM authenticated encryption for provider credentials.
 * The master key lives ONLY in the server env (APP_ENCRYPTION_KEY, 32-byte hex).
 * Plaintext secrets are never persisted and never sent to the browser.
 */
/**
 * 32 bytes as 64 hex characters, or nothing.
 *
 * The length test alone was not enough. Buffer.from(x, "hex") does not throw on
 * a non-hex string — it stops at the first invalid pair and hands back a SHORT
 * buffer — so a 64-character value that is not actually hex (a pasted base64
 * key, a quoted value, a key with a stray character) used to pass the check,
 * report the module as ready, and then fail deep inside createCipheriv with an
 * "Invalid key length" that says nothing about the real mistake. Worse, the two
 * callers disagreed: lib/server/integrations.ts has always required hex, so the
 * communications panel and the rest of the app could reach opposite conclusions
 * about the same key.
 */
const KEY_HEX = /^[0-9a-fA-F]{64}$/;

function validKeyHex(raw: string | null | undefined): string | null {
  const hex = raw?.trim();
  return hex && KEY_HEX.test(hex) ? hex : null;
}

function resolveKey(hex: string | null | undefined): Buffer {
  const valid = validKeyHex(hex);
  if (!valid) throw new Error("encryption_key_missing");
  return Buffer.from(valid, "hex");
}

export function encryptionAvailable(): boolean {
  return validKeyHex(process.env.APP_ENCRYPTION_KEY) !== null;
}

/**
 * The same cipher, with the key supplied by the caller. Modules that own their
 * own key (the communications integrations) use these; everything already
 * encrypted with APP_ENCRYPTION_KEY keeps using the pair below, unchanged.
 */
export function encryptWith(keyHex: string, plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(keyHex), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptWith(keyHex: string, ciphertext: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", resolveKey(keyHex), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** The default pair: the app's master key, same ciphertext format as always. */
export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  return encryptWith(process.env.APP_ENCRYPTION_KEY ?? "", plaintext);
}

export function decryptSecret(ciphertext: string, iv: string, authTag: string): string {
  return decryptWith(process.env.APP_ENCRYPTION_KEY ?? "", ciphertext, iv, authTag);
}
