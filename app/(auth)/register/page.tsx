"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Building2, Loader2, MailCheck } from "lucide-react";
import { signUp, resendConfirmation, type SignUpErrors } from "@/app/actions/auth";
import { ACQUISITION_SOURCES, isPoland, passwordIssue, validNip } from "@/lib/auth-validation";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label, Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PasswordField } from "@/components/auth/password-field";
import { PasswordRules } from "@/components/auth/password-rules";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { cn } from "@/lib/utils";

/**
 * REGISTRATION — one card, progressively disclosed.
 *
 * The company block and the "Inne" follow-up exist only while their switch
 * is on, so a private account sees seven fields, not thirteen. Validation is
 * shared with the server action (lib/auth-validation) — the client gives
 * instant feedback, the server has the final word, and the two can't drift.
 * Server actions keep the DOM (and everything typed) intact on a validation
 * error, which matters on a form this long.
 */
export default function RegisterPage() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(signUp, null);
  const [source, setSource] = useState("");
  const [company, setCompany] = useState(false);
  const [country, setCountry] = useState("Polska");
  const [nip, setNip] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [resendState, resendAction, resendPending] = useActionState(resendConfirmation, null);

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
      <Card className="mx-auto w-full max-w-md p-6 text-center sm:p-8">
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
          <Link href="/login" className="font-medium text-accent">{t("auth.backToLogin")}</Link>
        </p>
      </Card>
    );
  }

  const nipInvalid = company && nip.length > 0 && (isPoland(country) ? !validNip(nip) : nip.replace(/[\s-]/g, "").length < 5);
  const pwMismatch = confirm.length > 0 && password !== confirm;

  return (
    <Card className="relative mx-auto w-full max-w-xl overflow-hidden p-6 sm:p-8">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(20rem 7rem at 18% -30%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
      <h1 className="relative font-display text-xl font-semibold tracking-tight">{t("auth.registerTitle")}</h1>
      <p className="relative mt-1 text-sm text-muted">{t("auth.registerSub")}</p>

      <div className="relative mt-6"><OAuthButtons /></div>

      <form action={action} className="relative mt-4 space-y-4" noValidate>
        {/* Identity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="first_name">{t("auth.firstName")} *</Label>
            <Input id="first_name" name="first_name" required autoComplete="given-name" defaultValue={v.first_name}
              aria-invalid={!!errors.first_name || undefined} />
            {err("first_name")}
          </div>
          <div>
            <Label htmlFor="last_name">{t("auth.lastName")} *</Label>
            <Input id="last_name" name="last_name" required autoComplete="family-name" defaultValue={v.last_name}
              aria-invalid={!!errors.last_name || undefined} />
            {err("last_name")}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="email">{t("auth.email")} *</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" defaultValue={v.email}
              inputMode="email" aria-invalid={!!errors.email || undefined} />
            {err("email")}
          </div>
          <div>
            <Label htmlFor="phone">{t("auth.phone")} *</Label>
            <Input id="phone" name="phone" type="tel" required autoComplete="tel" defaultValue={v.phone}
              inputMode="tel" placeholder="+48 600 000 000" aria-invalid={!!errors.phone || undefined} />
            {err("phone")}
          </div>
        </div>

        {/* Acquisition */}
        <div>
          <Label htmlFor="acquisition_source">{t("auth.acqLabel")} *</Label>
          <Select id="acquisition_source" name="acquisition_source" required value={source}
            onChange={(e) => setSource(e.target.value)} aria-invalid={!!errors.acquisition_source || undefined}>
            <option value="" disabled>{t("auth.acqPlaceholder")}</option>
            {ACQUISITION_SOURCES.map((s) => (
              <option key={s} value={s}>{t(`auth.acq_${s}`)}</option>
            ))}
          </Select>
          {err("acquisition_source")}
        </div>
        {source === "other" && (
          <div className="animate-fade">
            <Label htmlFor="acquisition_source_other">{t("auth.acqOtherLabel")} *</Label>
            <Input id="acquisition_source_other" name="acquisition_source_other" required defaultValue={v.acquisition_source_other}
              aria-invalid={!!errors.acquisition_source_other || undefined} />
            {err("acquisition_source_other")}
          </div>
        )}

        {/* Passwords */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="password">{t("auth.password")} *</Label>
            <PasswordField id="password" name="password" autoComplete="new-password"
              value={password} onChange={setPassword} minLength={8}
              invalid={!!errors.password || (password.length > 0 && passwordIssue(password) !== null)} />
            <PasswordRules password={password} />
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
        </div>

        {/* Company account */}
        <label className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-200",
          company ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.06)]" : "border-line hover:bg-raised/50",
        )}>
          <input type="checkbox" name="company_account" checked={company}
            onChange={(e) => setCompany(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
          <Building2 size={16} aria-hidden className={company ? "text-accent" : "text-faint"} />
          <span className="text-[13.5px] font-semibold">{t("auth.companyToggle")}</span>
        </label>

        {company && (
          <div className="animate-fade space-y-4 rounded-xl border border-[rgb(var(--accent)/0.25)] bg-[rgb(var(--accent)/0.03)] p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="company_name">{t("auth.companyName")} *</Label>
                <Input id="company_name" name="company_name" required autoComplete="organization" defaultValue={v.company_name}
                  aria-invalid={!!errors.company_name || undefined} />
                {err("company_name")}
              </div>
              <div>
                <Label htmlFor="tax_id">{t("auth.nip")} *</Label>
                <Input id="tax_id" name="tax_id" required inputMode="numeric" placeholder="0000000000"
                  value={nip} onChange={(e) => setNip(e.target.value)}
                  aria-invalid={nipInvalid || !!errors.tax_id || undefined}
                  className={cn(nipInvalid && "border-[rgb(var(--danger)/0.6)]")} />
                {(nipInvalid || errors.tax_id) && (
                  <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger">{t("auth.err_nip")}</p>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="company_street">{t("auth.street")} *</Label>
              <Input id="company_street" name="company_street" required autoComplete="street-address" defaultValue={v.company_street}
                aria-invalid={!!errors.company_street || undefined} />
              {err("company_street")}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="company_postal_code">{t("auth.postal")} *</Label>
                <Input id="company_postal_code" name="company_postal_code" required defaultValue={v.company_postal_code}
                  autoComplete="postal-code" placeholder="00-000"
                  aria-invalid={!!errors.company_postal_code || undefined} />
                {err("company_postal_code")}
              </div>
              <div>
                <Label htmlFor="company_city">{t("auth.city")} *</Label>
                <Input id="company_city" name="company_city" required autoComplete="address-level2" defaultValue={v.company_city}
                  aria-invalid={!!errors.company_city || undefined} />
                {err("company_city")}
              </div>
              <div>
                <Label htmlFor="company_country">{t("auth.countryLabel")} *</Label>
                <Input id="company_country" name="company_country" required autoComplete="country-name"
                  value={country} onChange={(e) => setCountry(e.target.value)}
                  aria-invalid={!!errors.company_country || undefined} />
                {err("company_country")}
              </div>
            </div>
          </div>
        )}

        {/* Consents */}
        <div className="space-y-3 border-t border-line pt-4">
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

        {errors.form && (
          <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.10)] px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {errors.form === "registration_disabled" ? t("auth.registrationDisabled") : t("auth.err_network")}
          </p>
        )}

        <button type="submit" disabled={!terms || pending}
          className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-50">
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {pending ? t("common.loading") : t("auth.signUp")}
        </button>
      </form>

      <p className="relative mt-5 text-sm text-muted">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-accent">{t("auth.signIn")}</Link>
      </p>
    </Card>
  );
}
