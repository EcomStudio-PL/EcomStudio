import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * THE CLEAN ORIGINAL AT REST — AES-256-GCM, one random key per original.
 *
 * GrovBase has no service-role key: the server reads storage as the customer,
 * so whatever the server can read, the customer could read with their own
 * session too. The clean original therefore sits in its bucket as ciphertext,
 * and its key lives only in `trial_original_keys` — a table no client role
 * can touch, handed to the server by token-gated functions only when an
 * unlock is allowed (or when Miniaturka needs the clean pass as its input).
 *
 * Destroying the key — at expiry, on delete, after an unlock — makes the
 * original unrecoverable at once, whenever the blob itself is purged.
 *
 * Blob: "GBWM1" | iv (12) | tag (16) | ciphertext. The additional
 * authenticated data binds the blob to its workspace AND its original's id,
 * so a blob cannot be passed off as another original's, or another tenant's:
 * it would fail authentication.
 *
 * The per-original key is itself stored WRAPPED (keys.ts), under a key the
 * database never sees — a database dump alone opens nothing.
 */

const MAGIC = Buffer.from("GBWM1", "latin1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TrialOriginalCryptoError extends Error {
  constructor(public readonly code: "bad_key" | "bad_blob" | "auth_failed") {
    super(code);
  }
}

/** A fresh 32-byte key. */
export function newOriginalKey(): Buffer {
  return randomBytes(32);
}

function aad(workspaceId: string, originalId: string): Buffer {
  return Buffer.from(`GBWM1|${workspaceId}|${originalId}`, "utf8");
}

export function sealOriginal(clean: Buffer, key: Buffer, workspaceId: string, originalId: string): Buffer {
  if (key.length !== 32) throw new TrialOriginalCryptoError("bad_key");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(workspaceId, originalId));
  const body = Buffer.concat([cipher.update(clean), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function openOriginal(blob: Buffer, key: Buffer, workspaceId: string, originalId: string): Buffer {
  if (key.length !== 32) throw new TrialOriginalCryptoError("bad_key");
  if (blob.length < MAGIC.length + IV_BYTES + TAG_BYTES || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new TrialOriginalCryptoError("bad_blob");
  }
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = blob.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = blob.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(workspaceId, originalId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new TrialOriginalCryptoError("auth_failed");
  }
}
