import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dispatchToken } from "@/lib/server/server-token";
import { notify } from "@/lib/server/notify";
import { collectEventContext } from "@/lib/server/event-context";
import { REFERRAL_CODE_RE } from "@/lib/launch/fields";
import { getLaunchConsents } from "@/lib/server/prelaunch/public";
import { rpcSignup } from "@/lib/server/prelaunch/rpc";
import { failure, guardRequest, reply, trapped } from "@/lib/server/prelaunch/http";
import { prelaunchIpHash } from "@/lib/server/prelaunch/ip";
import { attributionFrom, waitlistSignupNotice } from "@/lib/server/prelaunch/attribution";
import { referralLink, sendOptinMail } from "@/lib/server/prelaunch/mail";
import {
  cleanEmail, cleanFirstName, cleanLocale, decoyAnswerHandle, decoyReferralCode, newAnswerHandle, newDoiToken,
} from "@/lib/server/prelaunch/handles";

// crypto, the mailer and the template renderer are Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ZAPIS NA LISTĘ PRZEDPREMIEROWĄ — POST {email, first_name?, locale, form,
 * consent_terms, consent_marketing, consent_versions, ref_code?, company?}.
 *
 * ONE ANSWER FOR EVERYBODY. A new address, one already on the list, one that
 * already confirmed, one the throttles stopped and one on the suppression list
 * all get the same 200 with the same shape:
 *
 *   { ok: true, state: "check_inbox", referral: { code, url }, answer }
 *
 * and everything that differs between them happens AFTER the response, in
 * `after()` — the double opt-in mail only when the database issued a token,
 * the operator ping only for a genuinely new, mailed signup. The response time
 * therefore says nothing either. The referral code and the answer handle are
 * real only when THIS submission created the signup (S7); otherwise they are
 * random decoys of the same shape, so typing a stranger's address reveals
 * neither their code nor a handle that could rewrite their answers. The real
 * code is always on the confirmation page, behind the mailbox.
 *
 * THE CONSENTS ARE THE SERVER'S WORDS. The two sentences are resolved from the
 * published page (getLaunchConsents — the same resolver the page renders the
 * checkboxes with) and their versions compared with what the page showed. If
 * the admin changed a sentence while the visitor had the form open, the
 * visitor ticked words that are no longer the ones we would record: 409
 * `consent_changed`, and the page reloads them. A client can never write a
 * consent text of its own.
 *
 * Only an invalid address and missing consents are told apart (400): both are
 * about what the visitor typed, never about who else is on the list.
 */

/** Signup bodies are small: an address, a name, two booleans, two versions. */
const MAX_BYTES = 4096;

export async function POST(request: Request) {
  const guarded = await guardRequest(request, { route: "signup", limit: 10, windowMs: 10 * 60_000, maxBytes: MAX_BYTES });
  if (guarded instanceof Response) return guarded;
  const { ip, body } = guarded;

  // The bot learns nothing: the same answer a person gets, decoys included.
  if (trapped(body)) return checkInbox(decoyReferralCode(), decoyAnswerHandle());

  const email = cleanEmail(body.email);
  if (!email) return failure(400, "invalid_email");
  if (body.consent_terms !== true || body.consent_marketing !== true) return failure(400, "consent_required");
  const versions = body.consent_versions;
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) return failure(400, "bad_request");
  const { terms_privacy: termsVersion, marketing_email: marketingVersion } = versions as Record<string, unknown>;
  if (typeof termsVersion !== "string" || typeof marketingVersion !== "string"
    || termsVersion.length > 64 || marketingVersion.length > 64) {
    return failure(400, "bad_request");
  }
  const locale = cleanLocale(body.locale);
  const form = body.form === "final" ? "final" : "hero";
  // Optional and strict: a value that is not a plain name is simply no name.
  const firstName = cleanFirstName(body.first_name);
  // A referral code that is not a code is ignored, never an error: the visitor
  // did nothing wrong by arriving through a mangled link.
  const wanted = typeof body.ref_code === "string" ? body.ref_code.trim().toUpperCase() : "";
  const refCode = REFERRAL_CODE_RE.test(wanted) ? wanted : null;

  const supabase = await createClient();
  const consents = await getLaunchConsents(locale, supabase);
  if (termsVersion !== consents.terms.version || marketingVersion !== consents.marketing.version) {
    return failure(409, "consent_changed");
  }

  // Without the proof-of-server token the database refuses every call; say so
  // honestly rather than pretending a mail is on its way.
  const token = dispatchToken();
  if (!token) return failure(500, "generic");

  // Request-scoped state, read now: after() runs when the request is gone.
  const context = await collectEventContext();
  const doi = newDoiToken();
  const answer = newAnswerHandle();
  const result = await rpcSignup(supabase, token, {
    email, firstName, locale, form,
    consents: [
      { key: "terms_privacy", version: consents.terms.version, text: consents.terms.text },
      { key: "marketing_email", version: consents.marketing.version, text: consents.marketing.text },
    ],
    docVersions: consents.docVersions,
    attribution: attributionFrom(context),
    refCode,
    ipHash: prelaunchIpHash(ip),
    optinHash: doi.hash,
    answerHash: answer.hash,
  });
  if (!result) return failure(500, "generic");
  if (!("created" in result)) return failure(400, result.status === "invalid" ? "invalid_email" : "consent_required");

  const created = result.created;
  const code = created && result.referralCode && REFERRAL_CODE_RE.test(result.referralCode)
    ? result.referralCode
    : decoyReferralCode();
  const handle = created ? answer.raw : decoyAnswerHandle();

  if (result.send && result.tokenId) {
    const mail = { tokenId: result.tokenId, to: result.email ?? email, locale: result.locale, rawToken: doi.raw };
    after(() => sendOptinMail(supabase, mail));
  }
  // The operator hears about a NEW signup the database actually mailed — not
  // a re-submit, not a throttled burst, not a suppressed address (S8). The
  // ping keeps /api/waitlist's payload, minus the raw IP.
  if (created && result.send) {
    const notice = waitlistSignupNotice(context, {
      firstName: firstName ?? "", lastName: "", email: result.email ?? email, source: form, locale,
    }, { withIp: false });
    after(() => notify(supabase, notice));
  }

  return checkInbox(code, handle);
}

function checkInbox(code: string, answer: string) {
  return reply({ ok: true, state: "check_inbox", referral: { code, url: referralLink(code) }, answer });
}
