"use client";
import { useActionState } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";

/**
 * THE PASSWORD-RECOVERY BODY, surface-free like the login one.
 *
 * The answer is ALWAYS the same generic sentence — whether the account
 * exists, the send failed, or the rate limit tripped. Anything more precise
 * is an account-enumeration oracle, and moving the form into a dialog does
 * not make that any less true.
 */
export function ForgotForm({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(requestPasswordReset, null);

  return (
    <div>
      {onBack && (
        <button type="button" onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden />
          {t("common.back")}
        </button>
      )}

      {state?.info === "sent" ? (
        <div className="flex items-start gap-3 rounded-xl bg-[rgb(var(--success)/0.10)] px-4 py-3.5">
          <MailCheck size={17} aria-hidden className="mt-0.5 shrink-0 text-success" />
          <p className="text-sm leading-relaxed text-success">{t("auth.resetGeneric")}</p>
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <div>
            <Label htmlFor="reset-email">{t("auth.email")}</Label>
            <Input id="reset-email" name="email" type="email" required autoComplete="email" inputMode="email" />
          </div>
          <button type="submit" disabled={pending}
            className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {pending ? t("common.loading") : t("auth.sendReset")}
          </button>
        </form>
      )}
    </div>
  );
}
