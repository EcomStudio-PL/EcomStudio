"use client";
import { useActionState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { resendConfirmation } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";

/**
 * "Send me a fresh confirmation email" — for the invalid-link screen, where
 * (unlike the register flow) the address is not known, so it asks for it.
 * Wired to the same resendConfirmation action as the register page; the
 * server answers identically for known and unknown addresses, so this form
 * leaks nothing about which emails exist.
 */
export function ResendLink() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(resendConfirmation, null);

  if (state?.info) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-success">
        <MailCheck size={14} aria-hidden />
        {state.info === "cooldown" ? t("auth.resendCooldown") : t("auth.resendSent")}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3 text-left">
      <div>
        <Label htmlFor="resend-email">{t("auth.email")}</Label>
        <Input id="resend-email" name="email" type="email" required autoComplete="email"
          inputMode="email" placeholder="jan@firma.pl" />
      </div>
      <button type="submit" disabled={pending}
        className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
        {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
        {pending ? t("common.loading") : t("auth.resendNew")}
      </button>
    </form>
  );
}
