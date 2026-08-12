"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { setThreadStatusAction } from "@/app/actions/support";
import { Button } from "@/components/ui/button";

export function ThreadStatusButton({ threadId, status }: { threadId: string; status: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = status === "open" ? "closed" : "open";
  return (
    <Button size="sm" variant="secondary" disabled={pending}
      onClick={() => start(async () => {
        const res = await setThreadStatusAction(threadId, next as "open" | "closed");
        if (res.ok) router.refresh(); else toast.error(t("common.error"));
      })}>
      {status === "open" ? t("chat.close") : t("chat.reopen")}
    </Button>
  );
}
