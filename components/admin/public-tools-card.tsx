"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Store } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/modal";
import { setPublicToolsAction } from "@/app/actions/public-tools";
import { GUEST_PREVIEW_ROUTE } from "@/lib/public-tools";
import { cn } from "@/lib/utils";

/**
 * PUBLICZNE NARZĘDZIA (Public Tools V1) — on the access panel, because it is
 * an access question: may a visitor open the tool catalogue and the tools.
 *
 * Off by default and off after every deploy until an admin turns it on here.
 * It opens the TOOLS only: registration, login and the waiting list are the
 * switches above and are not touched — the card says what they are, so
 * nobody opens the tools believing visitors can now sign up.
 *
 * "Podgląd jako gość" works with the switch off: it shows this admin the
 * visitor's interface without opening it to anyone.
 */
export function PublicToolsCard({ initial, signupOpen, waitlistEnabled, loginOpen }: {
  initial: { enabled: boolean; updatedAt: string | null };
  signupOpen: boolean;
  waitlistEnabled: boolean;
  loginOpen: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [flag, setFlag] = useState(initial);
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const apply = async (enabled: boolean) => {
    setBusy(true);
    const res = await setPublicToolsAction(enabled);
    setBusy(false);
    setConfirm(null);
    if (!res.ok) { toast.error(t("publicTools.admin.saveError")); return; }
    setFlag(res.data);
    toast.success(t(res.data.enabled ? "publicTools.admin.savedOn" : "publicTools.admin.savedOff"));
    router.refresh();
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch(GUEST_PREVIEW_ROUTE, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: true }),
      });
      if (res.ok) { window.location.href = "/tools"; return; }
      toast.error(t("publicTools.admin.previewError"));
    } catch {
      toast.error(t("publicTools.admin.previewError"));
    }
    setPreviewing(false);
  };

  const when = flag.updatedAt
    ? new Date(flag.updatedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" })
    : null;
  const check = (ok: boolean, key: string) => (
    <li className="flex items-start gap-2">
      <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-warning")} />
      <span>{t(key)}: <strong className={ok ? "text-success" : "text-warning"}>{t(ok ? "publicTools.admin.yes" : "publicTools.admin.no")}</strong></span>
    </li>
  );

  return (
    <Card className="mt-6 p-5 sm:p-6" data-public-tools-card={flag.enabled ? "on" : "off"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Store size={17} aria-hidden /> {t("publicTools.admin.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("publicTools.admin.body")}</p>
        </div>
        <span data-public-tools-status className={cn(
          "inline-flex h-7 items-center rounded-full px-3 text-[12px] font-bold uppercase tracking-wide",
          flag.enabled ? "bg-[rgb(var(--success)/0.14)] text-success" : "bg-raised text-muted",
        )}>
          {t(flag.enabled ? "publicTools.admin.on" : "publicTools.admin.off")}
        </span>
      </div>
      {when && <p className="mt-2 text-[12px] text-faint">{t("publicTools.admin.changed", { when })}</p>}

      <div className="mt-4 rounded-xl border border-line bg-raised/50 p-3.5 text-[13px]">
        <p className="font-semibold">{t("publicTools.admin.beforeLaunch")}</p>
        <ul className="mt-2 space-y-1.5 text-muted">
          {check(signupOpen, "publicTools.admin.checkSignup")}
          {check(loginOpen, "publicTools.admin.checkLogin")}
          <li className="text-[12.5px]">{t(waitlistEnabled ? "publicTools.admin.waitlistOn" : "publicTools.admin.waitlistOff")}</li>
        </ul>
        <p className="mt-2 text-[12.5px]">{t("publicTools.admin.signupIndependent")}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => setConfirm(!flag.enabled)} disabled={busy} variant={flag.enabled ? "secondary" : "primary"}
          data-public-tools-toggle>
          {busy && <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden />}
          {t(flag.enabled ? "publicTools.admin.turnOff" : "publicTools.admin.turnOn")}
        </Button>
        <Button onClick={() => void preview()} disabled={previewing} variant="secondary" data-public-tools-preview>
          {previewing ? <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden /> : <Eye size={14} className="mr-1.5" aria-hidden />}
          {t("publicTools.admin.preview")}
        </Button>
      </div>

      <ConfirmModal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => { if (confirm !== null) void apply(confirm); }}
        pending={busy}
        danger={confirm === false}
        title={t(confirm ? "publicTools.admin.confirmOnTitle" : "publicTools.admin.confirmOffTitle")}
        body={t(confirm ? "publicTools.admin.confirmOnBody" : "publicTools.admin.confirmOffBody")}
        confirmLabel={t(confirm ? "publicTools.admin.turnOn" : "publicTools.admin.turnOff")}
        portal
      />
    </Card>
  );
}
