"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveProfileAction, setLocaleAction } from "@/app/actions/settings";
import { Input, Select, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { LOCALES } from "@/lib/i18n/config";

/**
 * PROFIL — the name the app greets you by, next to the address you sign in
 * with (read-only: changing it is not a feature GrovBase offers). Saved
 * through the same `saveProfileAction` → `profiles.full_name` as before the
 * settings were split into tabs.
 */
export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const { t } = useI18n();
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
      <SubmitButton pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
    </form>
  );
}

const THEMES = ["light", "dark", "system"] as const;

/**
 * PREFERENCJE — language and theme. Both apply the moment they change, as
 * the language did before: the locale through `setLocaleAction` (cookie +
 * user_preferences.locale), the theme through next-themes and then
 * `saveProfileAction` with the theme field alone (user_preferences.theme).
 *
 * "System" is offered because it is what a new account stores and what
 * next-themes (enableSystem) may hold; without it the select showed nothing
 * for exactly those accounts.
 */
export function PreferencesForm() {
  const { t, locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  // next-themes only knows the stored theme after mount; before that the
  // select would render one value on the server and another on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted && theme && (THEMES as readonly string[]).includes(theme) ? theme : "";

  const changeTheme = (value: string) => {
    setTheme(value);
    const form = new FormData();
    form.set("theme", value);
    start(async () => {
      try {
        const res = await saveProfileAction(null, form);
        if (!res.ok) toast.error(t("common.error"));
      } catch {
        toast.error(t("common.error"));
      }
    });
  };

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="min-w-0">
        <Label htmlFor="locale">{t("settings.language")}</Label>
        <Select id="locale" value={locale} onChange={(e) => void setLocaleAction(e.target.value)}>
          {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </Select>
      </div>
      <div className="min-w-0">
        <Label htmlFor="theme">{t("settings.theme")}</Label>
        <Select id="theme" name="theme" value={current} disabled={!mounted || pending}
          onChange={(e) => changeTheme(e.target.value)}>
          {!current && <option value="" disabled hidden />}
          <option value="light">{t("settings.themes.light")}</option>
          <option value="dark">{t("settings.themes.dark")}</option>
          <option value="system">{t("settings.themes.system")}</option>
        </Select>
      </div>
    </div>
  );
}
