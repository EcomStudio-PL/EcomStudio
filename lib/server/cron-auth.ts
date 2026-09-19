import "server-only";
import { createHash, timingSafeEqual } from "crypto";

/**
 * THE SCHEDULER'S CREDENTIAL, IN ONE PLACE.
 *
 * A platform cron arrives with `Authorization: Bearer <CRON_SECRET>` and no
 * session. Two routes check that — the mailbox poll and the newsletter worker
 * — and until now each had its OWN parser and its OWN comparison. Two copies
 * of a security rule is how the two stop agreeing, and these two already had:
 *
 *   · app/actions/mail.ts hashed both sides and compared the digests, so the
 *     comparison was constant-time whatever the lengths were;
 *   · app/api/newsletter/worker/route.ts compared the raw bytes and returned
 *     early when the lengths differed — which the other file's own comment
 *     names as the thing to avoid, because refusing early on a length mismatch
 *     is itself a measurement.
 *
 * This module is the stronger of the two, used by both. Nothing about who is
 * allowed to do what changes; what changes is that there is one answer.
 */

/** The token out of an Authorization header, or "" when there is not one. */
export function bearerToken(value: string | null): string {
  const header = (value ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]!.trim() : "";
}

/**
 * Constant-time comparison of two secrets.
 *
 * Over the DIGESTS, not the strings: `timingSafeEqual` throws unless both
 * buffers are the same length, so comparing raw values would force a length
 * check first — and answering "no" faster for a wrong-length guess tells an
 * attacker the length. Hashing first makes both sides 32 bytes always.
 *
 * An empty expected secret never matches: a deployment that has not been given
 * a credential must refuse everyone rather than accept an empty header.
 */
export function secretMatches(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/**
 * What the Authorization header alone says about a caller.
 *
 *   "cron"           the header carries the configured secret — this IS the
 *                    scheduler, and it needs no session
 *   "secret_missing" no secret is configured in this deployment, so the
 *                    scheduler cannot authenticate at all and the only
 *                    possible caller is a signed-in admin
 *   "no_match"       a secret IS configured and the header did not carry it
 *
 * The SESSION half of the question stays with each caller, because the two
 * differ in what a signed-in user is allowed to do. This decides only the part
 * that is identical everywhere.
 */
export type CronTokenVerdict = "cron" | "secret_missing" | "no_match";

export function cronTokenVerdict(
  authorization: string | null,
  secret: string | null | undefined,
): CronTokenVerdict {
  const expected = (secret ?? "").trim();
  if (!expected) return "secret_missing";
  return secretMatches(bearerToken(authorization), expected) ? "cron" : "no_match";
}
