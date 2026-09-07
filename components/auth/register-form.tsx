"use client";
import Link from "next/link";
import { AuthLink } from "@/components/auth/auth-link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { signUp, resendConfirmation, type SignUpErrors } from "@/app/actions/auth";
import { passwordIssue } from "@/lib/auth-validation";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PasswordField } from "@/components/auth/password-field";
import { PasswordRules } from "@/components/auth/password-rules";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { cn } from "@/lib/utils";

/**
 * Form-level error code → i18n key.
 *
 * `rate_limited` was missing from this table, and the fallback swallowed it:
 * the server correctly identified Supabase's "email rate limit exceeded" (429)
 * and the form then told the customer the SERVER WAS UNREACHABLE. It is the
 * one message that sends someone to check their wi-fi over a problem that
 * fixes itself in an hour. Every code the action can produce is listed here
 * now, and the fallback is a last resort rather than a routine outcome.
 */
const FORM_ERROR_KEYS: Record<string, string> = {
  registration_disabled: "auth.registrationDisabled",
  captcha: "auth.errCaptcha",
  captcha_failed: "auth.errCaptchaFailed",
  captcha_unavailable: "auth.errCaptchaUnavailable",
  ip_limit: "auth.errIpLimit",
  activation_send: "auth.errActivationSend",
  rate_limited: "auth.errRateLimited",
  network: "auth.err_network",
};

/**
 * REGISTRATION — four fields, and that is the entire form.
 *
 * Name, e-mail, password, confirm. Everything else that used to live here has
 * gone somewhere it is worth more: the phone number and "how did you hear
 * about us" to the onboarding survey (answered for credits, not for friction),
 * and the company details — name, tax id, address — to Ustawienia → Dane firmy
 * and to checkout, where an invoice is actually being issued. Registration is
 * not the place to ask a stranger for their VAT number.
 *
 * Nothing about the SUBMISSION got simpler: same server action, same captcha,
 * same consents, same per-IP cap and anti-multiaccount checks. The billing and
 * company columns are untouched — they are simply filled in later.
 *
 * Validation is shared with the server action (lib/auth-validation): the
 * client gives instant feedback, the server has the final word, and the two
 * cannot drift.
 */
export function RegisterForm({ captchaSiteKey, bare = false, next = "", onSwitch }: {
  captchaSiteKey: string;
  /** Inside the auth dialog the surface, the heading and the padding belong
   *  to the dialog — the form renders as a bare body. Nothing about the
   *  SUBMISSION changes: same action, same captcha, same consents, same
   *  anti-multiaccount and IP checks. */
  bare?: boolean;
  /** Carried into OAuth so a returnTo survives the provider round trip. */
  next?: string;
  /** Move to another mode without leaving the dialog. */
  onSwitch?: (mode: "login") => void;
}) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(signUp, null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [resendState, resendAction, resendPending] = useActionState(resendConfirmation, null);
  const captchaRef = useRef<TurnstileHandle>(null);

  // Turnstile tokens are SINGLE-USE and this form round-trips the server
  // action on every validation error — without a reset the next submit would
  // replay the consumed token and fail as captcha_failed no matter what the
  // user fixed.
  useEffect(() => {
    if (captchaSiteKey && state && !state.ok) captchaRef.current?.reset();
  }, [state, captchaSiteKey]);

  const errors: SignUpErrors = state?.errors ?? {};
  // After a server validation error React resets uncontrolled fields to
  // their defaultValue — which is exactly this echo, so nothing typed is
  // ever lost on a 13-field form.
  const v = state?.values ?? {};
  const err = (key: keyof SignUpErrors) => {
    const code = errors[key];
    if (!code) return null;
    return (
      <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger">
        {t(`auth.err_${code}`)}
      </p>
    );
  };

  /* ── Post-signup: the check-your-inbox screen ── */
  if (state?.ok && state.info === "confirm_email") {
    return (
      <Shell bare={bare} className="mx-auto w-full max-w-md p-6 text-center sm:p-8" bareClassName="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.14)] text-accent">
          <MailCheck size={26} aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold">{t("auth.inboxTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t("auth.inboxBody")}{" "}
          <span className="font-semibold text-ink">{state.email}</span>
        </p>
        <form action={resendAction} className="mt-6">
          <input type="hidden" name="email" value={state.email ?? ""} />
          {resendState?.info ? (
            <p className="text-sm font-medium text-success">
              {resendState.info === "cooldown" ? t("auth.resendCooldown") : t("auth.resendSent")}
            </p>
          ) : (
            <button type="submit" disabled={resendPending}
              className="plate inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink hover:bg-raised disabled:opacity-60">
              {resendPending && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {t("auth.resendEmail")}
            </button>
          )}
        </form>
        <p className="mt-5 text-sm text-muted">
          {onSwitch
            ? <button type="button" onClick={() => onSwitch("login")} className="font-medium text-accent">{t("auth.backToLogin")}</button>
            : <AuthLink mode="login" className="font-medium text-accent">{t("auth.backToLogin")}</AuthLink>}
        </p>
      </Shell>
    );
  }

  const pwMismatch = confirm.length > 0 && password !== confirm;

  return (
    <Shell bare={bare} className="relative mx-auto w-full max-w-xl overflow-hidden p-6 sm:p-8">
      {!bare && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: "radial-gradient(20rem 7rem at 18% -30%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
          <h1 className="relative font-display text-xl font-semibold tracking-tight">{t("auth.registerTitle")}</h1>
          <p className="relative mt-1 text-sm text-muted">{t("auth.registerSubNoCredits")}</p>
        </>
      )}

      <div className={bare ? "" : "relative mt-6"}><OAuthButtons next={next} compact={bare} /></div>

      <form action={action} className={cn("relative", bare ? "mt-3 space-y-2.5 max-[419px]:space-y-2" : "mt-4 space-y-4")} noValidate>
        {/* FOUR FIELDS, and that is the whole form. Name, e-mail and the two
            password boxes — nothing between a visitor and an account that we
            can ask for later, when asking is worth credits to them (the
            onboarding survey) or an invoice to them (checkout). */}
        {/* Name and e-mail share a row once there is room for two comfortable
            columns. Below that they stack — a 140px box is not somewhere to
            type an address. The passwords never pair (see below). */}
        <div className="grid gap-2.5 min-[420px]:grid-cols-2 min-[420px]:gap-3">
          <div>
            <Label htmlFor="full_name">{t("auth.fullName")} *</Label>
            <Input id="full_name" name="full_name" required autoComplete="name"
              placeholder={t("auth.fullNamePlaceholder")}
              defaultValue={v.full_name} aria-invalid={!!errors.full_name || undefined} />
            {err("full_name")}
          </div>
          <div>
            <Label htmlFor="email">{t("auth.email")} *</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" defaultValue={v.email}
              inputMode="email" aria-invalid={!!errors.email || undefined} />
            {err("email")}
          </div>
        </div>

        {/* Passwords, one under the other and full width. They shared a row
            once, which fitted more on screen and served the user worse: a
            password manager's overlay and a genuinely long passphrase both
            need the whole width, and a half-width box is where people mistype
            the confirmation. The height that costs is bought back from the
            spacing and from the rules, laid out in one line below. */}
        <div>
          <Label htmlFor="password">{t("auth.password")} *</Label>
          <PasswordField id="password" name="password" autoComplete="new-password"
            value={password} onChange={setPassword} minLength={8}
            invalid={!!errors.password || (password.length > 0 && passwordIssue(password) !== null)} />
          <PasswordRules password={password} inline={bare} />
          {err("password")}
        </div>
        <div>
          <Label htmlFor="password_confirm">{t("auth.passwordConfirm")} *</Label>
          <PasswordField id="password_confirm" name="password_confirm" autoComplete="new-password"
            value={confirm} onChange={setConfirm} minLength={8}
            invalid={pwMismatch || !!errors.password_confirm} />
          {(pwMismatch || errors.password_confirm) && (
            <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger">{t("auth.err_mismatch")}</p>
          )}
        </div>

        {/* Consents */}
        <div className={cn("space-y-3 border-t border-line", bare ? "pt-3" : "pt-4")}>
          <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-muted">
            <input type="checkbox" name="accept_terms" checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]" />
            <span>
              {t("auth.termsPre")}{" "}
              <Link href="/regulamin" target="_blank" className="font-medium text-accent underline-offset-2 hover:underline">
                {t("auth.termsLink")}
              </Link>{" "}
              {t("auth.termsMid")}{" "}
              <Link href="/polityka-prywatnosci" target="_blank" className="font-medium text-accent underline-offset-2 hover:underline">
                {t("auth.privacyLink")}
              </Link>{" "}
              GrovBase. *
            </span>
          </label>
          {err("terms")}
          <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-muted">
            <input type="checkbox" name="marketing_consent" defaultChecked={v.marketing_consent}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]" />
            <span>{t("auth.marketingConsent")}</span>
          </label>
        </div>

        {/* Captcha — renders nothing while the admin has not configured it */}
        <Turnstile ref={captchaRef} siteKey={captchaSiteKey} />

        {errors.form && (
          <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.10)] px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {/* "Confirm you are not a robot" is unanswerable when no widget is
                on screen — which happens if the config read failed here but
                succeeded on the server. Say the truth instead: the check is
                unavailable, reload. */}
            {t(errors.form === "captcha" && !captchaSiteKey
              ? "auth.errCaptchaUnavailable"
              : FORM_ERROR_KEYS[errors.form] ?? "auth.err_network")}
          </p>
        )}

        <button type="submit" disabled={!terms || pending}
          className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-50">
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {pending ? t("common.loading") : t("auth.signUp")}
        </button>
      </form>

      <p className={cn("text-sm text-muted", bare ? "mt-3.5 text-center" : "relative mt-5")}>
        {t("auth.haveAccount")}{" "}
        {onSwitch
          ? <button type="button" onClick={() => onSwitch("login")} className="-my-2 py-2 font-medium text-accent">{t("auth.signIn")}</button>
          : <AuthLink mode="login" className="font-medium text-accent">{t("auth.signIn")}</AuthLink>}
      </p>
    </Shell>
  );
}

/** The card the standalone page needs and the dialog must not draw twice. */
function Shell({ bare, className, bareClassName, children }: {
  bare: boolean;
  className: string;
  bareClassName?: string;
  children: React.ReactNode;
}) {
  return bare
    ? <div className={bareClassName}>{children}</div>
    : <Card className={className}>{children}</Card>;
}
