import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchToken } from "@/lib/server/server-token";
import { REFERRAL_CODE_RE } from "@/lib/launch/fields";
import { getPrelaunchPublicConfig } from "@/lib/server/prelaunch/public";
import { rpcConfirm } from "@/lib/server/prelaunch/rpc";
import { failure, guardRequest, reply } from "@/lib/server/prelaunch/http";
import { referralLink, sendWelcomeMail } from "@/lib/server/prelaunch/mail";
import { DOI_TOKEN_RE, cleanFirstName, sha256Hex } from "@/lib/server/prelaunch/handles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POTWIERDZENIE ZAPISU — POST {token}, sent by the confirmation page when a
 * PERSON presses "Potwierdź zapis" (never automatically on load: corporate
 * link scanners run JavaScript, S10). The token arrives from the URL fragment
 * and is hashed before anything else looks at it.
 *
 *   200 { ok, status: "confirmed" | "already" | "expired" | "invalid",
 *         first_name?, referral?: {code, url}, referral_credits? }
 *
 * NEVER AN E-MAIL. The database hands the address back for one reason — the
 * welcome mail in `after()` — and it stops there. The first name is shown only
 * because the mailbox has just been proven, and only if it is a plain name.
 * `referral_credits` is the APPROVED Y or null, so the share card never states
 * a number nobody signed off.
 *
 * A string that is not even shaped like a token is "invalid" (a link a mail
 * client broke in half), not an error: the page can say so and offer a new one.
 */
const MAX_BYTES = 1024;

export async function POST(request: Request) {
  const guarded = await guardRequest(request, { route: "confirm", limit: 20, windowMs: 10 * 60_000, maxBytes: MAX_BYTES });
  if (guarded instanceof Response) return guarded;
  const raw = guarded.body.token;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) return failure(400, "bad_request");
  if (!DOI_TOKEN_RE.test(raw)) return reply({ ok: true, status: "invalid" });

  const token = dispatchToken();
  if (!token) return failure(500, "generic");
  const supabase = await createClient();
  const result = await rpcConfirm(supabase, token, sha256Hex(raw));
  if (!result) return failure(500, "generic");
  if (result.status === "expired" || result.status === "invalid") return reply({ ok: true, status: result.status });

  const firstName = cleanFirstName(result.firstName);
  const code = result.referralCode && REFERRAL_CODE_RE.test(result.referralCode) ? result.referralCode : null;
  const config = await getPrelaunchPublicConfig();

  // Once, from the call that actually confirmed — a second click, a scanner
  // racing the person, or a reload answer `already` and send nothing.
  if (result.status === "confirmed" && result.welcome && result.email) {
    const mail = { to: result.email, firstName, locale: result.locale };
    after(() => sendWelcomeMail(supabase, mail));
  }

  return reply({
    ok: true,
    status: result.status,
    ...(firstName ? { first_name: firstName } : {}),
    ...(code ? { referral: { code, url: referralLink(code) } } : {}),
    referral_credits: config.referralCredits,
  });
}
