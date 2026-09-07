"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { verifyTurnstile } from "@/lib/server/captcha";
import { readIntegrationSecrets, safeError } from "@/lib/server/integrations";
import { collectEventContext, contextRows, eventDataFrom, formatWarsaw } from "@/lib/server/event-context";
import { recordSignup, signupAllowed, signupIpHash } from "@/lib/server/signup-guard";
import { signupAllowedNow } from "@/lib/server/platform-access";
import { getLocale } from "@/lib/i18n/server";
import { absoluteUrl } from "@/lib/site";
import { EMAIL_RE, fullNameIssue, passwordIssue, splitFullName } from "@/lib/auth-validation";
import { mapSignUpError } from "@/lib/auth-error-map";

type Result = { ok: boolean; error?: string; info?: string; email?: string };

/**
 * Every emailed auth link points at the configured site, not at the host the
 * request arrived on. A confirmation mail outlives the request that triggered
 * it, so it has to name the canonical address — and an attacker-supplied
 * Host / X-Forwarded-Host header must never be able to steer where a real
 * user's confirmation or password-reset link takes them.
 */
const authLink = (path: string) => absoluteUrl(path);

async function callerIp() {
  const fwd = (await headers()).get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? "").trim() || "unknown";
}

/* ── Validation shared with the client (server is authoritative) ───────── */

export type SignUpErrors = Partial<Record<
  "full_name" | "email" | "password" | "password_confirm" | "terms" | "form",
  string
>>;

/* ── Registration ──────────────────────────────────────────────────────── */

export type SignUpValues = Partial<Record<"full_name" | "email", string>>
  & { marketing_consent?: boolean };

export type SignUpState = {
  ok: boolean; errors?: SignUpErrors; info?: string; email?: string;
  /** Echo of what was typed, so a validation error never wipes the form:
   *  React resets uncontrolled fields to their defaultValue after an action,
   *  and these become exactly that defaultValue. */
  values?: SignUpValues;
} | null;

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  // Length caps mirror the DB trigger: the profile row is capped there, but
  // an uncapped value would still land in auth.users.raw_user_meta_data and
  // ride inside every JWT — a 200KB "name" would brick its own session.
  const CAP: Record<string, number> = { full_name: 160, email: 320 };
  const f = (k: string) => String(formData.get(k) ?? "").trim().slice(0, CAP[k] ?? 200);
  const email = f("email");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");
  // ONE name box, two columns behind it. The profile keeps first_name and
  // last_name (the CRM, the mail templates and the admin list read them);
  // signup just stopped asking the question twice.
  const fullName = f("full_name");
  const { firstName, lastName } = splitFullName(fullName);

  const supabase = await createClient();

  // Signup asks four things and validates four things. The phone number and
  // the "how did you hear about us" question moved OUT of registration: the
  // second is now the first onboarding survey question, where it is worth
  // credits to the customer rather than friction before the account exists.
  const errors: SignUpErrors = {};
  const nameIssue = fullNameIssue(fullName);
  if (nameIssue) errors.full_name = nameIssue;
  if (!EMAIL_RE.test(email)) errors.email = "email";
  const pwIssue = passwordIssue(password);
  if (pwIssue) errors.password = pwIssue;
  if (password !== confirm) errors.password_confirm = "mismatch";
  if (formData.get("accept_terms") == null) errors.terms = "required";
  // Nothing else is validated because nothing else is ASKED. Company name, tax
  // id and address are collected in Ustawienia → Dane firmy and at checkout,
  // where an invoice is genuinely being issued; the columns behind them are
  // untouched. A stray `company_account` field posted by an old cached page
  // is therefore ignored rather than turned into a required-field error the
  // form has no box for — which is exactly how a hidden required field bricks
  // a signup.
  const values: SignUpValues = {
    full_name: fullName, email,
    marketing_consent: formData.get("marketing_consent") != null,
  };
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  // Signup spam brake — generous for humans, hostile to scripts.
  if (!rateLimit(`signup:${await callerIp()}`, 5, 600_000)) {
    return { ok: false, errors: { form: "network" }, values };
  }

  // THE DOOR. Registration can be closed outright or scheduled to open later,
  // and this is where that is enforced — not in the button that was hidden.
  // A direct POST to this action while signup is shut creates nothing.
  if (!(await signupAllowedNow(supabase))) {
    return { ok: false, errors: { form: "registration_disabled" }, values };
  }

  // ── Abuse guards (0054): captcha, then the per-IP cap ──────────────────
  // Both sit after the cheap checks and BEFORE auth.signUp, so a script has
  // to spend a Turnstile solve before it can even reach GoTrue.
  const ip = await callerIp();

  // WHETHER a captcha is required is decided by ONE authority, the same one
  // the browser asked: captcha_site_key(), which answers with the site key
  // only when a site key is saved AND a secret envelope exists. If the widget
  // was rendered, a token is demanded — no exceptions.
  //
  // This used to be inferred from the decrypted secret instead, which quietly
  // made the whole check optional: any context that could not read or open the
  // secret skipped verification entirely and the signup went through with the
  // widget solved for nothing. Public signup is exactly such a context, so in
  // production the captcha was decoration. It is not any more:
  //
  //   widget shown + no token          → rejected (solve it)
  //   widget shown + Cloudflare says no → rejected (solve it again)
  //   widget shown + we cannot verify   → REJECTED, and logged as ours
  //
  // The last line is the important one. Failing open there is what "visual
  // protection" means, and a signup we cannot vouch for is not one to accept.
  const { data: siteKeyData } = await supabase.rpc("captcha_site_key");
  const captchaRequired = String(siteKeyData ?? "").trim() !== "";
  if (captchaRequired) {
    const captcha = await readIntegrationSecrets<{ site_key?: string }>(supabase, "captcha");
    const captchaSecret = captcha.secrets.secret_key ?? "";
    const captchaToken = String(formData.get("cf-turnstile-response") ?? "").trim();
    if (!captchaToken) return { ok: false, errors: { form: "captcha" }, values };
    if (!captchaSecret) {
      // The envelope is there (captcha_site_key() saw it) but this process
      // could not open it: a rotated APP_ENCRYPTION_KEY, or a read that came
      // back empty. Operator-visible, customer-honest, and not a way in.
      console.error("signup.captcha", "secret_unreadable");
      return { ok: false, errors: { form: "captcha_unavailable" }, values };
    }
    // ONE verification per token. Turnstile tokens are single-use, so a second
    // siteverify call on the same token would come back timeout-or-duplicate
    // and fail a legitimate human — there is no retry loop here by design.
    const verdict = await verifyTurnstile(captchaSecret, captchaToken, ip === "unknown" ? undefined : ip);
    if (!verdict.ok) {
      // bad_token is the user's problem (expired widget, replay) and solving
      // again fixes it. bad_secret / network are OURS — the user sees the
      // same retry message, but a scrubbed log line tells the operator the
      // secret is wrong or Cloudflare was unreachable.
      if (verdict.error === "bad_secret" || verdict.error === "network") {
        console.error("signup.captcha", safeError(verdict.error));
      }
      return { ok: false, errors: { form: "captcha_failed" }, values };
    }
  }

  // Per-IP cap. Only the keyed hash ever leaves this function; a null hash
  // (no key, unknown IP) or any RPC failure fails open, because the guard is
  // a speed bump for mass registration, never a lock on real customers.
  const ipHash = signupIpHash(ip);
  if (ipHash && !(await signupAllowed(supabase, ipHash))) {
    return { ok: false, errors: { form: "ip_limit" }, values };
  }

  const locale = await getLocale();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authLink("/auth/callback"),
      // Everything the profile needs rides the auth metadata: the signup
      // trigger copies it into public.profiles server-side, so it works
      // identically whether or not e-mail confirmation gates the session.
      // Consent TIMESTAMPS are stamped by the trigger (now()), not here.
      data: {
        locale,
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        marketing_consent: formData.get("marketing_consent") != null,
        accepted_terms: true,
      },
    },
  });
  if (error) {
    // The customer never sees Supabase's text, but the OPERATOR has to. Until
    // this line existed, a failing confirmation e-mail reached the browser as
    // "Nie udało się połączyć z serwerem" and left nothing behind to diagnose
    // it with — the reason the production signup outage had to be reconstructed
    // from auth_email_log instead of simply read. Code, status and a scrubbed
    // message only: never the password, never the token, never a secret.
    console.error("signup.gotrue", JSON.stringify({
      code: error.code ?? null,
      status: error.status ?? null,
      message: safeError(error),
    }));
    // Never surface raw Supabase text. The whole translation table lives in
    // lib/auth-error-map so it can be tested exhaustively without a running
    // signup — that is where the reasoning for each case is written down. An
    // already registered address is NOT revealed by any branch of it.
    const mapped = mapSignUpError(error);
    if ("field" in mapped) {
      return { ok: false, errors: { [mapped.field]: mapped.code }, values };
    }
    return { ok: false, errors: { form: mapped.form }, values };
  }

  // A real registration is worth a Telegram ping — but never at the new
  // customer's expense: `after` runs the enqueue and the send once the
  // response is already on its way, so a slow bot cannot hold up the redirect
  // or the confirm-your-inbox screen, and notify() swallows its own failures.
  // With confirmations on, GoTrue answers a repeat signup for a known address
  // with a success-shaped response (deliberately — see above), and the only
  // thing that distinguishes it is an EMPTY identities array. Test that
  // structurally, never for truthiness: a response that omits identities
  // altogether is a real registration and must still be announced. The e-mail
  // dedupe key below stays as the backstop for genuine double-submits, since
  // it only remembers signups that were actually enqueued. Nothing from the
  // password or the session goes near the payload.
  if (data.user?.identities?.length !== 0) {
    // Read on the request, not inside after(): headers and cookies are
    // request-scoped state, and parsing them costs microseconds — it is the
    // enqueue and the Telegram round trip that must not touch the hot path.
    // The interface locale beats Accept-Language here because we know it: it is
    // what every e-mail to this address will be written in.
    const context = await collectEventContext();
    // Empty rows are dropped rather than rendered as a dangling label, so a
    // field the customer left blank simply is not in the message.
    // Only what signup actually collects. The phone number and the acquisition
    // answer are no longer asked here (the second is the first onboarding
    // survey question now), so they are not in the card — an operator reading
    // "Telefon: undefined" would be worse than not showing the row at all.
    const rows: [string, string][] = [
      ["👤 Użytkownik", fullName],
      ["📧 E-mail", email],
      ["🕒 Data", formatWarsaw(new Date())],
      // What the server SAW: campaign, entry point, address, device.
      ...contextRows({ ...context, language: locale.toUpperCase() }),
    ];
    // The keyed twin of `rows`: what a published admin template binds its
    // {{placeholders}} to. The registration form's own answer wins over the
    // UTM tag for {{source}}, same as the row above. Named `tplData` and not
    // `data`: the signUp result above owns that name in this scope, and
    // shadowing it here would read as a temporal-dead-zone crash, not a rename.
    const tplData = eventDataFrom(context, {
      name: fullName,
      email,
      // No phone and no self-reported source at signup any more. The UTM
      // source that collectEventContext() found still rides along inside
      // `context` — that one we genuinely have.
      language: locale.toUpperCase(),
      // Not a field anyone reads in the message — it is what turns the
      // Telegram card's button into "Otwórz klienta" for THIS customer.
      ...(data.user?.id ? { user_id: data.user.id } : {}),
    });
    after(() => notify(supabase, {
      type: "user.registered",
      title: "NOWA REJESTRACJA",
      icon: "🎉",
      rows: rows.filter(([, value]) => value !== ""),
      data: tplData,
      footer: "GrovBase Admin",
      dedupeKey: buildDedupeKey("user.registered", email.toLowerCase()),
    }));
    // The per-IP cap counts registrations that actually happened, recorded
    // the same way the ping goes out: in after(), so the new customer never
    // waits on bookkeeping, and the SQL no-ops silently on a bad token.
    if (ipHash) {
      after(() => recordSignup(supabase, ipHash, email));
    }
  }

  // Auto-confirm environments hand back a session right away.
  if (data.session) redirect("/home");
  return { ok: true, info: "confirm_email", email };
}

/** "Wyślij e-mail ponownie" on the check-your-inbox screen. One send per
 *  minute per address+IP; the answer is identical either way.
 *
 *  It deliberately announces NOTHING: the registration was already reported
 *  when the account was created, and a customer who resends the confirmation
 *  three times must not look like three new customers. */
export async function resendConfirmation(_prev: Result | null, formData: FormData): Promise<Result> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: true, info: "sent" };
  if (!rateLimit(`resend:${await callerIp()}:${email.toLowerCase()}`, 1, 60_000)) {
    return { ok: true, info: "cooldown" };
  }
  const supabase = await createClient();
  await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: authLink("/auth/callback") },
  });
  // Deliberately ignore the outcome: success and "already confirmed" and
  // "no such account" must be indistinguishable to the caller.
  return { ok: true, info: "sent" };
}

/* ── Password reset ────────────────────────────────────────────────────── */

export async function requestPasswordReset(_prev: Result | null, formData: FormData): Promise<Result> {
  // Reset emails are a spam vector: 3 per 10 minutes per address is plenty
  // for a real person and starves a script. The response stays identical, so
  // the limiter leaks nothing about which emails exist.
  if (!rateLimit(`pwreset:${await callerIp()}`, 3, 600_000)) return { ok: true, info: "sent" };
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  if (email) {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authLink("/auth/callback?next=/reset-password"),
    });
  }
  // ALWAYS the same generic answer — errors included. Anything else is an
  // account-enumeration oracle.
  return { ok: true, info: "sent" };
}

export async function updatePassword(_prev: Result | null, formData: FormData): Promise<Result> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");
  const issue = passwordIssue(password);
  if (issue) return { ok: false, error: issue };
  if (password !== confirm) return { ok: false, error: "mismatch" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // No recovery session — the link was never opened here, or it expired.
  if (!user) return { ok: false, error: "no_session" };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: /different/i.test(error.message) ? "same_password" : "network" };
  return { ok: true, info: "updated" };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
