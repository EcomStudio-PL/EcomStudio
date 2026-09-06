"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveLoginSecurityAction } from "@/app/actions/login-security";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/record";
import { Button } from "@/components/ui/button";
import type { LoginSecuritySettings } from "@/lib/server/login-security";

/**
 * BEZPIECZEŃSTWO LOGOWANIA — the admin's knobs for the step-up challenge.
 *
 * Two toggles decide WHEN a code is demanded (new device, new IP), and four
 * numbers tune the challenge itself. Everything the admin can set here is a
 * policy value, never a secret — so it saves as one plain row and the audit
 * log records the values in the clear. A refused save puts the previous values
 * back; nothing is applied until the server accepts it.
 */
type NumField = "reverifyDays" | "codeTtlMinutes" | "maxAttempts" | "resendSeconds";

const NUM_ROWS: readonly { field: NumField; labelKey: string; hintKey: string; min: number; max: number }[] = [
  { field: "reverifyDays", labelKey: "loginSec.reverifyDays", hintKey: "loginSec.reverifyHint", min: 0, max: 365 },
  { field: "codeTtlMinutes", labelKey: "loginSec.codeTtl", hintKey: "loginSec.codeTtlHint", min: 1, max: 60 },
  { field: "maxAttempts", labelKey: "loginSec.maxAttempts", hintKey: "loginSec.maxAttemptsHint", min: 1, max: 10 },
  { field: "resendSeconds", labelKey: "loginSec.resend", hintKey: "loginSec.resendHint", min: 15, max: 600 },
];

export function LoginSecuritySettingsForm({ settings }: { settings: LoginSecuritySettings }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<LoginSecuritySettings>(settings);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof LoginSecuritySettings>(key: K, next: LoginSecuritySettings[K]) => {
    setValue((prev) => ({ ...prev, [key]: next }));
    setDirty(true);
  };

  const setNum = (field: NumField, raw: string, min: number, max: number) => {
    const n = Number(raw.replace(/\D/g, ""));
    set(field, Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
  };

  const save = () => start(async () => {
    const res = await saveLoginSecurityAction(value);
    if (res.ok) {
      toast.success(t("loginSec.saved"));
      setDirty(false);
      router.refresh();
    } else {
      toast.error(t(res.error === "forbidden" ? "common.forbidden" : "common.error"));
      setValue(settings);
      setDirty(false);
    }
  });

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <CardHeader title={t("loginSec.whenTitle")} sub={t("loginSec.whenSub")} />
        <div className="mt-4 space-y-4">
          <label className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{t("loginSec.verifyDevice")}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{t("loginSec.verifyDeviceHint")}</span>
            </span>
            <Switch checked={value.verifyNewDevice} onChange={(v) => set("verifyNewDevice", v)}
              label={t("loginSec.verifyDevice")} />
          </label>
          <label className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{t("loginSec.verifyIp")}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{t("loginSec.verifyIpHint")}</span>
            </span>
            <Switch checked={value.verifyNewIp} onChange={(v) => set("verifyNewIp", v)}
              label={t("loginSec.verifyIp")} />
          </label>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("loginSec.tuneTitle")} sub={t("loginSec.tuneSub")} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {NUM_ROWS.map((row) => (
            <div key={row.field}>
              <label className="block text-sm font-medium text-ink" htmlFor={`ls-${row.field}`}>
                {t(row.labelKey)}
              </label>
              <input id={`ls-${row.field}`} inputMode="numeric" value={String(value[row.field])}
                onChange={(e) => setNum(row.field, e.target.value, row.min, row.max)}
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]" />
              <p className="mt-1 text-[12px] leading-relaxed text-faint">{t(row.hintKey)}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || pending}>
          {pending ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
