import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * STANDARD WEBHOOKS signature verification.
 *
 * Supabase signs Auth hook deliveries with the Standard Webhooks scheme
 * (standardwebhooks.com), the same one Svix uses. Three headers travel with
 * the request:
 *
 *   webhook-id         an opaque delivery id, stable across retries
 *   webhook-timestamp  unix seconds, to bound replay
 *   webhook-signature  one or more space-separated "v1,<base64>" values
 *
 * and the signed content is exactly `${id}.${timestamp}.${rawBody}`. RAW body:
 * a re-serialised object is a DIFFERENT string, so parsing before verifying
 * would break every signature — and, worse, would mean parsing something we
 * have not yet established came from Supabase.
 *
 * Implemented here rather than pulled from npm because it is thirty lines of
 * HMAC and this codebase would otherwise take a dependency it cannot audit on
 * the one path that decides whether an unauthenticated POST is trusted.
 */

/** How far a delivery's timestamp may be from ours. The spec's own default. */
const TOLERANCE_SECONDS = 5 * 60;

export type VerifyFailure =
  | "no_secret"       // the endpoint is not configured yet
  | "missing_headers"
  | "bad_timestamp"   // unparseable, or outside the tolerance window
  | "bad_signature";

export type VerifyResult =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: VerifyFailure };

/**
 * A configured secret looks like `v1,whsec_<base64>`; the key material is the
 * base64 part, decoded. Several secrets may be configured at once, separated
 * by `|`, which is how a rotation happens without downtime — every one is
 * tried and any match passes.
 */
export function parseSecrets(configured: string): Buffer[] {
  return configured
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^v1,\s*/, "").replace(/^whsec_/, ""))
    .map((s) => Buffer.from(s, "base64"))
    .filter((b) => b.length > 0);
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — compare lengths first and always run the constant-time compare.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function verifyWebhook(
  rawBody: string,
  headers: { id?: string | null; timestamp?: string | null; signature?: string | null },
  configuredSecret: string,
  now: Date = new Date(),
): VerifyResult {
  const secrets = parseSecrets(configuredSecret);
  if (secrets.length === 0) return { ok: false, reason: "no_secret" };

  const id = (headers.id ?? "").trim();
  const timestamp = (headers.timestamp ?? "").trim();
  const signature = (headers.signature ?? "").trim();
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "bad_timestamp" };
  const drift = Math.abs(Math.floor(now.getTime() / 1000) - sentAt);
  if (drift > TOLERANCE_SECONDS) return { ok: false, reason: "bad_timestamp" };

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  // The header may carry several signatures (one per configured secret on the
  // sender's side); any one matching any of our secrets is a pass.
  const presented = signature.split(" ").map((s) => s.trim()).filter(Boolean);
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(signedContent).digest("base64");
    for (const candidate of presented) {
      // "v1,<sig>" — the version prefix is part of the header, not of the MAC.
      const value = candidate.startsWith("v1,") ? candidate.slice(3) : candidate;
      if (equal(value, expected)) return { ok: true, id, timestamp: sentAt };
    }
  }
  return { ok: false, reason: "bad_signature" };
}

/** Sign a payload the way Supabase would — for the tests, and for nothing
 *  else. Exported so the suite proves the verifier against real signatures
 *  rather than against its own assumptions. */
export function signWebhook(
  rawBody: string,
  id: string,
  timestampSeconds: number,
  secret: string,
): string {
  const key = parseSecrets(secret)[0]!;
  const mac = createHmac("sha256", key)
    .update(`${id}.${timestampSeconds}.${rawBody}`)
    .digest("base64");
  return `v1,${mac}`;
}
