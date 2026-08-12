import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM authenticated encryption for provider credentials.
 * The master key lives ONLY in the server env (APP_ENCRYPTION_KEY, 32-byte hex).
 * Plaintext secrets are never persisted and never sent to the browser.
 */
function masterKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.trim().length !== 64) throw new Error("encryption_key_missing");
  return Buffer.from(hex.trim(), "hex");
}

export function encryptionAvailable(): boolean {
  const hex = process.env.APP_ENCRYPTION_KEY;
  return Boolean(hex && hex.trim().length === 64);
}

export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(ciphertext: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
