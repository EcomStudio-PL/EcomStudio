import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchToken } from "@/lib/server/server-token";
import { rateLimit } from "@/lib/server/rate-limit";
import { rpcResend } from "@/lib/server/prelaunch/rpc";
import { failure, guardRequest, reply, trapped } from "@/lib/server/prelaunch/http";
import { prelaunchIpHash } from "@/lib/server/prelaunch/ip";
import { sendOptinMail } from "@/lib/server/prelaunch/mail";
import { DOI_TOKEN_RE, cleanEmail, newDoiToken, sha256Hex } from "@/lib/server/prelaunch/handles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "WYŚLIJ PONOWNIE" — POST {email} from the success card, or {token} from an
 * expired link (the old token proves which signup it was; its hash is all the
 * database needs to find it).
 *
 * ALWAYS `200 {ok:true}` for a well-formed request — sent, throttled, already
 * confirmed, suppressed, unknown: the button cannot be used to ask whether an
 * address is on the list. The database decides (prelaunch_resend: only a
 * pending signup, the 60-second and 5-per-day limits, the per-network and
 * global caps) and the mail goes out in `after()`.
 *
 * The address comes back from the database ONLY so the server can write to
 * it; it never reaches the response.
 */
const MAX_BYTES = 1024;

export async function POST(request: Request) {
  const guarded = await guardRequest(request, { route: "resend", limit: 6, windowMs: 10 * 60_000, maxBytes: MAX_BYTES });
  if (guarded instanceof Response) return guarded;
  const { ip, body } = guarded;
  if (trapped(body)) return reply({ ok: true });

  // Exactly one of the two.
  const hasEmail = body.email !== undefined;
  const hasToken = body.token !== undefined;
  if (hasEmail === hasToken) return failure(400, "bad_request");
  let email: string | null = null;
  let oldHash: string | null = null;
  if (hasEmail) {
    email = cleanEmail(body.email);
    if (!email) return failure(400, "invalid_email");
  } else {
    if (typeof body.token !== "string" || !DOI_TOKEN_RE.test(body.token)) return failure(400, "bad_request");
    oldHash = sha256Hex(body.token);
  }

  // A double click is not a second request: one per target per minute on this
  // instance, answered like any other (the database applies the same 60 s).
  // The key holds a hash, never the address.
  if (!rateLimit(`prelaunch:resend:${ip}:${sha256Hex(email ?? oldHash ?? "")}`, 1, 60_000)) {
    return reply({ ok: true });
  }

  const token = dispatchToken();
  if (!token) return failure(500, "generic");
  const supabase = await createClient();
  const doi = newDoiToken();
  const result = await rpcResend(supabase, token, { email, oldHash, ipHash: prelaunchIpHash(ip), optinHash: doi.hash });
  if (!result) return failure(500, "generic");

  if (result.send && result.tokenId && result.email) {
    const mail = { tokenId: result.tokenId, to: result.email, locale: result.locale, rawToken: doi.raw };
    after(() => sendOptinMail(supabase, mail));
  }
  return reply({ ok: true });
}
