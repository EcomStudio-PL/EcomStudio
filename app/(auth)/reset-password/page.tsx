"use client";
import { useActionState } from "react";
import { updatePassword } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { Card } from "@/components/ui/card";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [state, action] = useActionState(updatePassword, null);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-display text-xl font-semibold">{t("auth.updatePassword")}</h1>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="password">{t("auth.newPassword")}</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        {state?.error && <p className="text-sm text-red-600">{t("common.error")}</p>}
        <SubmitButton className="w-full" pendingLabel={t("common.loading")}>{t("auth.updatePassword")}</SubmitButton>
      </form>
    </Card>
  );
}
