"use client";
import { useActionState, useEffect } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveProfileAction, setLocaleAction } from "@/app/actions/settings";
import { Input, Select, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { LOCALES } from "@/lib/i18n/config";

export function SettingsForm({ fullName, email }: { fullName: string; email: string }) {
  const { t, locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [state, action] = useActionState(saveProfileAction, null);

  useEffect(() => {
    if (state?.ok) toast.success(t("settings.saved"));
    else if (state && !state.ok) toast.error(t("common.error"));
  }, [state, t]);

  return (
    <form action={action} className="space-y-5">
      <div>
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" value={email} disabled readOnly />
      </div>
      <div>
        <Label htmlFor="full_name">{t("auth.fullName")}</Label>
        <Input id="full_name" name="full_name" defaultValue={fullName} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="locale">{t("settings.language")}</Label>
          <Select id="locale" value={locale} onChange={(e) => void setLocaleAction(e.target.value)}>
            {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="theme">{t("settings.theme")}</Label>
          <Select id="theme" name="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">{t("settings.themes.light")}</option>
            <option value="dark">{t("settings.themes.dark")}</option>
          </Select>
        </div>
      </div>
      <SubmitButton pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
    </form>
  );
}
