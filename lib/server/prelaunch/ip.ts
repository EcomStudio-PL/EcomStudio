import "server-only";
import { createHash } from "crypto";
import { serverSecret } from "@/lib/server/server-token";

/**
 * THE VISITOR'S ADDRESS, AS THE DATABASE MAY KNOW IT — a keyed hash, never the
 * address itself.
 *
 * The durable throttles (20 submissions per hour per network) and the
 * "same network" referral check compare these hashes; nothing ever needs the
 * address back. The key is the server secret the proof-of-server token is
 * derived from (lib/server/server-token.ts), NOT the legacy 64-hex encryption
 * key `signupIpHash` uses: a deployment that only has GROVBASE_SERVER_KEY
 * would otherwise hash nothing and silently switch every IP rule off (S14).
 * The label keeps this hash from ever equalling any other use of the secret.
 *
 * No secret, or no usable address ("unknown" behind a proxy that dropped the
 * header) → null. The route then cannot call the database at all (it needs the
 * same secret for its token), so the in-memory limiter is the only brake left;
 * that is said once in the log, not on every request.
 */

let warned = false;

export function prelaunchIpHash(ip: string): string | null {
  const secret = serverSecret();
  const addr = ip.trim();
  if (!secret) {
    if (!warned) {
      warned = true;
      console.error("[prelaunch] ip", "no server secret: IP throttles rely on the in-memory limiter only");
    }
    return null;
  }
  if (!addr || addr === "unknown") return null;
  return createHash("sha256").update(`grovbase-prelaunch-ip:${secret}:${addr}`).digest("hex");
}
