"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { Card } from "@/components/ui/card";

export default function RegisterPage() {
  const { t } = useI18n();
  const [state, action] = useActionState(signUp, null);
  if (state?.info === "confirm_email") {
    return (
      <Card className="p-6 sm:p-8 text-center">
        <p className="text-3xl">✉️</p>
        <h1 className="mt-3 font-display text-lg font-semibold">{t("auth.confirmEmail")}</h1>
      </Card>
    );
  }
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-display text-xl font-semibold">{t("auth.registerTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("auth.registerSub")}</p>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="full_name">{t("auth.fullName")}</Label>
          <Input id="full_name" name="full_name" required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton className="w-full" pendingLabel={t("common.loading")}>{t("auth.signUp")}</SubmitButton>
      </form>
      <p className="mt-5 text-sm text-muted">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-accent">{t("auth.signIn")}</Link>
      </p>
    </Card>
  );
}
