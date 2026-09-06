/**
 * SEND EMAIL HOOK — the logic tests.
 *
 * The two things that decide whether this endpoint is safe and correct:
 * whether a signature is verified properly, and whether a payload turns into
 * the right messages with the right token attached to each. Both are pure
 * functions here, exercised against signatures this suite generates itself
 * rather than against the verifier's own assumptions.
 *
 * What is NOT here: the SMTP send and the database dedupe. Those live in a
 * mail server and in Postgres, and a mock of either proves nothing about it.
 */
import { parseSecrets, signWebhook, verifyWebhook } from "@/lib/server/webhook-signature";
import {
  confirmUrl, isAuthAction, parsePayload, planMails, renderGoTemplate,
  type SendEmailPayload,
} from "@/lib/server/auth-mail";
import { TEMPLATE_CATALOG, defaultTemplate } from "@/lib/server/message-templates";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 220)}`}`);
  if (!cond) failures += 1;
}

const SECRET = "v1,whsec_dGVzdC1zZWNyZXQtdGhpcnR5LXR3by1ieXRlcy1sb25nISE=";
const NOW = new Date("2026-09-06T12:00:00Z");
const TS = Math.floor(NOW.getTime() / 1000);
const BODY = JSON.stringify({ user: { email: "a@b.pl" }, email_data: { token_hash: "x" } });

console.log("\nA. SIGNATURE VERIFICATION");
{
  const id = "msg_2abc";
  const sig = signWebhook(BODY, id, TS, SECRET);

  check("a correctly signed delivery passes",
    verifyWebhook(BODY, { id, timestamp: String(TS), signature: sig }, SECRET, NOW).ok);

  // Every one of these is a way in if it is not checked.
  check("a tampered BODY is refused", !verifyWebhook(
    BODY.replace("a@b.pl", "attacker@evil.pl"),
    { id, timestamp: String(TS), signature: sig }, SECRET, NOW).ok);
  check("a different delivery id is refused", !verifyWebhook(
    BODY, { id: "msg_other", timestamp: String(TS), signature: sig }, SECRET, NOW).ok);
  check("a different timestamp is refused", !verifyWebhook(
    BODY, { id, timestamp: String(TS - 1), signature: sig }, SECRET, NOW).ok);
  check("a different secret is refused", !verifyWebhook(
    BODY, { id, timestamp: String(TS), signature: sig },
    "v1,whsec_b3RoZXItc2VjcmV0LXRoaXJ0eS10d28tYnl0ZXMtbG9uZyE=", NOW).ok);
  check("no signature header is refused", !verifyWebhook(
    BODY, { id, timestamp: String(TS), signature: null }, SECRET, NOW).ok);
  check("no configured secret refuses rather than passing",
    verifyWebhook(BODY, { id, timestamp: String(TS), signature: sig }, "", NOW).ok === false);

  // Replay: the same bytes, hours later.
  const old = verifyWebhook(BODY, { id, timestamp: String(TS), signature: sig }, SECRET,
    new Date(NOW.getTime() + 6 * 60 * 1000));
  check("a delivery older than the tolerance is refused (replay)", !old.ok);
  check("...and says WHY it was refused", !old.ok && old.reason === "bad_timestamp",
    !old.ok ? old.reason : "");
  const future = verifyWebhook(BODY, { id, timestamp: String(TS), signature: sig }, SECRET,
    new Date(NOW.getTime() - 6 * 60 * 1000));
  check("a delivery from the future is refused too", !future.ok);

  // Rotation: two secrets configured, either may sign.
  const OLD = "v1,whsec_b2xkLXNlY3JldC10aGlydHktdHdvLWJ5dGVzLWxvbmchIQ==";
  const both = `${SECRET}|${OLD}`;
  check("two secrets parse for rotation", parseSecrets(both).length === 2);
  check("during rotation the NEW secret is accepted",
    verifyWebhook(BODY, { id, timestamp: String(TS), signature: sig }, both, NOW).ok);
  check("during rotation the OLD secret is accepted",
    verifyWebhook(BODY, { id, timestamp: String(TS), signature: signWebhook(BODY, id, TS, OLD) },
      both, NOW).ok);

  // Several signatures in one header, as the spec allows.
  check("a header carrying several signatures passes on any match",
    verifyWebhook(BODY, {
      id, timestamp: String(TS),
      signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${sig}`,
    }, SECRET, NOW).ok);

  check("the whsec_ prefix is not part of the key",
    parseSecrets(SECRET)[0]!.toString("base64") === SECRET.replace("v1,whsec_", ""));
}

console.log("\nB. PAYLOAD VALIDATION");
{
  const good = {
    user: { id: "u1", email: "jan@example.com", user_metadata: { first_name: "Jan" } },
    email_data: {
      token: "305805", token_hash: "abc", redirect_to: "https://grovbase.com/",
      email_action_type: "signup", site_url: "https://grovbase.com",
      token_new: "", token_hash_new: "",
    },
  };
  check("a documented payload parses", parsePayload(good) !== null);
  check("null is refused", parsePayload(null) === null);
  check("a string is refused", parsePayload("{}") === null);
  check("no user is refused", parsePayload({ email_data: good.email_data }) === null);
  check("no e-mail is refused",
    parsePayload({ ...good, user: { ...good.user, email: "" } }) === null);
  check("no action type is refused",
    parsePayload({ ...good, email_data: { ...good.email_data, email_action_type: "" } }) === null);
  check("no token hash at all is refused — there would be no link to send",
    parsePayload({ ...good, email_data: { ...good.email_data, token_hash: "", token_hash_new: "" } }) === null);
  check("an unknown action type is not treated as an auth action",
    !isAuthAction("password_reset_v2"));
  check("every action the catalogue names is recognised",
    ["signup", "recovery", "magiclink", "invite", "email_change", "reauthentication"].every(isAuthAction));
}

console.log("\nC. ONE PAYLOAD → THE RIGHT MESSAGES");
function payload(over: Partial<SendEmailPayload["email_data"]>, user: Partial<SendEmailPayload["user"]> = {}): SendEmailPayload {
  return parsePayload({
    user: { id: "u1", email: "jan@example.com", ...user },
    email_data: {
      token: "111111", token_hash: "hash-a", redirect_to: "", email_action_type: "signup",
      site_url: "https://grovbase.com", token_new: "", token_hash_new: "", ...over,
    },
  })!;
}
{
  const signup = planMails(payload({ email_action_type: "signup" }));
  check("signup → one mail to the account address",
    signup.length === 1 && signup[0]!.to === "jan@example.com");
  check("signup uses the confirm-signup template",
    signup[0]!.templateKey === "auth.confirm_signup");
  check("signup's link verifies as type=email (what /auth/confirm accepts)",
    signup[0]!.confirmType === "email");

  const recovery = planMails(payload({ email_action_type: "recovery", token_hash: "hash-r" }));
  check("recovery → the reset template", recovery[0]!.templateKey === "auth.reset_password");
  check("recovery's link verifies as type=recovery", recovery[0]!.confirmType === "recovery");
  check("recovery carries its own hash", recovery[0]!.tokenHash === "hash-r");

  check("magiclink → the magic-link template",
    planMails(payload({ email_action_type: "magiclink" }))[0]!.templateKey === "auth.magic_link");
  check("invite → the invite template",
    planMails(payload({ email_action_type: "invite" }))[0]!.templateKey === "auth.invite");

  // §19 — the one Supabase explicitly documents as counter-intuitive.
  const secure = planMails(payload(
    { email_action_type: "email_change", token: "AAA", token_hash: "hash-for-NEW",
      token_new: "BBB", token_hash_new: "hash-for-CURRENT" },
    { new_email: "nowy@example.com" },
  ));
  check("secure email change sends TWO messages", secure.length === 2, secure.length);
  check("...one to the CURRENT address", secure[0]!.to === "jan@example.com");
  check("...carrying token_hash_new, despite the name",
    secure[0]!.tokenHash === "hash-for-CURRENT", secure[0]!.tokenHash);
  check("...and its matching token", secure[0]!.token === "AAA");
  check("...one to the NEW address", secure[1]!.to === "nowy@example.com");
  check("...carrying plain token_hash, despite the name",
    secure[1]!.tokenHash === "hash-for-NEW", secure[1]!.tokenHash);
  check("...and its matching token_new", secure[1]!.token === "BBB");

  const simple = planMails(payload(
    { email_action_type: "email_change", token: "AAA", token_hash: "hash-only" },
    { new_email: "nowy@example.com" },
  ));
  check("with secure change OFF only one message goes out", simple.length === 1);
  check("...to the NEW address", simple[0]!.to === "nowy@example.com");
  check("...with the one hash there is", simple[0]!.tokenHash === "hash-only");

  check("an action we do not know produces nothing to send",
    planMails(payload({ email_action_type: "sms_otp" })).length === 0);
}

console.log("\nD. THE LINK IS GROVBASE'S");
{
  const url = confirmUrl("abc/def+ghi=", "email");
  check("the confirmation link is on grovbase.com", url.startsWith("https://grovbase.com/auth/confirm?"),
    url);
  check("no Supabase host is anywhere in it", !/supabase/i.test(url));
  check("the hash is URL-encoded, so a token with + or / survives",
    url.includes("abc%2Fdef%2Bghi%3D"), url);
  check("the type rides along", url.includes("type=email"));
}

console.log("\nE. THE BUILT-IN TEMPLATE RENDERS WITHOUT GOTRUE");
{
  const html = `<a href="https://grovbase.com/auth/confirm?token_hash={{ .TokenHash }}&type=email">go</a>
{{ if .Data.first_name }}Cześć {{ .Data.first_name }}!{{ else }}Cześć!{{ end }}`;

  const withName = renderGoTemplate(html, { tokenHash: "tok+en", firstName: "Jan", token: "1" });
  check("the token hash is substituted and encoded", withName.includes("token_hash=tok%2Ben"), withName);
  check("no Go markers survive", !withName.includes("{{"), withName);
  check("the name branch is taken when there is a name", withName.includes("Cześć Jan!"));

  const without = renderGoTemplate(html, { tokenHash: "t", firstName: "", token: "1" });
  check("the else branch is taken when there is not", without.includes("Cześć!") && !without.includes("Cześć !"));

  // A name is user-supplied. It must not be able to close a tag.
  const nasty = renderGoTemplate(html, {
    tokenHash: "t", firstName: '</a><script>alert(1)</script>', token: "1",
  });
  check("a name cannot inject markup", !nasty.includes("<script>"), nasty.slice(0, 160));
}

console.log("\nF. EVERY AUTH ACTION HAS SOMEWHERE TO GET ITS WORDS");
{
  const authEntries = TEMPLATE_CATALOG.filter((e) => e.kind === "auth");
  check("all six auth actions are in the catalogue", authEntries.length === 6, authEntries.length);
  for (const entry of authEntries) {
    const def = defaultTemplate(entry.key);
    check(`${entry.event}: has built-in GrovBase copy`, def !== null && def.channel === "email");
    if (def && def.channel === "email") {
      check(`${entry.event}: the subject is GrovBase's`, /GrovBase/i.test(def.email.subject), def.email.subject);
      // The link is computed from the token, never typed — a template that
      // carried its own URL could be published pointing anywhere.
      check(`${entry.event}: carries no hardcoded link`, def.email.ctaUrl === "", def.email.ctaUrl);
    }
  }
  check("no auth default mentions Supabase to the customer",
    authEntries.every((e) => {
      const def = defaultTemplate(e.key);
      return !def || def.channel !== "email"
        || !/supabase/i.test(`${def.email.subject} ${def.email.heading} ${def.email.body} ${def.email.footer}`);
    }));
}

console.log(failures === 0 ? "\nAll auth-mail tests passed.\n" : `\n${failures} auth-mail test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
