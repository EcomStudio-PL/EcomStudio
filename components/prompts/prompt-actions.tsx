"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { createPromptsAction } from "@/app/actions/prompts";
import { Button } from "@/components/ui/button";

export function CreatePromptsButton({ productId }: { productId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending}
      onClick={() => start(async () => {
        const res = await createPromptsAction(productId);
        if (res.ok) { toast.success(t("prompts.created", { n: res.count ?? 0 })); router.refresh(); }
        else toast.error(t("common.error"));
      })}>
      {pending ? t("common.loading") : `✦ ${t("prompts.fromTemplates")}`}
    </Button>
  );
}

export function CopyPromptButton({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <button type="button"
      className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
      onClick={() => { void navigator.clipboard.writeText(text); toast.success(t("prompts.copied")); }}>
      ⧉ {t("prompts.copy")}
    </button>
  );
}
