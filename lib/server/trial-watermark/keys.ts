import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto";
import { serverSecret } from "@/lib/server/server-token";

/**
 * THE KEY OF A KEY.
 *
 * Each clean original is sealed with its own random key (crypto.ts). That key
 * is stored in the database WRAPPED under a key-encryption key derived from
 * the server's own secret (the same GROVBASE_SERVER_KEY that proves the
 * server's identity, under a different label) — so the database holds
 * nothing it could open by itself, and a dump of it opens no original.
 *
 *   KEK = HKDF-SHA256(serverSecret, salt "grovbase", info "grovbase-trial-originals-kek-v1")
 *   wrapped = base64( iv(12) | tag(16) | AES-256-GCM(KEK, dek) ),  AAD = "GBWK1|" + originalId
 *
 * The fingerprint (first 16 hex of sha256(KEK)) is stored next to each
 * wrapped key, so a rotated server secret is recognised as "this original can
 * no longer be opened" instead of as tampering. No secret: nothing can be
 * wrapped or unwrapped, and the caller refuses — a trial image is then not
 * delivered at all rather than delivered clean.
 */

export class TrialKeyError extends Error {
  constructor(public readonly code: "no_server_key" | "kek_mismatch" | "bad_wrapped_key") {
    super(code);
  }
}

function kek(): Buffer {
  const secret = serverSecret();
  if (!secret) throw new TrialKeyError("no_server_key");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("grovbase", "utf8"),
    Buffer.from("grovbase-trial-originals-kek-v1", "utf8"), 32));
}

/** The KEK's fingerprint, stored with every wrapped key. */
export function kekFingerprint(): string {
  return createHash("sha256").update(kek()).digest("hex").slice(0, 16);
}

export function wrapOriginalKey(dek: Buffer, originalId: string): { wrapped: string; fingerprint: string } {
  const k = kek();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(`GBWK1|${originalId}`, "utf8"));
  const body = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    wrapped: Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64"),
    fingerprint: createHash("sha256").update(k).digest("hex").slice(0, 16),
  };
}

export function unwrapOriginalKey(wrapped: string, fingerprint: string, originalId: string): Buffer {
  const k = kek();
  if (createHash("sha256").update(k).digest("hex").slice(0, 16) !== fingerprint) throw new TrialKeyError("kek_mismatch");
  const raw = Buffer.from(wrapped, "base64");
  if (raw.length !== 12 + 16 + 32) throw new TrialKeyError("bad_wrapped_key");
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`GBWK1|${originalId}`, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    throw new TrialKeyError("bad_wrapped_key");
  }
}
