"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { getLocale } from "@/lib/i18n/server";
import { ACQUISITION_SOURCES, EMAIL_RE, isPoland, passwordIssue, validNip } from "@/lib/auth-validation";

type Result = { ok: boolean; error?: string; info?: string; email?: string };

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

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

  // Server-side validation mirrors the client; the client is convenience,
  // this is the boundary.
  const errors: SignUpErrors = {};
  if (!f("first_name")) errors.first_name = "required";
  if (!f("last_name")) errors.last_name = "required";
  if (!EMAIL_RE.test(email)) errors.email = "email";
  if (f("phone").replace(/\D/g, "").length < 7) errors.phone = "phone";
  if (!(ACQUISITION_SOURCES as readonly string[]).includes(source)) errors.acquisition_source = "required";
  if (source === "other" && !f("acquisition_source_other")) errors.acquisition_source_other = "required";
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

  const supabase = await createClient();
  const { data: security } = await supabase
    .from("app_settings").select("value").eq("key", "security").maybeSingle();
  const sec = (security?.value ?? {}) as { registration_enabled?: boolean };
  if (sec.registration_enabled === false) {
    return { ok: false, errors: { form: "registration_disabled" }, values };
  }

  const locale = await getLocale();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
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
    return { ok: false, errors: { form: "network" }, values };
  }

  // Auto-confirm environments hand back a session right away.
  if (data.session) redirect("/home");
  return { ok: true, info: "confirm_email", email };
}

/** "Wyślij e-mail ponownie" on the check-your-inbox screen. One send per
 *  minute per address+IP; the answer is identical either way. */
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
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback` },
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
      redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
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
