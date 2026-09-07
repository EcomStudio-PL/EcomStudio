/**
 * SIGNUP — what the customer is told, and what the copy promises.
 *
 * The outage this file exists because of was invisible in every test that
 * existed: the build passed, the form rendered, the widget appeared, and
 * production answered every registration with "could not reach the server".
 * Two things were untested and both were wrong — the error translation, and
 * the number of credits the copy promised.
 *
 * Both are pure and both are now pinned here. The database half (the
 * token-gated read that made the mailer able to read its own mailbox) is
 * verified against the real database instead, because a mock of a SECURITY
 * DEFINER function proves nothing about a SECURITY DEFINER function.
 */
import { mapSignUpError } from "@/lib/auth-error-map";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 200)}`}`);
  if (!cond) failures += 1;
}

const form = (e: Parameters<typeof mapSignUpError>[0]) => {
  const r = mapSignUpError(e);
  return "form" in r ? r.form : `field:${r.field}`;
};

console.log("\nA. THE FAILURE THE CUSTOMER ACTUALLY HIT");
{
  // Every shape a broken Send Email Hook reaches the action as. Not one of
  // them may read as a network problem — the request plainly got to Supabase.
  const hookShapes: Parameters<typeof mapSignUpError>[0][] = [
    { message: "Error sending confirmation email", code: "unexpected_failure", status: 500 },
    { message: "failed to send email", status: 500 },
    { message: "error invoking hook", code: "unexpected_failure", status: 500 },
    { message: "Internal Server Error", status: 500 },
    { message: "", code: "unexpected_failure" },
    { message: "500: Internal Server Error", status: 500 },
  ];
  for (const [i, shape] of hookShapes.entries()) {
    check(`hook failure #${i + 1} reads as activation_send`, form(shape) === "activation_send", form(shape));
  }
  check("none of them reads as network",
    hookShapes.every((s) => form(s) !== "network"));
}

console.log("\nB. THE OTHER CASES STILL LAND WHERE THEY DID");
{
  check("weak password → the password field",
    form({ message: "Password should be at least 8 characters" }) === "field:password");
  check("undeliverable address → the email field",
    form({ message: "Email address is invalid", code: "email_address_invalid", status: 400 }) === "field:email");
  check("email quota → rate_limited, not activation_send",
    form({ message: "email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 }) === "rate_limited");
  check("a 429 without a code is still rate_limited",
    form({ message: "too many requests", status: 429 }) === "rate_limited");
  // network is now a residual case, not a dustbin.
  check("an unreachable server is still network",
    form({ message: "fetch failed" }) === "network");
  check("an unrecognised 400 is still network",
    form({ message: "something else entirely", status: 400 }) === "network");
}

console.log("\nC. NOTHING LEAKS AND NOTHING ENUMERATES");
{
  // The mapper returns codes, never provider text: whatever GoTrue wrote
  // cannot reach the customer through this path.
  const codes = new Set<string>();
  for (const s of [
    { message: "duplicate key value violates unique constraint \"users_email_key\"" },
    { message: "User already registered", status: 422 },
    { message: "smtp: 535 5.7.8 Error: authentication failed: contact@grovbase.com" },
  ]) codes.add(form(s));
  check("no provider text ever becomes the answer",
    [...codes].every((c) => ["network", "activation_send", "rate_limited", "field:email", "field:password"].includes(c)),
    [...codes].join(", "));
  check("an already-registered address is not given its own answer",
    form({ message: "User already registered", status: 422 }) === "network");
  // A leaked SMTP host or password would have to come through the message,
  // and the message never survives the mapper.
  check("an SMTP error does not surface the mailbox",
    form({ message: "smtp: 535 auth failed for contact@grovbase.com" }) === "network");
}

console.log("\nD. EVERY ANSWER HAS SOMETHING TO SAY IN ALL THREE LANGUAGES");
{
  const dicts: [string, Record<string, Record<string, string>>][] = [
    ["pl", pl as never], ["en", en as never], ["de", de as never],
  ];
  // The keys register-form maps form codes onto, plus the two the captcha
  // path can now produce.
  const keys = [
    "err_network", "errActivationSend", "errCaptcha", "errCaptchaFailed",
    "errCaptchaUnavailable", "errIpLimit", "registrationDisabled",
    "registerSub", "registerSubNoCredits", "benefit3", "benefit3NoCredits",
  ];
  for (const [loc, d] of dicts) {
    for (const k of keys) {
      const v = d.auth?.[k];
      check(`${loc}.auth.${k} exists and is not empty`, typeof v === "string" && v.trim().length > 0);
    }
  }
}

console.log("\nE. THE CREDITS NUMBER IS CONFIGURED, NEVER WRITTEN IN THE COPY");
{
  const dicts: [string, Record<string, Record<string, string>>][] = [
    ["pl", pl as never], ["en", en as never], ["de", de as never],
  ];
  for (const [loc, d] of dicts) {
    const withNumber = [d.auth.registerSub, d.auth.benefit3];
    const without = [d.auth.registerSubNoCredits, d.auth.benefit3NoCredits];
    for (const s of withNumber) {
      check(`${loc}: the credits line interpolates {n}`, s.includes("{n}"), s);
      check(`${loc}: the credits line hardcodes no figure`, !/\b(25|150)\b/.test(s), s);
    }
    for (const s of without) {
      check(`${loc}: the no-credits line promises no credits`, !/\d/.test(s), s);
    }
  }
  // The whole point of the fix: the two places that mention credits must
  // read the same variable, so they cannot disagree the way 25 and 150 did.
  check("both credit lines take the same placeholder",
    [pl, en, de].every((d) => {
      const a = d as unknown as { auth: Record<string, string> };
      return a.auth.registerSub.includes("{n}") && a.auth.benefit3.includes("{n}");
    }));
}

console.log(failures === 0 ? "\nAll signup tests passed.\n" : `\n${failures} signup test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
