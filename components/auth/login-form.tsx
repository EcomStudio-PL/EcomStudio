"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { PasswordField } from "@/components/auth/password-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { resendConfirmation } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

/** Error codes /auth/sign-in may redirect back with, and how each one reads.
 *  `unconfirmed` is absent on purpose: it renders as its own block below the
 *  form, because it carries a resend action. */
const NOTICES: Record<string, { key: string; tone: "danger" | "warning" }> = {
  invalid: { key: "auth.invalidCredentials", tone: "danger" },
  link: { key: "auth.linkInvalid", tone: "warning" },
  ratelimit: { key: "auth.errRateLimit", tone: "warning" },
  unavailable: { key: "auth.errUnavailable", tone: "warning" },
  config: { key: "auth.errConfig", tone: "danger" },
};

/**
 * THE LOGIN BODY — surface-free, so the modal owns the chrome.
 *
 * Sign-in stays a NATIVE form POST to /auth/sign-in (303 + Set-Cookie): the
 * one flow every WebView, including an installed iOS PWA, persists session
 * cookies from. Moving login into a dialog changes where the form is drawn,
 * never how it is submitted — no fetch, no server action, no client router on
 * the credential path. Only the resend-confirmation helper uses an action,
 * because it never writes a session.
 */
export function LoginForm({ next, error, email, onSwitch, showSignup = true }: {
  next: string;
  error?: string;
  /** Prefilled address after an "unconfirmed" bounce. */
  email?: string;
  /** Move to another mode inside the same dialog. Absent on a standalone page,
   *  where these become ordinary links — NOT buttons that call nothing. */
  onSwitch?: (mode: "register" | "forgot") => void;
  /** The "no account yet?" line. Off on the operator's door, where signing up
   *  is neither offered nor possible. */
  showSignup?: boolean;
}) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const notice = error ? NOTICES[error] : undefined;
  const [resendState, resendAction, resendPending] = useActionState(resendConfirmation, null);

  // `tap` widens the hit area without moving anything — these are 20px-tall
  // controls that a thumb cannot reliably land on. See .tap in globals.css.
  const linkClass = "tap font-medium text-accent transition-opacity hover:opacity-75";

  return (
    <div>
      {/* OAuthButtons draws its own "lub" divider — a second one here would
          stack two rules on top of each other. */}
      <OAuthButtons next={next} />

      <form method="post" action="/auth/sign-in" className="mt-4 space-y-4" onSubmit={() => setSubmitting(true)}>
        <input type="hidden" name="next" value={next} />
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email"
            defaultValue={email} placeholder="jan@firma.pl" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <PasswordField id="password" name="password" autoComplete="current-password" />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Real persistence choice: the route writes session-only cookies
              when this is unchecked. See /auth/sign-in. */}
          {/* `tap` on the LABEL, not the box: tapping the label is what
              toggles a checkbox, so the label is the real target — and at 13px
              it was 20px tall. See .tap in globals.css. */}
          <label className="tap flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" name="remember" defaultChecked
              className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
            {t("auth.rememberMe")}
          </label>
          {/* In the dialog this switches panes; on a standalone page there is
              no dialog to switch, so it has to be a real link. It used to be
              the same <button> either way, which meant a control that visibly
              did nothing outside the modal. */}
          {onSwitch ? (
            <button type="button" onClick={() => onSwitch("forgot")} className={`text-[13px] ${linkClass}`}>
              {t("auth.forgotPassword")}
            </button>
          ) : (
            <Link href="/forgot-password" className={`text-[13px] ${linkClass}`}>
              {t("auth.forgotPassword")}
            </Link>
          )}
        </div>

        {/* One category per real cause. Only "invalid" is about the
            credentials — telling someone their password is wrong when the
            service is down or they have simply tried too often sends them
            off resetting a password that was never the problem. The
            technical detail never leaves the server log. */}
        {notice && !submitting && (
          <p role="alert" className={cn(
            "rounded-xl px-3.5 py-2.5 text-[13px] font-medium",
            notice.tone === "danger"
              ? "bg-[rgb(var(--danger)/0.10)] text-danger"
              : "bg-[rgb(var(--warning)/0.10)] text-warning",
          )}>
            {t(notice.key)}
          </p>
        )}
        <button type="submit" disabled={submitting}
          className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
          {submitting && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {submitting ? t("common.loading") : t("auth.signIn")}
        </button>
      </form>

      {/* Its own form on purpose: sharing the sign-in form would fire that
          form's submit handler and freeze the login button. */}
      {error === "unconfirmed" && (
        <div role="alert" className="mt-4 rounded-xl bg-[rgb(var(--warning)/0.10)] px-3.5 py-2.5 text-[13px]">
          <p className="font-medium text-warning">{t("auth.errUnconfirmed")}</p>
          {resendState?.info ? (
            <p className="mt-1.5 flex items-center gap-1.5 font-medium text-success">
              <MailCheck size={13} aria-hidden />
              {resendState.info === "cooldown" ? t("auth.resendCooldown") : t("auth.resendSent")}
            </p>
          ) : (
            <form action={resendAction} className="mt-1">
              <input type="hidden" name="email" value={email ?? ""} />
              <button type="submit" disabled={resendPending}
                className="font-semibold text-accent hover:opacity-75 disabled:opacity-50">
                {resendPending ? t("common.loading") : t("auth.resendEmail")}
              </button>
            </form>
          )}
        </div>
      )}

      {showSignup && (
        <p className="mt-5 text-center text-sm text-muted">
          {t("auth.noAccount")}{" "}
          {onSwitch ? (
            <button type="button" onClick={() => onSwitch("register")} className={linkClass}>
              {t("auth.signUp")}
            </button>
          ) : (
            <Link href="/register" className={linkClass}>{t("auth.signUp")}</Link>
          )}
        </p>
      )}
    </div>
  );
}
