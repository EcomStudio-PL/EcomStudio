"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

/** The answer here is ALWAYS the same generic sentence — whether the account
 *  exists, the send failed, or the rate limit tripped. Anything more precise
 *  is an account-enumeration oracle. */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <Card className="relative mx-auto w-full max-w-md overflow-hidden p-6 sm:p-8">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(18rem 7rem at 18% -30%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
      <h1 className="relative font-display text-xl font-semibold tracking-tight">{t("auth.resetTitle")}</h1>
      <p className="relative mt-1 text-sm text-muted">{t("auth.resetSub")}</p>
      {state?.info === "sent" ? (
        <div className="relative mt-6 flex items-start gap-3 rounded-xl bg-[rgb(var(--success)/0.10)] px-4 py-3.5">
          <MailCheck size={17} aria-hidden className="mt-0.5 shrink-0 text-success" />
          <p className="text-sm leading-relaxed text-success">{t("auth.resetGeneric")}</p>
        </div>
      ) : (
        <form action={action} className="relative mt-6 space-y-4">
          <div>
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" inputMode="email" />
          </div>
          <button type="submit" disabled={pending}
            className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {pending ? t("common.loading") : t("auth.sendReset")}
          </button>
        </form>
      )}
      <p className="relative mt-5 text-sm text-muted">
        <Link href="/login" className="font-medium text-accent">{t("auth.backToLogin")}</Link>
      </p>
    </Card>
  );
}
