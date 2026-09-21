import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * STRIPE WEBHOOK SIGNATURES — and why this is not lib/server/webhook-signature.ts.
 *
 * The repo already verifies webhooks, for the Supabase auth hook. That one is
 * STANDARD WEBHOOKS: it signs `${id}.${timestamp}.${body}`, its secret is
 * base64 after a `whsec_` prefix, and it compares base64. Stripe's scheme
 * looks similar and is not the same thing:
 *
 *   header         Stripe-Signature: t=1492774577,v1=5257a8…,v0=6ffbb5…
 *   signed payload `${t}.${rawBody}`                     ← no id
 *   key            the `whsec_…` string ITSELF, as ASCII ← not decoded
 *   digest         HMAC-SHA256, compared as HEX          ← not base64
 *
 * Reusing the existing verifier would reject every genuine Stripe delivery —
 * and, worse, a verifier that is wrong in the other direction would accept a
 * forgery. So Stripe gets its own, and the difference is written down here so
 * nobody "consolidates" them later.
 *
 * THREE THINGS THIS REFUSES, each of them a real attack:
 *
 *   v0 IS IGNORED. The header can carry several schemes. `v0` is Stripe's
 *   test-mode-only scheme; accepting it would let anyone who knows a test
 *   secret sign a live-looking event. Only `v1` is ever compared.
 *
 *   OLD TIMESTAMPS ARE REFUSED. Without a tolerance, a delivery captured once
 *   stays valid forever and can be replayed at will. Stripe leaves the window
 *   to the integrator; five minutes is their documented default and what this
 *   uses. (Replay of a genuine event is ALSO caught downstream by
 *   payment_events.stripe_event_id — this is the first of two locks.)
 *
 *   COMPARISON IS CONSTANT-TIME. A byte-by-byte early exit leaks, one
 *   character at a time, what the correct signature is.
 *
 * MULTIPLE v1 VALUES ARE NORMAL. During a secret rotation Stripe signs with
 * both the old and the new secret, so any matching v1 is a pass.
 */

const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  | "no_signature" | "malformed_signature" | "no_secret"
  | "timestamp_out_of_tolerance" | "no_valid_signature";

export type SignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: SignatureFailure };

type ParsedHeader = { timestamp: number; v1: string[] };

/**
 * `t=...,v1=...,v1=...,v0=...` — order is not guaranteed and unknown schemes
 * must be skipped rather than tripped over, so this reads what it recognises
 * and ignores the rest.
 */
export function parseStripeSignatureHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const scheme = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (scheme === "t") {
      // A non-numeric or absurd timestamp is a malformed header, not a
      // timestamp of 0 — which would otherwise fail the tolerance check and
      // report the wrong reason.
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
      timestamp = n;
    } else if (scheme === "v1" && /^[0-9a-f]+$/i.test(value)) {
      v1.push(value.toLowerCase());
    }
    // v0 and anything else: deliberately dropped. See the header comment.
  }
  if (timestamp === null) return null;
  return { timestamp, v1 };
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, hex, keyed by the whsec string. */
export function stripeSignaturePayload(timestamp: number, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

function hexEqual(a: string, b: string): boolean {
  // timingSafeEqual throws on a length mismatch, and a length mismatch is
  // already a definite failure, so it is answered before the comparison.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * THE VERIFIER. `rawBody` must be the exact bytes Stripe sent — a parsed and
 * re-serialised object has different whitespace and key order and will never
 * match. The route reads `await request.text()` and passes that string here
 * BEFORE anything parses it.
 *
 * `nowSeconds` is injectable so the tolerance rule can be tested against a
 * fixed clock rather than slept through.
 */
export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | null;
  secret: string | null;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): SignatureResult {
  const { rawBody, header, secret } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!secret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "no_signature" };

  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed_signature" };
  // A header with a timestamp but no v1 is not malformed in shape — it simply
  // carries nothing this verifier will ever accept.
  if (parsed.v1.length === 0) return { ok: false, reason: "malformed_signature" };

  // Both directions. A future-dated delivery is as suspicious as an old one,
  // and clock skew large enough to matter is a problem to see, not to absorb.
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = createHmac("sha256", secret)
    .update(stripeSignaturePayload(parsed.timestamp, rawBody), "utf8")
    .digest("hex");

  // Every candidate is compared even after one matches: bailing out early
  // would make the work depend on which signature was right.
  let matched = false;
  for (const candidate of parsed.v1) {
    if (hexEqual(candidate, expected)) matched = true;
  }
  return matched ? { ok: true, timestamp: parsed.timestamp } : { ok: false, reason: "no_valid_signature" };
}
