"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { setUserRoleAction, adjustUserCreditsAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

export function UserActions({ userId, role, isSelf }: { userId: string; role: string; isSelf: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(p: Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = await p;
      if (res.ok) { toast.success(t("common.save")); router.refresh(); }
      else toast.error(res.error === "self_demotion" ? t("admin.selfDemotion") : t("common.error"));
    });
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" disabled={pending || isSelf}
        onClick={() => {
          const next = role === "admin" ? "user" : "admin";
          if (confirm(t("admin.confirmRole", { role: next }))) {
            run(setUserRoleAction(userId, next));
          }
        }}>
        {role === "admin" ? t("admin.removeAdmin") : t("admin.makeAdmin")}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => {
          const raw = prompt(t("admin.creditsPrompt"));
          if (raw === null) return;
          const amount = parseInt(raw, 10);
          if (!Number.isInteger(amount) || amount === 0) { toast.error(t("common.error")); return; }
          run(adjustUserCreditsAction(userId, amount, "Admin adjustment"));
        }}>
        ± {t("nav.credits")}
      </Button>
    </div>
  );
}
