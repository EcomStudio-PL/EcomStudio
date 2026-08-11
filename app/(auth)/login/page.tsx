"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  const { t } = useI18n();
  const [state, action] = useActionState(signIn, null);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-display text-xl font-semibold">{t("auth.loginTitle")}</h1>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {state?.error && <p className="text-sm text-red-600">{t("auth.invalidCredentials")}</p>}
        <SubmitButton className="w-full" pendingLabel={t("common.loading")}>{t("auth.signIn")}</SubmitButton>
      </form>
      <div className="mt-5 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-muted hover:text-ink">{t("auth.forgotPassword")}</Link>
        <Link href="/register" className="font-medium text-accent">{t("auth.signUp")}</Link>
      </div>
    </Card>
  );
}
