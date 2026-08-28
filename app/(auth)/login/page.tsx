"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PasswordField } from "@/components/auth/password-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { resendConfirmation } from "@/app/actions/auth";

/** Login is a NATIVE form POST to /auth/sign-in (303 + Set-Cookie) — the only
 *  flow installed standalone PWAs handle as reliably as a browser tab. No
 *  fetch, no server-action roundtrip, no client router on the auth path.
 *  Only the resend-confirmation helper uses an action, because it never
 *  writes session cookies. */
export default function LoginPage() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const error = params.get("error");
  const next = params.get("next") ?? "";
  const unconfirmedEmail = params.get("email") ?? "";
  const [resendState, resendAction, resendPending] = useActionState(resendConfirmation, null);

  return (
    <Card className="relative overflow-hidden p-6 sm:p-8">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(18rem 7rem at 18% -30%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
      <h1 className="relative font-display text-xl font-semibold tracking-tight">{t("auth.loginTitle")}</h1>
      <p className="relative mt-1 text-sm text-muted">{t("auth.loginSub")}</p>

      <div className="relative mt-6">
        <OAuthButtons />
      </div>

      <form method="post" action="/auth/sign-in" className="relative mt-4 space-y-4" onSubmit={() => setSubmitting(true)}>
        <input type="hidden" name="next" value={next} />
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email"
            defaultValue={unconfirmedEmail} placeholder="jan@firma.pl" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <PasswordField id="password" name="password" autoComplete="current-password" />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Real persistence choice: the route writes session-only cookies
              when this is unchecked. See /auth/sign-in. */}
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" name="remember" defaultChecked
              className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" />
            {t("auth.rememberMe")}
          </label>
          <Link href="/forgot-password" className="text-[13px] font-medium text-accent hover:opacity-75">
            {t("auth.forgotPassword")}
          </Link>
        </div>

        {error === "invalid" && !submitting && (
          <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.10)] px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {t("auth.invalidCredentials")}
          </p>
        )}
        {error === "link" && !submitting && (
          <p role="alert" className="rounded-xl bg-[rgb(var(--warning)/0.10)] px-3.5 py-2.5 text-[13px] font-medium text-warning">
            {t("auth.linkInvalid")}
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
        <div role="alert" className="relative mt-4 rounded-xl bg-[rgb(var(--warning)/0.10)] px-3.5 py-2.5 text-[13px]">
          <p className="font-medium text-warning">{t("auth.errUnconfirmed")}</p>
          {resendState?.info ? (
            <p className="mt-1.5 flex items-center gap-1.5 font-medium text-success">
              <MailCheck size={13} aria-hidden />
              {resendState.info === "cooldown" ? t("auth.resendCooldown") : t("auth.resendSent")}
            </p>
          ) : (
            <form action={resendAction} className="mt-1">
              <input type="hidden" name="email" value={unconfirmedEmail} />
              <button type="submit" disabled={resendPending}
                className="font-semibold text-accent hover:opacity-75 disabled:opacity-50">
                {resendPending ? t("common.loading") : t("auth.resendEmail")}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="relative mt-5 text-sm text-muted">
        {t("auth.noAccount")}{" "}
        <Link href="/register" className="font-medium text-accent">{t("auth.signUp")}</Link>
      </p>
    </Card>
  );
}
