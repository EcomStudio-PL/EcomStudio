"use client";
import { useActionState } from "react";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { requestPasswordReset } from "@/app/actions/auth";

/**
 * HASŁO — the EXISTING recovery flow, started from the account screen.
 *
 * This is not a second way to change a password. It posts the signed-in
 * address to the same `requestPasswordReset` the "Nie pamiętasz hasła?"
 * dialog uses (same rate limit, same always-identical answer), and the new
 * password is set on /reset-password from the e-mailed link — so the change
 * still needs the inbox, exactly as it does from the login screen.
 */
export function PasswordReset({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(requestPasswordReset, null);

  if (state?.info === "sent") {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-[rgb(var(--success)/0.10)] px-4 py-3.5" data-password-reset="sent">
        <MailCheck size={17} aria-hidden className="mt-0.5 shrink-0 text-success" />
        <p className="text-sm leading-relaxed text-success">{t("auth.resetGeneric")}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3" data-password-reset>
      <input type="hidden" name="email" value={email} />
      <p className="break-words text-[13px] leading-relaxed text-muted">{t("settings.password.hint", { email })}</p>
      <button type="submit" disabled={pending}
        className="inline-flex h-10 max-w-full items-center justify-center gap-2 rounded-xl border border-line px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-70">
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <KeyRound size={14} aria-hidden />}
        <span className="truncate">{pending ? t("common.loading") : t("auth.sendReset")}</span>
      </button>
    </form>
  );
}
