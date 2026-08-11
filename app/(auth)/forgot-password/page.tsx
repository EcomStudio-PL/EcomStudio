"use client";
import { useActionState } from "react";
import { requestPasswordReset } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { Card } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [state, action] = useActionState(requestPasswordReset, null);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-display text-xl font-semibold">{t("auth.resetTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("auth.resetSub")}</p>
      {state?.info === "sent" ? (
        <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">{t("auth.resetSent")}</p>
      ) : (
        <form action={action} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          {state?.error && <p className="text-sm text-red-600">{t("common.error")}</p>}
          <SubmitButton className="w-full" pendingLabel={t("common.loading")}>{t("auth.sendReset")}</SubmitButton>
        </form>
      )}
    </Card>
  );
}
