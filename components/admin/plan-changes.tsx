"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/modal";
import { setPlanChangesEnabledAction } from "@/app/actions/plan-change";

/**
 * The module's switch (0181). ON also closes the Customer Portal's own plan
 * change; OFF restores it — so the two deductions can never both apply. The
 * confirmation spells out what happens; the server re-checks the admin role.
 */
export function PlanChangesSwitch({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const target = !enabled;
  const run = () => start(async () => {
    const res = await setPlanChangesEnabledAction(target);
    setOpen(false);
    if (res.ok) { toast.success(t(target ? "admin.planChanges.enabledOk" : "admin.planChanges.disabledOk")); router.refresh(); }
    else toast.error(t("admin.planChanges.switchFailed"));
  });
  return (
    <>
      <Button variant={enabled ? "secondary" : "primary"} onClick={() => setOpen(true)} disabled={pending}>
        {t(enabled ? "admin.planChanges.disable" : "admin.planChanges.enable")}
      </Button>
      <ConfirmModal open={open} onClose={() => setOpen(false)} onConfirm={run} pending={pending} danger={target} portal
        title={t(target ? "admin.planChanges.enableTitle" : "admin.planChanges.disableTitle")}
        body={t(target ? "admin.planChanges.enableBody" : "admin.planChanges.disableBody")}
        confirmLabel={t(target ? "admin.planChanges.enable" : "admin.planChanges.disable")} />
    </>
  );
}
