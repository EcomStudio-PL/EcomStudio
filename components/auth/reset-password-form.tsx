"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { updatePassword } from "@/app/actions/auth";
import { passwordIssue } from "@/lib/auth-validation";
import { useI18n } from "@/lib/i18n/provider";
import { Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PasswordField } from "@/components/auth/password-field";
import { PasswordRules } from "@/components/auth/password-rules";

export function ResetPasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(updatePassword, null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;

  if (state?.ok && state.info === "updated") {
    return (
      <Card className="mx-auto w-full max-w-md p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--success)/0.14)] text-success">
          <CheckCircle2 size={26} aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold">{t("auth.passwordChanged")}</h1>
        <Link href="/login"
          className="cta mt-6 inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold">
          {t("auth.goToLogin")}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="relative mx-auto w-full max-w-md overflow-hidden p-6 sm:p-8">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(18rem 7rem at 18% -30%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
      <h1 className="relative font-display text-xl font-semibold tracking-tight">{t("auth.updatePassword")}</h1>
      <form action={action} className="relative mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="password">{t("auth.newPassword")}</Label>
          <PasswordField id="password" name="password" autoComplete="new-password"
            value={password} onChange={setPassword} minLength={8}
            invalid={password.length > 0 && passwordIssue(password) !== null} />
          <PasswordRules password={password} />
        </div>
        <div>
          <Label htmlFor="password_confirm">{t("auth.passwordConfirm")}</Label>
          <PasswordField id="password_confirm" name="password_confirm" autoComplete="new-password"
            value={confirm} onChange={setConfirm} minLength={8} invalid={mismatch} />
          {mismatch && (
            <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger">{t("auth.err_mismatch")}</p>
          )}
        </div>
        {state?.error && !pending && (
          <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.10)] px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {t(`auth.err_${state.error}`)}
          </p>
        )}
        <button type="submit" disabled={pending}
          className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {pending ? t("common.loading") : t("auth.updatePassword")}
        </button>
      </form>
    </Card>
  );
}
