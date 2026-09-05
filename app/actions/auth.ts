"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { buildDedupeKey, notify } from "@/lib/server/notify";
import { verifyTurnstile } from "@/lib/server/captcha";
import { readIntegrationSecrets, safeError } from "@/lib/server/integrations";
import { collectEventContext, contextRows, formatWarsaw } from "@/lib/server/event-context";
import { recordSignup, signupAllowed, signupIpHash } from "@/lib/server/signup-guard";
import { getRegistrationConfig } from "@/lib/server/registration-config";
import { getLocale } from "@/lib/i18n/server";
import { absoluteUrl } from "@/lib/site";
import { ACQUISITION_SOURCES, EMAIL_RE, isPoland, passwordIssue, validNip } from "@/lib/auth-validation";

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
  | "first_name" | "last_name" | "email" | "phone" | "acquisition_source"
  | "acquisition_source_other" | "password" | "password_confirm" | "terms"
  | "company_name" | "tax_id" | "company_street" | "company_postal_code"
  | "company_city" | "company_country" | "form",
  string
>>;

/* ── Registration ──────────────────────────────────────────────────────── */

export type SignUpValues = Partial<Record<
  | "first_name" | "last_name" | "email" | "phone" | "acquisition_source_other"
  | "company_name" | "tax_id" | "company_street" | "company_postal_code"
  | "company_city" | "company_country", string>> & { marketing_consent?: boolean };

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
  const CAP: Record<string, number> = {
    first_name: 80, last_name: 80, phone: 32, acquisition_source_other: 200,
    company_name: 200, tax_id: 20, company_street: 200,
    company_postal_code: 12, company_city: 120, company_country: 80, email: 320,
  };
  const f = (k: string) => String(formData.get(k) ?? "").trim().slice(0, CAP[k] ?? 200);
  const email = f("email");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");
  const company = formData.get("company_account") != null;
  const source = f("acquisition_source");
  const country = f("company_country") || "Polska";

  // The admin decides which of the four soft fields the form asks for, so the
  // server has to ask the same question the form did. Reading it here (before
  // validation) is what stops a field switched to "hidden" from failing a
  // required check the customer has no input to satisfy.
  const supabase = await createClient();
  const { signup: fields } = await getRegistrationConfig(supabase);

  // Server-side validation mirrors the client; the client is convenience,
  // this is the boundary. A hidden field is not validated at all; an optional
  // one is checked only when the customer actually filled it in.
  const errors: SignUpErrors = {};
  if (fields.firstName === "required" && !f("first_name")) errors.first_name = "required";
  if (fields.lastName === "required" && !f("last_name")) errors.last_name = "required";
  if (!EMAIL_RE.test(email)) errors.email = "email";
  if (fields.phone !== "hidden" && (fields.phone === "required" || f("phone") !== "")) {
    if (f("phone").replace(/\D/g, "").length < 7) errors.phone = "phone";
  }
  if (fields.acquisition !== "hidden") {
    const known = (ACQUISITION_SOURCES as readonly string[]).includes(source);
    if (fields.acquisition === "required" && !known) errors.acquisition_source = "required";
    // Answering "Inne" is what makes the follow-up mandatory — never the
    // field's own mode, which only governs whether we asked at all.
    else if (source !== "" && !known) errors.acquisition_source = "required";
    else if (source === "other" && !f("acquisition_source_other")) errors.acquisition_source_other = "required";
  }
  const pwIssue = passwordIssue(password);
  if (pwIssue) errors.password = pwIssue;
  if (password !== confirm) errors.password_confirm = "mismatch";
  if (formData.get("accept_terms") == null) errors.terms = "required";
  if (company) {
    if (!f("company_name")) errors.company_name = "required";
    if (!f("company_street")) errors.company_street = "required";
    if (!f("company_postal_code")) errors.company_postal_code = "required";
    if (!f("company_city")) errors.company_city = "required";
    if (!country) errors.company_country = "required";
    // Checksum-validated NIP for Poland; other countries get a sanity check.
    if (isPoland(country) ? !validNip(f("tax_id")) : f("tax_id").replace(/[\s-]/g, "").length < 5) {
      errors.tax_id = "nip";
    }
  }
  const values: SignUpValues = {
    first_name: f("first_name"), last_name: f("last_name"), email,
    phone: f("phone"), acquisition_source_other: f("acquisition_source_other"),
    company_name: f("company_name"), tax_id: f("tax_id"),
    company_street: f("company_street"), company_postal_code: f("company_postal_code"),
    company_city: f("company_city"), company_country: country,
    marketing_consent: formData.get("marketing_consent") != null,
  };
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  // Signup spam brake — generous for humans, hostile to scripts.
  if (!rateLimit(`signup:${await callerIp()}`, 5, 600_000)) {
    return { ok: false, errors: { form: "network" }, values };
  }

  const { data: security } = await supabase
    .from("app_settings").select("value").eq("key", "security").maybeSingle();
  const sec = (security?.value ?? {}) as { registration_enabled?: boolean };
  if (sec.registration_enabled === false) {
    return { ok: false, errors: { form: "registration_disabled" }, values };
  }

  // ── Abuse guards (0054): captcha, then the per-IP cap ──────────────────
  // Both sit after the cheap checks and BEFORE auth.signUp, so a script has
  // to spend a Turnstile solve before it can even reach GoTrue.
  const ip = await callerIp();

  // Captcha runs only when fully configured — public site key typed AND the
  // secret envelope saved — which is exactly the condition under which the
  // register page rendered a widget. Half-configured or absent means no
  // widget was shown, so demanding a token here would brick every signup.
  const captcha = await readIntegrationSecrets<{ site_key?: string }>(supabase, "captcha");
  const captchaSecret = captcha.secrets.secret_key ?? "";
  if ((captcha.config.site_key ?? "").trim() !== "" && captchaSecret !== "") {
    const captchaToken = String(formData.get("cf-turnstile-response") ?? "").trim();
    if (!captchaToken) return { ok: false, errors: { form: "captcha" }, values };
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
        full_name: `${f("first_name")} ${f("last_name")}`.trim(),
        first_name: f("first_name"),
        last_name: f("last_name"),
        phone: f("phone"),
        acquisition_source: source,
        acquisition_source_other: source === "other" ? f("acquisition_source_other") : "",
        company_account: company,
        company_name: company ? f("company_name") : "",
        tax_id: company ? f("tax_id") : "",
        company_street: company ? f("company_street") : "",
        company_postal_code: company ? f("company_postal_code") : "",
        company_city: company ? f("company_city") : "",
        company_country: company ? country : "",
        marketing_consent: formData.get("marketing_consent") != null,
        accepted_terms: true,
      },
    },
  });
  if (error) {
    // Never surface raw Supabase text. Weak-password style errors map to the
    // password field; everything else is a generic retry message. An already
    // registered address is NOT revealed: with confirmations on, Supabase
    // returns a success-shaped response for it, and we show the same
    // "check your inbox" screen either way.
    if (/password/i.test(error.message)) return { ok: false, errors: { password: "pw_length" }, values };
    // GoTrue validates deliverability beyond our format regex (it rejects
    // reserved TLDs like .test and known-bad domains) — that belongs on the
    // email field, not on a generic "server unreachable" banner.
    if (error.code === "email_address_invalid" || /email.+invalid/i.test(error.message)) {
      return { ok: false, errors: { email: "email" }, values };
    }
    // Confirmation e-mails are quota-limited (Supabase built-in mailer:
    // ~2/hour until custom SMTP is configured). "Try again shortly" is the
    // truth here, not "server unreachable".
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return { ok: false, errors: { form: "rate_limited" }, values };
    }
    // A dead SMTP is GoTrue's own 500 — "Error sending confirmation email",
    // code unexpected_failure. The account may well exist by then, so calling
    // it "server unreachable" would be a lie twice over; the dedicated code
    // lets the UI point at the resend button instead.
    if (/send.*(confirmation|email)|email.*send/i.test(error.message)) {
      return { ok: false, errors: { form: "activation_send" }, values };
    }
    return { ok: false, errors: { form: "network" }, values };
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
    const rows: [string, string][] = [
      ["👤 Użytkownik", `${f("first_name")} ${f("last_name")}`.trim()],
      ["📧 E-mail", email],
      ["📱 Telefon", f("phone")],
      ["🕒 Data", formatWarsaw(new Date())],
      // What the customer SAID, with "inne" replaced by what they typed —
      // "other" on its own tells the operator nothing.
      ["🌍 Źródło", source === "other" ? f("acquisition_source_other") : source],
      // What the server SAW: campaign, entry point, address, device.
      ...contextRows({ ...context, language: locale.toUpperCase() }),
    ];
    after(() => notify(supabase, {
      type: "user.registered",
      title: "NOWA REJESTRACJA",
      icon: "🎉",
      rows: rows.filter(([, value]) => value !== ""),
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
