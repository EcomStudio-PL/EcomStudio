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
import { readFileSync } from "node:fs";
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

console.log("\nF. EVERY CODE THE ACTION CAN EMIT HAS A SENTENCE");
{
  // THE TEST THAT WOULD HAVE CAUGHT IT. `rate_limited` was produced by the
  // server and missing from the form's table, so Supabase's "email rate limit
  // exceeded" reached the customer as "could not reach the server". A table
  // with a fallback hides exactly this, so the two sides are compared here
  // rather than trusted.
  const action = readFileSync("app/actions/auth.ts", "utf8");
  const mapper = readFileSync("lib/auth-error-map.ts", "utf8");
  const form = readFileSync("components/auth/register-form.tsx", "utf8");

  const emitted = new Set<string>();
  for (const src of [action, mapper]) {
    for (const m of src.matchAll(/form:\s*"([a-z_]+)"/g)) emitted.add(m[1]);
    for (const m of src.matchAll(/\{\s*form:\s*"([a-z_]+)"\s*\}/g)) emitted.add(m[1]);
  }
  // The mapper's union type is the other half of the contract.
  for (const m of mapper.matchAll(/form:\s*"([a-z_|"\s]+)"/g)) {
    for (const code of m[1].split(/"\s*\|\s*"/)) emitted.add(code.replace(/"/g, "").trim());
  }
  const mapped = new Set<string>();
  const table = form.slice(form.indexOf("FORM_ERROR_KEYS"), form.indexOf("};", form.indexOf("FORM_ERROR_KEYS")));
  for (const m of table.matchAll(/^\s*([a-z_]+):/gm)) mapped.add(m[1]);

  check(`the action emits at least six distinct codes (found ${emitted.size})`, emitted.size >= 6,
    [...emitted].join(", "));
  for (const code of [...emitted].sort()) {
    check(`"${code}" has its own message in the form`, mapped.has(code),
      `not in FORM_ERROR_KEYS — would silently read as "server unreachable"`);
  }
  check("rate_limited specifically is mapped", mapped.has("rate_limited"));
  check("rate_limited does not point at the network sentence",
    !/rate_limited:\s*"auth\.err_network"/.test(table));
}

console.log("\nG. THE HOOK ANSWERS INSIDE SUPABASE'S 5-SECOND BUDGET");
{
  // Supabase allows an auth hook 5s for the WHOLE invocation. Sending mail
  // inside that window is what rolled back every signup on production, so the
  // shape of this route is now a rule, not a preference.
  const route = readFileSync("app/api/hooks/supabase/send-email/route.ts", "utf8");
  const afterAt = route.indexOf("after(async");
  const respondAt = route.lastIndexOf("return NextResponse.json({}, { status: 200 })");

  check("the route defers work with after()", afterAt > 0);
  check("the 200 is returned after the deferral is registered", respondAt > afterAt);
  const deferred = route.slice(afterAt, respondAt);
  check("sendAuthMail is inside the deferred block", deferred.includes("sendAuthMail("));
  check("the template render is inside the deferred block", deferred.includes("renderAuthMail("));
  check("the dedupe claim is inside the deferred block", deferred.includes("auth_email_claim"));

  const critical = route.slice(0, afterAt);
  check("nothing before the response sends mail", !critical.includes("sendAuthMail("));
  check("the signature is still verified BEFORE anything else",
    critical.indexOf("verifyWebhook(") < critical.indexOf("parsePayload("));
  check("an unverified request is still refused", critical.includes("status: 401"));
  check("the acknowledgement is timed, so a regression is visible",
    route.includes("ackMs"));
}

console.log(failures === 0 ? "\nAll signup tests passed.\n" : `\n${failures} signup test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
