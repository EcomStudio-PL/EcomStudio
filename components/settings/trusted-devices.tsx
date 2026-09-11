"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Monitor, ShieldOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { revokeDeviceAction } from "@/app/actions/login-security";
import { Button } from "@/components/ui/button";

export type TrustedDeviceView = {
  id: string;
  label: string;
  lastSeen: string;
  isCurrent: boolean;
};

/**
 * "Zaufane urządzenia" in account settings. Each row is a session that passed
 * the email step-up; revoking one makes its next login ask for a code again.
 * The list is read server-side (own rows only, by RLS); this component only
 * revokes and reflects the result.
 */
export function TrustedDevices({ devices }: { devices: TrustedDeviceView[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = (id: string) => {
    setBusyId(id);
    start(async () => {
      const ok = await revokeDeviceAction(id);
      setBusyId(null);
      if (ok) { toast.success(t("loginSec.revoked")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  };

  if (devices.length === 0) {
    return <p className="text-[13px] text-muted">{t("loginSec.devicesEmpty")}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-muted">
            <Monitor size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {d.label}
              {d.isCurrent && (
                <span className="ml-2 rounded-full bg-[rgb(var(--accent)/0.14)] px-2 py-0.5 text-[11px] font-semibold text-accent">
                  {t("loginSec.thisDevice")}
                </span>
              )}
            </p>
            <p className="truncate text-[12px] text-faint">{t("loginSec.lastActive")}: {d.lastSeen}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => revoke(d.id)}
            disabled={pending && busyId === d.id}>
            <ShieldOff size={14} aria-hidden className="mr-1.5" />
            {t("loginSec.revoke")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
