"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { toggleModelAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

export function ModelToggle({ modelId, active }: { modelId: string; active: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant={active ? "secondary" : "primary"} disabled={pending}
      onClick={() => start(async () => {
        const res = await toggleModelAction(modelId, !active);
        if (res.ok) { toast.success(t("common.save")); router.refresh(); }
        else toast.error(t("common.error"));
      })}>
      {active ? t("admin.deactivate") : t("admin.activate")}
    </Button>
  );
}
